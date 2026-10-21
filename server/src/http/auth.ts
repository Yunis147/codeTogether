import argon2 from 'argon2';
import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { currentUser } from '../access.js';
import { colorFor } from '../lib/presence.js';
import { prisma } from '../prisma.js';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signToken,
  verifyToken,
} from '../tokens.js';
import { firstIssue, rateLimit, withUser } from './middleware.js';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

const emailField = z
  .string()
  .trim()
  .max(200, 'That email address is too long.')
  .pipe(z.email('Enter a valid email address.'));

const passwordField = z
  .string()
  .min(8, 'Use a password of at least 8 characters.')
  .max(128, 'That password is too long.');

const nameField = z
  .string()
  .trim()
  .min(2, 'Your name needs at least 2 characters.')
  .max(40, 'Your name can be at most 40 characters.');

/**
 * `guestToken` is sent when someone who joined through a share link signs up or
 * logs in mid-session. It is how they keep their place in the room.
 */
const signupSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  guestToken: z.string().optional(),
});

const loginSchema = z.object({
  email: emailField,
  password: passwordField,
  guestToken: z.string().optional(),
});

type PublicUser = { id: string; name: string; email: string; color: string; avatarUrl: string | null };

function publicUser(user: { id: string; name: string; email: string; avatarUrl: string | null }): PublicUser {
  return { id: user.id, name: user.name, email: user.email, color: colorFor(user.id), avatarUrl: user.avatarUrl };
}

const uploadDirectory = path.resolve('uploads');
mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

function setSession(response: Response, user: { id: string; name: string }): void {
  response.cookie(
    SESSION_COOKIE,
    signToken({ kind: 'user', userId: user.id, name: user.name }),
    sessionCookieOptions,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Turns a guest's session into real membership of the room they were already
 * in, so signing up mid-session does not drop them back to an empty dashboard.
 * Returns the room to send them back to.
 */
async function linkGuestSession(userId: string, guestToken?: string): Promise<string | null> {
  const payload = verifyToken(guestToken);
  if (payload?.kind !== 'guest') return null;

  const room = await prisma.room.findUnique({
    where: { id: payload.roomId },
    select: { id: true },
  });
  if (!room) return null;

  await prisma.membership.upsert({
    where: { userId_roomId: { userId, roomId: payload.roomId } },
    create: { userId, roomId: payload.roomId, role: payload.role },
    // Someone who is already a member keeps the role they have: a viewer link
    // must never demote an editor.
    update: {},
  });

  return payload.roomId;
}

authRouter.post('/signup', limiter, async (request, response) => {
  const parsed = signupSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const { name, password, guestToken } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) {
    response.status(409).json({ error: 'An account with that email already exists.' });
    return;
  }

  const passwordHash = await argon2.hash(password);

  let user;
  try {
    user = await prisma.user.create({ data: { name, email, passwordHash } });
  } catch (error) {
    // Only a lost race on the unique email is a 409. Anything else is a real
    // failure and must not be reported as a duplicate account.
    if (!isUniqueViolation(error)) throw error;
    response.status(409).json({ error: 'An account with that email already exists.' });
    return;
  }

  const joinedRoomId = await linkGuestSession(user.id, guestToken);
  setSession(response, user);
  response.status(201).json({ user: publicUser(user), joinedRoomId });
});

authRouter.post('/login', limiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  // The same message either way, so the response cannot be used to find out
  // which email addresses have accounts.
  const invalid = { error: 'Email or password is incorrect.' };
  if (!user) {
    response.status(401).json(invalid);
    return;
  }

  const matches = await argon2.verify(user.passwordHash, parsed.data.password);
  if (!matches) {
    response.status(401).json(invalid);
    return;
  }

  const joinedRoomId = await linkGuestSession(user.id, parsed.data.guestToken);
  setSession(response, user);
  response.json({ user: publicUser(user), joinedRoomId });
});

authRouter.post('/logout', (_request, response) => {
  response.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
  response.status(204).end();
});

authRouter.get('/me', async (request, response) => {
  const payload = currentUser(request);
  if (!payload) {
    response.status(401).json({ error: 'Not signed in.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    // The account was deleted while the cookie was still valid.
    response.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
    response.status(401).json({ error: 'Not signed in.' });
    return;
  }

  response.json({ user: publicUser(user) });
});

const profileSchema = z.object({ name: nameField });

authRouter.post(
  '/me/avatar',
  upload.single('photo'),
  withUser(async (payload, request, response) => {
    if (!request.file) {
      response.status(400).json({ error: 'Choose a PNG, JPEG, WebP, or GIF image under 2 MB.' });
      return;
    }
    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { avatarUrl: `/uploads/${request.file.filename}` },
    });
    response.json({ user: publicUser(user) });
  }),
);

authRouter.patch(
  '/me',
  withUser(async (payload, request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }

    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { name: parsed.data.name },
    });

    // The display name is baked into the session token, so it has to be reissued.
    setSession(response, user);
    response.json({ user: publicUser(user) });
  }),
);
