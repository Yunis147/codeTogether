import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
const mocks = vi.hoisted(() => ({ file: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() }, room: { update: vi.fn() } }));
vi.mock('../prisma.js', () => ({ prisma: { ...mocks, $transaction: async (run: (tx: typeof mocks) => Promise<void>) => run(mocks) } }));
import { mirrorTree, storeFileContent } from './tree.js';

beforeEach(() => {
  vi.clearAllMocks(); mocks.file.findMany.mockResolvedValue([]);
  mocks.file.updateMany.mockResolvedValue({ count: 1 }); mocks.file.findUnique.mockResolvedValue(null);
});

describe('ordered and room-scoped persistence', () => {
  it('serializes snapshots so an older save cannot finish after a newer save', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.file.findMany.mockImplementationOnce(() => blocked.then(() => []));
    const doc = new Y.Doc();
    doc.getMap('tree').set('f', { type: 'FILE', name: 'old.py' });
    const first = mirrorTree('room', doc);
    await Promise.resolve();
    doc.getMap('tree').set('f', { type: 'FILE', name: 'new.py' });
    const second = mirrorTree('room', doc);
    release(); await Promise.all([first, second]);
    const saved = mocks.room.update.mock.calls.at(-1)![0].data.treeState;
    const restored = new Y.Doc(); Y.applyUpdate(restored, saved);
    expect(restored.getMap('tree').get('f')).toMatchObject({ name: 'new.py' });
  });
  it('never recreates a permanently deleted file from its late content save', async () => {
    mocks.file.updateMany.mockResolvedValue({ count: 0 });
    const doc = new Y.Doc(); doc.getText('monaco').insert(0, 'offline edit');
    await storeFileContent('room', 'deleted', doc);
    expect(mocks.file.createMany).not.toHaveBeenCalled();
    expect(mocks.file.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'deleted', roomId: 'room', type: 'FILE' } }));
  });
  it('rejects a collision that appears after the tree precheck', async () => {
    mocks.file.updateMany.mockResolvedValue({ count: 0 });
    const doc = new Y.Doc(); doc.getMap('tree').set('foreign', { type: 'FILE', name: 'main.py' });
    await expect(mirrorTree('own-room', doc)).rejects.toThrow('another room');
    expect(mocks.room.update).not.toHaveBeenCalled();
    expect(mocks.file.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
  it('propagates database failures', async () => {
    mocks.file.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(storeFileContent('room', 'f', new Y.Doc())).rejects.toThrow('database unavailable');
  });
});
