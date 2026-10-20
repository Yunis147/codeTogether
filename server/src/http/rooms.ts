import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { NodeType, Role } from '@prisma/client';
import * as Y from 'yjs';
import { z } from 'zod';
import { AccessError, ROLE_RANK, type RoomAccess } from '../access.js';
import { createZip, type ZipEntry } from '../lib/zip.js';
import { prisma } from '../prisma.js';
import {
  STARTER_CODE,
  STARTER_FILE_LANGUAGE,
  STARTER_FILE_NAME,
  createStarterContent,
  createStarterTree,
} from '../sync/tree.js';
import { resetRoomIdentityConnections, resetRoomShareLinkConnections } from '../sync/index.js';
import { firstIssue, withRoomAccess, withUser } from './middleware.js';

export const roomsRouter = Router();

const roomNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Room names need at least 2 characters.')
    .max(60, 'Room names can be at most 60 characters.'),
});

const shareRoleSchema = z.object({
  role: z.enum([Role.EDITOR, Role.VIEWER], {
    message: 'Choose viewer or editor access.',
  }),
});

const memberRoleSchema = z.object({
  role: z.enum([Role.EDITOR, Role.VIEWER], {
    message: 'Members can be editors or viewers.',
  }),
});

function requireOwner(access: RoomAccess): void {
  if (access.role !== Role.OWNER) {
    throw new AccessError('Only the room owner can do that.', 403);
  }
}

function requireAccount(access: RoomAccess, action: string): void {
  if (access.guest) {
    throw new AccessError(`Sign in to ${action}.`, 403);
  }
}

roomsRouter.get(
  '/',
  withUser(async (user, _request, response) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: user.userId },
      orderBy: { room: { updatedAt: 'desc' } },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            updatedAt: true,
            owner: { select: { name: true } },
            _count: { select: { memberships: true } },
          },
        },
      },
    });

    const rooms = memberships.map(({ room, role, joinedAt }) => ({
      id: room.id,
      name: room.name,
      role,
      updatedAt: room.updatedAt,
      joinedAt,
      ownerName: room.owner.name,
      memberCount: room._count.memberships,
    }));

    response.json({
      owned: rooms.filter((room) => room.role === Role.OWNER),
      shared: rooms.filter((room) => room.role !== Role.OWNER),
    });
  }),
);

roomsRouter.post(
  '/',
  withUser(async (user, request, response) => {
    const parsed = roomNameSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }

    // A new room starts with one file. Both Yjs documents are written in the
    // same create, so there is never a moment where a room has no tree.
    const fileId = randomUUID();
    const tree = createStarterTree(fileId);
    const content = createStarterContent();

    const room = await prisma.room.create({
      data: {
        name: parsed.data.name,
        ownerId: user.userId,
        treeState: Buffer.from(Y.encodeStateAsUpdate(tree)),
        memberships: { create: { userId: user.userId, role: Role.OWNER } },
        files: {
          create: {
            id: fileId,
            name: STARTER_FILE_NAME,
            type: NodeType.FILE,
            language: STARTER_FILE_LANGUAGE,
            order: 0,
            ydocState: Buffer.from(Y.encodeStateAsUpdate(content)),
            textContent: STARTER_CODE,
          },
        },
      },
    });

    response.status(201).json({
      room: {
        id: room.id,
        name: room.name,
        role: Role.OWNER,
        updatedAt: room.updatedAt,
        ownerName: user.name,
        memberCount: 1,
      },
    });
  }),
);

roomsRouter.get(
  '/:roomId',
  withRoomAccess(async (access, _request, response) => {
    const room = await prisma.room.findUnique({
      where: { id: access.roomId },
      select: { id: true, name: true, updatedAt: true, owner: { select: { name: true } } },
    });

    if (!room) {
      response.status(404).json({ error: 'That room no longer exists.' });
      return;
    }

    response.json({
      room: { id: room.id, name: room.name, updatedAt: room.updatedAt, ownerName: room.owner.name },
      role: access.role,
      guest: access.guest,
      identity: { id: access.identityId, name: access.name, color: access.color },
    });
  }),
);

roomsRouter.patch(
  '/:roomId',
  withRoomAccess(async (access, request, response) => {
    requireOwner(access);

    const parsed = roomNameSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }

    const room = await prisma.room.update({
      where: { id: access.roomId },
      data: { name: parsed.data.name },
    });

    response.json({ room: { id: room.id, name: room.name } });
  }),
);

roomsRouter.delete(
  '/:roomId',
  withRoomAccess(async (access, _request, response) => {
    requireOwner(access);
    // Memberships, share links and files all cascade from the room.
    await prisma.room.delete({ where: { id: access.roomId } });
    response.status(204).end();
  }),
);

roomsRouter.post(
  '/:roomId/leave',
  withRoomAccess(async (access, _request, response) => {
    requireAccount(access, 'manage room membership');

    if (access.role === Role.OWNER) {
      throw new AccessError('The owner cannot leave. Delete the room instead.', 400);
    }

    await prisma.membership.delete({
      where: { userId_roomId: { userId: access.identityId, roomId: access.roomId } },
    });

    response.status(204).end();
  }),
);

roomsRouter.get(
  '/:roomId/members',
  withRoomAccess(async (access, _request, response) => {
    requireAccount(access, 'see who is in this room');

    const memberships = await prisma.membership.findMany({
      where: { roomId: access.roomId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const members = memberships
      .map(({ user, role, joinedAt }) => ({
        id: user.id,
        name: user.name,
        // Only the owner, who manages membership, sees addresses.
        email: access.role === Role.OWNER ? user.email : null,
        role,
        joinedAt,
        isYou: user.id === access.identityId,
      }))
      .sort((left, right) => ROLE_RANK[right.role] - ROLE_RANK[left.role]);

    response.json({ members });
  }),
);

roomsRouter.patch(
  '/:roomId/members/:userId',
  withRoomAccess(async (access, request, response) => {
    requireOwner(access);

    const parsed = memberRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }

    const userId = String(request.params.userId);
    if (userId === access.identityId) {
      throw new AccessError('You cannot change your own role.', 400);
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_roomId: { userId, roomId: access.roomId } },
    });

    if (!membership) {
      response.status(404).json({ error: 'That person is not in this room.' });
      return;
    }

    if (membership.role === Role.OWNER) {
      throw new AccessError('The room owner’s role cannot be changed.', 400);
    }

    const updated = await prisma.membership.update({
      where: { userId_roomId: { userId, roomId: access.roomId } },
      data: { role: parsed.data.role },
    });

    resetRoomIdentityConnections(access.roomId, userId);

    response.json({ member: { id: userId, role: updated.role } });
  }),
);

roomsRouter.delete(
  '/:roomId/members/:userId',
  withRoomAccess(async (access, request, response) => {
    requireOwner(access);

    const userId = String(request.params.userId);
    if (userId === access.identityId) {
      throw new AccessError('Use delete room instead of removing yourself.', 400);
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_roomId: { userId, roomId: access.roomId } },
    });

    if (!membership) {
      response.status(404).json({ error: 'That person is not in this room.' });
      return;
    }

    if (membership.role === Role.OWNER) {
      throw new AccessError('The room owner cannot be removed.', 400);
    }

    await prisma.membership.delete({
      where: { userId_roomId: { userId, roomId: access.roomId } },
    });

    resetRoomIdentityConnections(access.roomId, userId);

    response.status(204).end();
  }),
);

roomsRouter.get(
  '/:roomId/links',
  withRoomAccess(async (access, _request, response) => {
    requireOwner(access);

    const links = await prisma.shareLink.findMany({
      where: { roomId: access.roomId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, role: true, createdAt: true },
    });

    response.json({ links });
  }),
);

roomsRouter.post(
  '/:roomId/links',
  withRoomAccess(async (access, request, response) => {
    requireOwner(access);

    const parsed = shareRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }

    // Reuse the room's existing link for this role instead of piling up a new
    // one on every click, which is what the previous Share dialog did.
    const existing = await prisma.shareLink.findFirst({
      where: { roomId: access.roomId, role: parsed.data.role, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, role: true, createdAt: true },
    });

    if (existing) {
      response.json({ link: existing });
      return;
    }

    const link = await prisma.shareLink.create({
      data: {
        roomId: access.roomId,
        role: parsed.data.role,
        token: randomBytes(24).toString('base64url'),
      },
      select: { id: true, token: true, role: true, createdAt: true },
    });

    response.status(201).json({ link });
  }),
);

roomsRouter.delete(
  '/:roomId/links/:linkId',
  withRoomAccess(async (access, request, response) => {
    requireOwner(access);

    const { count } = await prisma.shareLink.updateMany({
      where: { id: String(request.params.linkId), roomId: access.roomId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      response.status(404).json({ error: 'That link is already inactive.' });
      return;
    }

    resetRoomShareLinkConnections(access.roomId, String(request.params.linkId));

    response.status(204).end();
  }),
);

const MAX_MATCHES_PER_FILE = 20;
const MAX_FILES_SEARCHED = 200;

roomsRouter.get(
  '/:roomId/search',
  withRoomAccess(async (access, request, response) => {
    const query = String(request.query.q ?? '').trim();
    if (query.length < 2) {
      response.json({ query, results: [] });
      return;
    }

    // Searches the plain-text mirror, not live Yjs documents, so it does not
    // need every file loaded. Results lag unsaved keystrokes by the store debounce.
    const files = await prisma.file.findMany({
      where: {
        roomId: access.roomId,
        type: NodeType.FILE,
        OR: [
          { textContent: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, textContent: true },
      take: MAX_FILES_SEARCHED,
      orderBy: { name: 'asc' },
    });

    const needle = query.toLowerCase();

    const results = files
      .map((file) => {
        const matches: { line: number; column: number; text: string }[] = [];
        const lines = (file.textContent ?? '').split('\n');

        for (let index = 0; index < lines.length; index += 1) {
          if (matches.length >= MAX_MATCHES_PER_FILE) break;
          const column = lines[index].toLowerCase().indexOf(needle);
          if (column !== -1) {
            matches.push({ line: index + 1, column: column + 1, text: lines[index].slice(0, 400) });
          }
        }

        if (matches.length === 0 && file.name.toLowerCase().includes(needle)) {
          matches.push({ line: 1, column: 1, text: `File name: ${file.name}` });
        }

        return { fileId: file.id, name: file.name, matches };
      })
      .filter((file) => file.matches.length > 0);

    response.json({ query, results });
  }),
);

/** Strips anything that could escape the archive root or confuse an extractor. */
function pathSegment(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

type FileRow = {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  textContent: string | null;
};

function zipEntriesFor(files: FileRow[]): ZipEntry[] {
  const byId = new Map(files.map((file) => [file.id, file]));

  const pathOf = (file: FileRow): string => {
    const segments: string[] = [];
    const seen = new Set<string>();
    let node: FileRow | undefined = file;

    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      segments.unshift(pathSegment(node.name));
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }

    return segments.join('/');
  };

  return files
    .map((file) =>
      file.type === NodeType.FOLDER
        ? { path: `${pathOf(file)}/` }
        : { path: pathOf(file), content: file.textContent ?? '' },
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

roomsRouter.get(
  '/:roomId/export',
  withRoomAccess(async (access, _request, response) => {
    // Gating download behind an account is a product decision from the PRD, so
    // it is enforced here rather than by hiding the button.
    requireAccount(access, 'download this project');

    const [room, files] = await Promise.all([
      prisma.room.findUnique({ where: { id: access.roomId }, select: { name: true } }),
      prisma.file.findMany({
        where: { roomId: access.roomId },
        select: { id: true, parentId: true, name: true, type: true, textContent: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
    ]);

    if (!room) {
      response.status(404).json({ error: 'That room no longer exists.' });
      return;
    }

    const archive = createZip(zipEntriesFor(files));
    const filename = pathSegment(room.name).replace(/\s+/g, '-').toLowerCase();

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${filename || 'project'}.zip"`);
    response.send(archive);
  }),
);


