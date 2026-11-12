import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mocks = vi.hoisted(() => ({ access: vi.fn(), files: vi.fn(), execute: vi.fn(), poll: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { file: { findMany: mocks.files } } }));
vi.mock('../access.js', async (original) => ({ ...await original<typeof import('../access.js')>(), roomAccessFromRequest: mocks.access }));
vi.mock('../judge0.js', async (original) => ({ ...await original<typeof import('../judge0.js')>(), executeProject: mocks.execute, pollExecution: mocks.poll }));
vi.mock('../sync/index.js', () => ({ closeDeletedRoomConnections: vi.fn(), resetRoomIdentityConnections: vi.fn(), resetRoomShareLinkConnections: vi.fn() }));
vi.mock('../chat.js', () => ({ announceRoomRename: vi.fn(), evictFromRoomChat: vi.fn(), evictRoomIdentityFromChat: vi.fn(), evictRoomShareLinkFromChat: vi.fn() }));
import { roomsRouter } from './rooms.js';
import { errorHandler } from './middleware.js';

const app = express();
app.use(express.json()); app.use('/rooms', roomsRouter); app.use(errorHandler);
const server = createServer(app);
let base: string;
let sequence = 0;
let token: string;
const pending = { status: { id: 2, description: 'Processing' }, stdout: null, stderr: null, compileOutput: null, message: null, time: null, memory: null };
const project = { entryFileId: 'file', stdin: '', files: [{ id: 'file', path: 'main.py', language: 'python', content: 'print(1)' }] };

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks(); token = `pending-${++sequence}`;
  mocks.access.mockImplementation((_request, roomId) => ({ roomId, role: 'EDITOR', identityId: 'user', name: 'User', guest: false }));
  mocks.files.mockResolvedValue([{ id: 'file', type: 'FILE', language: 'python', textContent: 'print(1)' }]);
  mocks.execute.mockResolvedValue({ ...pending, token });
  mocks.poll.mockResolvedValue({ ...pending, token: null, status: { id: 3, description: 'Accepted' }, stdout: '1' });
});

async function submit() {
  const response = await fetch(`${base}/rooms/room/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
  });
  expect(response.status).toBe(200);
  return (await response.json()).result;
}

describe('room-scoped pending execution', () => {
  it('retains a pending result until the compiler finishes', async () => {
    expect((await submit()).token).toBe(token);
    mocks.poll.mockResolvedValueOnce({ ...pending, token });
    expect((await (await fetch(`${base}/rooms/room/run/${token}`)).json()).result.token).toBe(token);
    expect((await (await fetch(`${base}/rooms/room/run/${token}`)).json()).result.stdout).toBe('1');
    expect((await fetch(`${base}/rooms/room/run/${token}`)).status).toBe(404);
  });

  it('denies another room and unknown tokens without contacting the compiler', async () => {
    await submit();
    expect((await fetch(`${base}/rooms/other-room/run/${token}`)).status).toBe(404);
    expect((await fetch(`${base}/rooms/room/run/unknown`)).status).toBe(404);
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it('checks current editor access on every result request', async () => {
    await submit(); mocks.access.mockResolvedValue({ roomId: 'room', role: 'VIEWER' });
    expect((await fetch(`${base}/rooms/room/run/${token}`)).status).toBe(403);
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it('expires pending retrieval after 30 minutes', async () => {
    await submit();
    const future = Date.now() + 31 * 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(future);
    try {
      expect((await fetch(`${base}/rooms/room/run/${token}`)).status).toBe(404);
      expect(mocks.poll).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it('respects the selected language before falling back to the extension', async () => {
    mocks.files.mockResolvedValue([{ id: 'file', type: 'FILE', language: 'java', textContent: '' }]);
    await submit();
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ language: 'java' }));
  });
});
