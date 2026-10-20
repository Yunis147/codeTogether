import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readTree, TREE_MAP_KEY } from './tree.js';

describe('sync tree', () => {
  it('normalizes orders before the PostgreSQL mirror is written', () => {
    const doc = new Y.Doc();
    doc.getMap(TREE_MAP_KEY).set('file', {
      id: 'file',
      parentId: null,
      name: 'main.ts',
      type: 'FILE',
      language: 'typescript',
      order: -9_999_999_999,
    });

    expect(readTree(doc)).toEqual([
      expect.objectContaining({ id: 'file', order: 1_410_065_411 }),
    ]);
  });
});
