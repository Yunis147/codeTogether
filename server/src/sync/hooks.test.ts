import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
const mocks = vi.hoisted(() => ({ mirror: vi.fn(), store: vi.fn(), room: vi.fn(), access: vi.fn(), retryStore: vi.fn() }));
vi.mock('@hocuspocus/server', () => ({ Server: class {
  configuration: unknown;
  hocuspocus = { documents: new Map(), storeDocumentHooks: mocks.retryStore };
  constructor(configuration: unknown) { this.configuration = configuration; }
} }));
vi.mock('../env.js', () => ({ isProduction: true, env: { SYNC_PORT: 1234, NODE_ENV: 'production', CLIENT_ORIGIN: 'https://app.example' } }));
vi.mock('../prisma.js', () => ({ prisma: { room: { findUnique: mocks.room } } }));
vi.mock('../access.js', () => ({ cookieFromHeaders: () => 'secret-session', resolveRoomAccess: mocks.access }));
vi.mock('./tree.js', () => ({ CONTENT_TEXT_KEY: 'monaco', mirrorTree: mocks.mirror, storeFileContent: mocks.store }));
import { syncServer } from './index.js';
type Hooks = {
  onStoreDocument: (data: { documentName: string; document: Y.Doc }) => Promise<void>;
  onUpgrade: (data: { request: { headers: { origin: string } } }) => Promise<void>;
  onAuthenticate: (data: { documentName: string; token: string; requestHeaders: Record<string, string>; connectionConfig: object }) => Promise<unknown>;
};
const hooks = (syncServer as unknown as { configuration: Hooks }).configuration;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.room.mockResolvedValue({ id: 'room' });
  mocks.mirror.mockReset().mockResolvedValue(undefined);
  mocks.retryStore.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  syncServer.hocuspocus.documents.clear();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers(); vi.restoreAllMocks();
});
describe('sync failure handling', () => {
  it('rejects storage failures so Hocuspocus retains the document', async () => {
    const error = new Error('database offline'); mocks.mirror.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(hooks.onStoreDocument({ documentName: 'room:room:tree', document: new Y.Doc() })).rejects.toThrow('database offline');
    log.mockRestore();
  });
  it('ignores only an actually deleted room', async () => {
    mocks.mirror.mockRejectedValue(new Error('deleted')); mocks.room.mockResolvedValue(null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(hooks.onStoreDocument({ documentName: 'room:room:tree', document: new Y.Doc() })).resolves.toBeUndefined();
    log.mockRestore();
  });
  it('retries a retained document when storage recovers, even if the existence check also failed', async () => {
    const documentName = 'room:room:tree'; const document = new Y.Doc();
    syncServer.hocuspocus.documents.set(documentName, document as never);
    const payload = { documentName, document };
    mocks.mirror.mockRejectedValueOnce(new Error('database offline'));
    mocks.room.mockRejectedValueOnce(new Error('database offline'));
    mocks.retryStore.mockImplementation(async (_document, data) => { await hooks.onStoreDocument(data); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(hooks.onStoreDocument(payload)).rejects.toThrow('database offline');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.retryStore).toHaveBeenCalledWith(document, payload, true);
    expect(mocks.mirror).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an obsolete retry after a newer successful save', async () => {
    const payload = { documentName: 'room:room:tree', document: new Y.Doc() };
    syncServer.hocuspocus.documents.set(payload.documentName, payload.document as never);
    mocks.mirror.mockRejectedValueOnce(new Error('database offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(hooks.onStoreDocument(payload)).rejects.toThrow();
    await hooks.onStoreDocument(payload);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.retryStore).not.toHaveBeenCalled();
  });
  it('rejects untrusted WebSocket origins', async () => {
    await expect(hooks.onUpgrade({ request: { headers: { origin: 'https://evil.example' } } })).rejects.toThrow('origin denied');
  });
  it('never includes a raw session token in authentication logs', async () => {
    mocks.access.mockRejectedValue(new Error('no access'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(hooks.onAuthenticate({ documentName: 'room:room:tree', token: '', requestHeaders: {}, connectionConfig: {} })).rejects.toThrow();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-session'); log.mockRestore();
  });
});
