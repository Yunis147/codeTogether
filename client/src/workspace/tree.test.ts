import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNode, readTree, restoreNodes, treeMap } from './tree';

describe('workspace tree', () => {
  it('keeps file ordering inside the Prisma Int range', () => {
    const doc = new Y.Doc();

    const node = createNode(doc, {
      id: 'new-file',
      parentId: null,
      name: 'main.ts',
      type: 'FILE',
    });

    expect(node.order).toBeGreaterThanOrEqual(0);
    expect(node.order).toBeLessThan(2_147_483_647);
  });

  it('normalizes malformed order values and safely surfaces cycles at the root', () => {
    const doc = new Y.Doc();
    const tree = treeMap(doc);

    tree.set('a', {
      id: 'a',
      parentId: 'b',
      name: 'a.ts',
      type: 'FILE',
      language: 'typescript',
      order: -9_999_999_999,
    });
    tree.set('b', {
      id: 'b',
      parentId: 'a',
      name: 'folder',
      type: 'FOLDER',
      language: null,
      order: 2_147_483_648,
    });

    const nodes = readTree(doc);

    expect(nodes).toEqual([
      expect.objectContaining({ id: 'a', parentId: null, order: 1_410_065_411 }),
      expect.objectContaining({ id: 'b', parentId: null, order: 1 }),
    ]);
  });

  it('restores multiple nodes atomically preserving folder hierarchy and clamping order', () => {
    const doc = new Y.Doc();

    const parentFolder = {
      id: 'folder-1',
      parentId: null,
      name: 'src',
      type: 'FOLDER' as const,
      language: null,
      order: 100,
    };
    const childFile = {
      id: 'file-1',
      parentId: 'folder-1',
      name: 'index.ts',
      type: 'FILE' as const,
      language: 'typescript',
      order: 200,
    };

    restoreNodes(doc, [parentFolder, childFile]);

    const restored = readTree(doc);
    expect(restored).toHaveLength(2);
    expect(restored.find((n) => n.id === 'folder-1')).toBeDefined();
    expect(restored.find((n) => n.id === 'file-1')?.parentId).toBe('folder-1');
  });
});
