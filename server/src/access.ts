import type { Request } from 'express';
import { Role } from '@prisma/client';
import { prisma } from './prisma.js';
import { colorFor } from './lib/presence.js';
import { SESSION_COOKIE, verifyToken, type UserPayload } from './tokens.js';

/**
 * Who someone is inside one room, and what they may do there. Resolved from a
 * session cookie (registered user) or a signed guest token, and used by both the
 * REST routes and the WebSocket sync server so there is one definition of
 * "allowed" rather than two.
 */
export type RoomAccess = {
  roomId: string;
  role: Role;
  name: string;
  color: string;
  guest: boolean;
  /** User id for a registered user, guest id for a guest. */
  identityId: string;
  /** Present only for guests, so a revoked link can drop their live sockets. */
  shareLinkId?: string;
};

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reads one cookie out of the raw headers of a WebSocket upgrade request. */
export function cookieFromHeaders(headers: Headers, name: string): string | null {
  const header = headers.get('cookie');
  if (!header) return null;

  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Bearer token, used by guests who have no cookie or callers passing auth headers. */
export function bearerToken(request: Request): string | null {
  const header = request.header('authorization');
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

export function currentUser(request: Request): UserPayload | null {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[SESSION_COOKIE];
  const payload = token ? verifyToken(token) : null;
  return payload?.kind === 'user' ? payload : null;
}

async function accessForUser(userId: string, name: string, roomId: string): Promise<RoomAccess> {
  const membership = await prisma.membership.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });

  if (!membership) throw new AccessError('You are not a member of this room.', 403);

  return {
    roomId,
    role: membership.role,
    name,
    color: colorFor(userId),
    guest: false,
    identityId: userId,
  };
}

/**
 * Resolves room access from a token and a cookie header. Shared by the sync
 * server, where the guest token arrives as the WebSocket token and a registered
 * user's session arrives as a cookie on the upgrade request.
 */
export async function resolveRoomAccess(
  roomId: string,
  token: string | null,
  cookieHeader: string | null,
): Promise<RoomAccess> {
  const payload = verifyToken(token) ?? verifyToken(cookieHeader);
  if (!payload) throw new AccessError('Sign in or join through a share link.', 401);

  if (payload.kind === 'guest') {
    if (payload.roomId !== roomId) {
      throw new AccessError('This guest link is for a different room.', 403);
    }

    const link = await prisma.shareLink.findFirst({
      where: { id: payload.linkId, roomId, revokedAt: null },
      select: { id: true },
    });
    if (!link) {
      throw new AccessError('This share link is no longer active.', 403);
    }

    return {
      roomId,
      role: payload.role,
      name: payload.name,
      color: colorFor(payload.guestId),
      guest: true,
      identityId: payload.guestId,
      shareLinkId: link.id,
    };
  }

  return accessForUser(payload.userId, payload.name, roomId);
}

/** The REST equivalent: session cookie first, then a guest bearer token. */
export async function roomAccessFromRequest(request: Request, roomId: string): Promise<RoomAccess> {
  const user = currentUser(request);
  if (user) return accessForUser(user.userId, user.name, roomId);

  const guest = verifyToken(bearerToken(request));
  if (guest?.kind === 'guest' && guest.roomId === roomId) {
    const link = await prisma.shareLink.findFirst({
      where: { id: guest.linkId, roomId, revokedAt: null },
      select: { id: true },
    });
    if (!link) throw new AccessError('This share link is no longer active.', 403);

    return {
      roomId,
      role: guest.role,
      name: guest.name,
      color: colorFor(guest.guestId),
      guest: true,
      identityId: guest.guestId,
      shareLinkId: link.id,
    };
  }

  throw new AccessError('Sign in or join through a share link.', 401);
}

export function canEdit(access: RoomAccess): boolean {
  return access.role === Role.OWNER || access.role === Role.EDITOR;
}

export const ROLE_RANK: Record<Role, number> = {
  [Role.VIEWER]: 0,
  [Role.EDITOR]: 1,
  [Role.OWNER]: 2,
};

/** Used when a share link grants a role to someone who is already a member. */
export function strongerRole(a: Role, b: Role): Role {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}
