import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Server, type onStoreDocumentPayload } from '@hocuspocus/server';
import { Role } from '@prisma/client';
import * as Y from 'yjs';
import { cookieFromHeaders, resolveRoomAccess, type RoomAccess } from '../access.js';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { SESSION_COOKIE } from '../tokens.js';
import { parseDocumentName } from './names.js';
import { CONTENT_TEXT_KEY, mirrorTree, storeFileContent } from './tree.js';
import { isAllowedOrigin } from '../lib/origins.js';

export type SyncContext = RoomAccess;
const storeRetries = new Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> | null }>();

function clearStoreRetry(name: string): void {
  const retry = storeRetries.get(name);
  if (retry?.timer) clearTimeout(retry.timer);
  storeRetries.delete(name);
}

function scheduleStoreRetry(payload: onStoreDocumentPayload<SyncContext>): void {
  const retry = storeRetries.get(payload.documentName) ?? { attempts: 0, timer: null };
  if (retry.timer) return;
  retry.attempts = Math.min(retry.attempts + 1, 5);
  retry.timer = setTimeout(() => {
    retry.timer = null;
    const instance = syncServer.hocuspocus;
    if (instance.documents.get(payload.documentName) !== payload.document) {
      clearStoreRetry(payload.documentName);
      return;
    }
    // Use Hocuspocus's save mutex and unload handling for every retry.
    void instance.storeDocumentHooks(payload.document, payload, true);
  }, Math.min(2_000 * 2 ** (retry.attempts - 1), 30_000));
  retry.timer.unref();
  storeRetries.set(payload.documentName, retry);
}

export const syncServer = new Server<SyncContext>({
  name: 'codeTogether sync',
  port: env.SYNC_PORT,
  debounce: 500,
  maxDebounce: 2_000,
  quiet: true,

  async onUpgrade({ request }) {
    if (!isAllowedOrigin(request.headers.origin)) throw new Error('Website origin denied.');
  },

  async onAuthenticate({ documentName, token, requestHeaders, connectionConfig }) {
    const target = parseDocumentName(documentName);
    if (!target) {
      console.error('[Sync Auth Error] Unknown document:', documentName);
      throw new Error('Unknown document.');
    }

    try {
      const cookie = cookieFromHeaders(requestHeaders, SESSION_COOKIE);
      const access = await resolveRoomAccess(target.roomId, token, cookie);
      connectionConfig.readOnly = access.role === Role.VIEWER;
      return access;
    } catch (err) {
      console.error('[Sync Auth Error]', {
        documentName,
        token: Boolean(token),
        hasHeaders: Boolean(requestHeaders),
        hasCookie: Boolean(cookieFromHeaders(requestHeaders, SESSION_COOKIE)),
        error: err instanceof Error ? err.message : err,
      });
      throw err;
    }
  },

  /**
   * Identity is stamped by the server so a client cannot choose a name, colour
   * or role that misrepresents who it is. Everything else a client puts in its
   * awareness state (cursor selection, which file it is viewing) is left alone.
   */
  async beforeHandleAwareness({ states, context }) {
    if (!context) return;

    for (const state of states.values()) {
      // A client sends awareness remove entries as `null`; leave them intact
      // so peers can remove the departed participant.
      if (state === null) continue;

      state.user = {
        id: context.identityId,
        name: context.name,
        color: context.color,
        role: context.role,
        guest: context.guest,
        avatarUrl: context.avatarUrl,
      };
    }
  },

  async onLoadDocument({ documentName, context, document }) {
    const target = parseDocumentName(documentName);
    if (!target || target.roomId !== context.roomId) throw new Error('Room access denied.');

    if (target.kind === 'tree') {
      const room = await prisma.room.findUnique({
        where: { id: context.roomId },
        select: { treeState: true },
      });
      if (room?.treeState) Y.applyUpdate(document, new Uint8Array(room.treeState));
      return document;
    }

    const file = await prisma.file.findFirst({
      where: { id: target.fileId, roomId: context.roomId },
      select: { ydocState: true, textContent: true },
    });

    if (file?.ydocState) {
      Y.applyUpdate(document, new Uint8Array(file.ydocState));
    } else if (file?.textContent) {
      // Imported files arrive as plain text and get their Yjs state on first store.
      document.getText(CONTENT_TEXT_KEY).insert(0, file.textContent);
    }

    return document;
  },

  async onChange({ documentName, document, instance }) {
    const target = parseDocumentName(documentName);
    if (target?.kind === 'tree') {
      // Tree mutations (create/delete/restore/rename/move) are critical structural operations.
      // Persist immediately without the 500ms debounce delay so that page refresh, navigation,
      // or opening recycle-bin never encounters stale state.
      queueMicrotask(async () => {
        try {
          const debounceKey = `onStoreDocument-${documentName}`;
          if (instance.debouncer.isDebounced(debounceKey)) {
            instance.debouncer.executeNow(debounceKey);
          } else {
            await mirrorTree(target.roomId, document);
          }
        } catch (error) {
          console.error(`Immediate persist for "${documentName}" failed:`, error);
        }
      });
    }
  },

  async onDisconnect({ documentName, instance }) {
    // When a client leaves (refresh, tab close, logout), immediately flush any pending
    // changes for this document so writes are never lost in transit.
    const debounceKey = `onStoreDocument-${documentName}`;
    if (instance.debouncer.isDebounced(debounceKey)) {
      try {
        instance.debouncer.executeNow(debounceKey);
      } catch (error) {
        console.error(`Disconnect flush for "${documentName}" failed:`, error);
      }
    }
  },

  async onStoreDocument(payload) {
    const { documentName, document } = payload;
    const target = parseDocumentName(documentName);
    if (!target) return;

    try {
      if (target.kind === 'tree') {
        await mirrorTree(target.roomId, document);
      } else {
        // New files originate in the live tree; never invent a content-only row.
        const tree = syncServer.hocuspocus.documents.get(`room:${target.roomId}:tree`);
        if (tree) await mirrorTree(target.roomId, tree);
        await storeFileContent(target.roomId, target.fileId, document);
      }
      clearStoreRetry(documentName);
    } catch (error) {
      console.error(`Could not persist "${documentName}".`, error);
      let deleted = false;
      try {
        deleted = !(await prisma.room.findUnique({ where: { id: target.roomId }, select: { id: true } }));
      } catch { /* A failed existence check is not evidence that the room was deleted. */ }
      if (deleted) { clearStoreRetry(documentName); return; }
      scheduleStoreRetry(payload);
      // Hocuspocus retains failed documents while the bounded retry recovers storage.
      throw error;
    }
  },
});

/**
 * Drop every document connection for one person in one room. Membership is
 * checked when a provider reconnects, so this makes a role downgrade or
 * removal take effect immediately instead of leaving an old editable socket
 * alive until the browser happens to reconnect.
 */
export function resetRoomIdentityConnections(roomId: string, identityId: string): void {
  closeRoomConnections(roomId, (context) => context.identityId === identityId);
}

/** Drop live guest sockets that were authorised by a now-revoked share link. */
export function resetRoomShareLinkConnections(roomId: string, linkId: string): void {
  closeRoomConnections(roomId, (context) => context.guest && context.shareLinkId === linkId);
}

export function closeDeletedRoomConnections(roomId: string): void {
  closeRoomConnections(roomId, () => true);
}

function closeRoomConnections(
  roomId: string,
  shouldClose: (context: SyncContext) => boolean,
): void {
  for (const [documentName, document] of syncServer.hocuspocus.documents) {
    const target = parseDocumentName(documentName);
    if (!target || target.roomId !== roomId) continue;

    for (const connection of document.connections.keys()) {
      if (connection.context && shouldClose(connection.context)) connection.close();
    }
  }
}

/**
 * Routes WebSocket upgrades on the primary HTTP server directly into Hocuspocus.
 */
export async function handleSyncUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  await syncServer.hocuspocus.hooks('onUpgrade', {
    request,
    socket,
    head,
    instance: syncServer.hocuspocus,
  });
  const crossws = (
    syncServer as unknown as {
      crossws: { handleUpgrade: (r: IncomingMessage, s: Duplex, h: Buffer) => void };
    }
  ).crossws;
  crossws.handleUpgrade(request, socket, head);
}
