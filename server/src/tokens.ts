import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env, isProduction } from './env.js';

/** A registered user, identified by a JWT in an httpOnly cookie. */
export type UserPayload = { kind: 'user'; userId: string; name: string };

/**
 * A guest who opened a share link and entered a display name. Guests are never
 * stored as users; the token itself carries everything they are allowed to do.
 */
export type GuestPayload = {
  kind: 'guest';
  guestId: string;
  /** The share link that granted this session, used to honour revocation. */
  linkId: string;
  roomId: string;
  name: string;
  role: Role;
};

export type TokenPayload = UserPayload | GuestPayload;

export const SESSION_COOKIE = 'ct_session';
const USER_TOKEN_TTL = '7d';
const GUEST_TOKEN_TTL = '12h';

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: payload.kind === 'guest' ? GUEST_TOKEN_TTL : USER_TOKEN_TTL,
  });
}

export function verifyToken(token: string | null | undefined): TokenPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload !== 'object' || payload === null) return null;
    const kind = (payload as { kind?: unknown }).kind;
    return kind === 'user' || kind === 'guest' ? (payload as TokenPayload) : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? ('none' as const) : ('lax' as const),
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
