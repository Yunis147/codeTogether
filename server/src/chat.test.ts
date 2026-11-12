import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), history: vi.fn(), create: vi.fn() }));
vi.mock('./prisma.js', () => ({ prisma: { chatMessage: { findMany: mocks.history, create: mocks.create } } }));
vi.mock('./access.js', async (original) => ({ ...await original<typeof import('./access.js')>(), resolveRoomAccess: mocks.resolve }));
vi.mock('./env.js', () => ({ isProduction: true, env: { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://app.example' } }));
import { createChatServer } from './chat.js';

const access = { roomId: 'room', role: 'EDITOR', identityId: 'user', name: 'Test User', color: '#a78bfa', guest: false, avatarUrl: null };
const http = createServer();
const server = createChatServer(http);
let base: string;
let client: Socket;

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(access);
  mocks.history.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: 'message', createdAt: new Date() }));
  client = io(base, { transports: ['websocket'], extraHeaders: { Origin: 'https://app.example' }, reconnection: false });
  await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
});
afterEach(() => { client.disconnect(); });

describe('chat event failure paths', () => {
  it('ignores missing or invalid acknowledgements without database writes or crashing', async () => {
    client.emit('chat:join', { roomId: 'room' });
    client.emit('chat:send', { content: 'ignored' }, 'invalid callback');
    expect(await client.timeout(2_000).emitWithAck('chat:join', { roomId: 'room' })).toEqual({ ok: true });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('limits concurrent sends before their asynchronous access checks finish', async () => {
    await client.timeout(2_000).emitWithAck('chat:join', { roomId: 'room' });
    const resolvers: (() => void)[] = [];
    mocks.resolve.mockImplementation(() => new Promise((resolve) => { resolvers.push(() => resolve(access)); }));
    const sends = Array.from({ length: 12 }, () => client.timeout(2_000).emitWithAck('chat:send', { content: 'message' }));
    const limited = await client.timeout(2_000).emitWithAck('chat:send', { content: 'too many' });
    expect(limited).toMatchObject({ ok: false, error: expect.stringContaining('wait') });
    expect(resolvers).toHaveLength(12);
    resolvers.forEach((resolve) => resolve());
    expect(await Promise.all(sends)).toEqual(Array.from({ length: 12 }, () => ({ ok: true })));
    expect(mocks.create).toHaveBeenCalledTimes(12);
  });
});
