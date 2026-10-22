import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  AccessError,
  currentUser,
  roomAccessFromRequest,
  type RoomAccess,
} from '../access.js';
import { Judge0Error } from '../judge0.js';
import type { UserPayload } from '../tokens.js';

type Handler = (request: Request, response: Response) => Promise<void> | void;

/** Wraps a handler that needs a signed-in user, rather than reading `res.locals`. */
export function withUser(
  handler: (user: UserPayload, request: Request, response: Response) => Promise<void> | void,
): Handler {
  return async (request, response) => {
    const user = currentUser(request);
    if (!user) {
      response.status(401).json({ error: 'Sign in to continue.' });
      return;
    }
    await handler(user, request, response);
  };
}

/**
 * Wraps a handler that needs access to `:roomId`, resolved from a session
 * cookie or a guest token. Throws `AccessError`, which the error handler turns
 * into the right status, so no route forgets the check.
 */
export function withRoomAccess(
  handler: (access: RoomAccess, request: Request, response: Response) => Promise<void> | void,
): Handler {
  return async (request, response) => {
    const access = await roomAccessFromRequest(request, String(request.params.roomId));
    await handler(access, request, response);
  };
}

export function firstIssue(error: ZodError, fallback = 'Check the submitted values.'): string {
  return error.issues[0]?.message ?? fallback;
}

/**
 * A small fixed-window limiter, enough to blunt credential stuffing and share
 * link guessing on a single-instance deployment. Redis-backed limiting belongs
 * with the decision to run more than one instance.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastCleanup = Date.now();

  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now();

    // Periodic sweep rather than full map traversal on every request
    if (now - lastCleanup > 30_000 || hits.size > 5_000) {
      lastCleanup = now;
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(key);
      }
    }

    const key = request.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
    }
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      const seconds = Math.max(Math.ceil((entry.resetAt - now) / 1000), 1);
      response.setHeader('Retry-After', String(seconds));
      response.status(429).json({ error: `Too many attempts. Try again in ${seconds}s.` });
      return;
    }

    next();
  };
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AccessError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof Judge0Error) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ error: firstIssue(error) });
    return;
  }

  console.error('Unhandled request error.', error);
  response.status(500).json({ error: 'Something went wrong on our end.' });
}
