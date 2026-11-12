import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
const mocks = vi.hoisted(() => ({ membership: { upsert: vi.fn() }, user: { findUnique: vi.fn(), create: vi.fn() }, resolve: vi.fn(), currentUser: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: mocks }));
vi.mock('../chat.js', () => ({ updateIdentityInChat: vi.fn() }));
vi.mock('argon2', () => ({ default: { hash: vi.fn(async () => 'test-hash'), verify: vi.fn(async () => true) } }));
vi.mock('../tokens.js', () => ({ SESSION_COOKIE: 'ct_session', sessionCookieOptions: {}, signToken: () => 'test-session',
  verifyToken: (token?: string) => token === 'guest-token' ? { kind: 'guest', roomId: 'room', guestId: 'guest', role: 'EDITOR', linkId: 'link' } : null }));
vi.mock('../access.js', async (original) => ({ ...await original<typeof import('../access.js')>(), currentUser: mocks.currentUser, resolveRoomAccess: mocks.resolve }));
import { AccessError } from '../access.js';
import { authRouter } from './auth.js';
import { errorHandler } from './middleware.js';
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/auth', authRouter); app.use(errorHandler);
  server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.findUnique.mockResolvedValue(null);
  mocks.currentUser.mockReturnValue(null);
  mocks.user.create.mockResolvedValue({ id: 'new-user', name: 'Test User', email: 'test@example.test', avatarUrl: null });
});
describe('authentication failure paths', () => {
  it('does not convert a revoked guest invite into account membership', async () => {
    mocks.resolve.mockRejectedValue(new AccessError('Revoked', 403));
    const response = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.test', password: 'test-password', guestToken: 'guest-token' }) });
    expect(response.status).toBe(201); expect((await response.json()).joinedRoomId).toBeNull();
    expect(mocks.membership.upsert).not.toHaveBeenCalled();
  });
  it('rejects anonymous uploads before writing any files', async () => {
    const before = await readdir('uploads').catch(() => []);
    const form = new FormData(); form.set('photo', new Blob(['<script>attack()</script>'], { type: 'image/png' }), 'attack.html');
    const response = await fetch(`${base}/auth/me/avatar`, { method: 'POST', body: form });
    expect(response.status).toBe(401); expect(await readdir('uploads').catch(() => [])).toEqual(before);
  });
  it('links a valid guest using the current invite role', async () => {
    mocks.resolve.mockResolvedValue({ roomId: 'room', role: 'VIEWER' });
    const response = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.test', password: 'test-password', guestToken: 'guest-token' }) });
    expect(response.status).toBe(201); expect((await response.json()).joinedRoomId).toBe('room');
    expect(mocks.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: 'new-user', roomId: 'room', role: 'VIEWER' } }));
  });
  it('rejects active content from an authenticated upload before writing files', async () => {
    mocks.currentUser.mockReturnValue({ kind: 'user', userId: 'new-user', name: 'Test User' });
    const before = await readdir('uploads').catch(() => []);
    const form = new FormData(); form.set('photo', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'attack.html');
    const response = await fetch(`${base}/auth/me/avatar`, { method: 'POST', body: form });
    expect(response.status).toBe(400); expect(await readdir('uploads').catch(() => [])).toEqual(before);
  });
});
