import { Server } from '@hocuspocus/server';
import { Role } from '@prisma/client';
import * as Y from 'yjs';
import { cookieFromHeaders, resolveRoomAccess, type RoomAccess } from '../access.js';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { SESSION_COOKIE } from '../tokens.js';
import { parseDocumentName } from './names.js';
import { CONTENT_TEXT_KEY, mirrorTree, storeFileContent } from './tree.js';

export type SyncContext = RoomAccess;

export const syncServer = new Server<SyncContext>({
  name: 'codeTogether sync',
  port: env.SYNC_PORT,
  debounce: 500,
  maxDebounce: 2_000,
  quiet: true,

  async onAuthenticate({ documentName, token, requestHeaders, connectionConfig }) {
    const target = parseDocumentName(documentName);
    if (!target) {
      throw new Error('Unknown document.');
    }

    const access = await resolveRoomAccess(
      target.roomId,
      token,
      cookieFromHeaders(requestHeaders, SESSION_COOKIE),
    );

    // Set here rather than on the connection in `connected`: Hocuspocus builds
    // the Connection from this value and replays the client's already-queued
    // messages before it awaits `connected`, so assigning later leaves a window
    // in which a viewer's first writes land. This is also the value sent to the
    // client in the `authenticated` frame, which lets its provider know.
    connectionConfig.readOnly = access.role === Role.VIEWER;

    return access;
  },

  /**
   * Identity is stamped by the server so a client cannot choose a name, colour
   * or role that misrepresents who it is. Everything else a client puts in its
   * awareness state (cursor selection, which file it is viewing) is left alone.
   */
  async beforeHandleAwareness({ states, context }) {
    if (!context) return;

    for (const state of states.values()) {
      state.user = {
        id: context.identityId,
        name: context.name,
        color: context.color,
        role: context.role,
        guest: context.guest,
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

  async onStoreDocument({ documentName, document }) {
    const target = parseDocumentName(documentName);
    if (!target) return;

    try {
      if (target.kind === 'tree') {
        await mirrorTree(target.roomId, document);
      } else {
        await storeFileContent(target.roomId, target.fileId, document);
      }
    } catch (error) {
      // A room deleted while someone still had it open is the expected cause.
      // Losing the write is correct there; crashing the server is not.
      console.error(`Could not persist "${documentName}".`, error);
    }
  },
});
