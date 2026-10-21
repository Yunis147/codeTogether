import * as Y from 'yjs';
import { NodeType } from '@prisma/client';
import { prisma } from '../prisma.js';

/** Key of the `Y.Map` inside a room's tree document. */
export const TREE_MAP_KEY = 'tree';

/** Key of the `Y.Text` inside a file's content document. Matches y-monaco's usage. */
export const CONTENT_TEXT_KEY = 'monaco';

export type TreeNodeType = 'FILE' | 'FOLDER';

/**
 * One entry in the room's file tree. Parentage is a field rather than nesting,
 * so creating, renaming, moving and deleting are each a single-key write and
 * concurrent operations on different nodes can never conflict.
 */
export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: TreeNodeType;
  language: string | null;
  order: number;
};

export const STARTER_FILE_NAME = 'main.ts';
export const STARTER_FILE_LANGUAGE = 'typescript';
export const STARTER_CODE = [
  '// Welcome to codeTogether',
  '// One room. Many minds. Better code.',
  '',
  'function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
  '',
  "console.log(greet('codeTogether'));",
  '',
].join('\n');

function asTreeNode(id: string, value: unknown): TreeNode | null {
  if (typeof value !== 'object' || value === null) return null;
  const node = value as Record<string, unknown>;

  const type = node.type;
  if (type !== 'FILE' && type !== 'FOLDER') return null;

  const name = typeof node.name === 'string' ? node.name.trim() : '';
  if (!name) return null;

  return {
    id,
    parentId: typeof node.parentId === 'string' && node.parentId.length > 0 ? node.parentId : null,
    name,
    type,
    language: typeof node.language === 'string' ? node.language : null,
    order:
      typeof node.order === 'number' && Number.isFinite(node.order)
        ? Math.floor(Math.abs(node.order)) % 2_147_483_647
        : 0,
  };
}

/**
 * Re-parents any node whose ancestry loops back on itself. Two peers moving
 * each other's folders at the same time can produce a cycle, and the client
 * renders the tree recursively, so a cycle has to be broken before it is read.
 */
function breakCycles(nodes: TreeNode[]): TreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return nodes.map((node) => {
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;

    while (parentId) {
      if (seen.has(parentId)) return { ...node, parentId: null };
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }

    return node;
  });
}

/**
 * Reads the tree out of a Yjs document, dropping malformed entries and
 * re-parenting orphans to the root. An orphan is a legitimate outcome: one peer
 * can create a file inside a folder that another peer is deleting at the same
 * moment. Surfacing it at the root keeps the file instead of losing it.
 */
export function readTree(doc: Y.Doc): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const [id, value] of doc.getMap(TREE_MAP_KEY).entries()) {
    const node = asTreeNode(id, value);
    if (node) nodes.push(node);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const rooted = nodes.map((node) =>
    node.parentId && !ids.has(node.parentId) ? { ...node, parentId: null } : node,
  );

  return breakCycles(rooted);
}

/** Builds the tree document a brand new room starts with: one file at the root. */
export function createStarterTree(fileId: string): Y.Doc {
  const doc = new Y.Doc();
  const node: TreeNode = {
    id: fileId,
    parentId: null,
    name: STARTER_FILE_NAME,
    type: 'FILE',
    language: STARTER_FILE_LANGUAGE,
    order: 0,
  };
  doc.getMap(TREE_MAP_KEY).set(fileId, node);
  return doc;
}

/** Builds the content document a brand new room's first file starts with. */
export function createStarterContent(): Y.Doc {
  const doc = new Y.Doc();
  doc.getText(CONTENT_TEXT_KEY).insert(0, STARTER_CODE);
  return doc;
}

/**
 * Mirrors a room's tree document into the `File` table. Yjs stays the source of
 * truth; these rows exist so search and zip export can read a whole project
 * from SQL without loading every file's document into memory.
 */
export async function mirrorTree(roomId: string, doc: Y.Doc): Promise<void> {
  const nodes = readTree(doc);
  const keep = nodes.map((node) => node.id);
  const treeState = Buffer.from(Y.encodeStateAsUpdate(doc));

  // IDs originate in a client-owned Yjs tree. They are normally UUIDs, but
  // never trust a client to preserve global uniqueness: without this check an
  // update in one room could overwrite metadata for a mirrored file elsewhere.
  if (keep.length > 0) {
    const existing = await prisma.file.findMany({
      where: { id: { in: keep } },
      select: { id: true, roomId: true },
    });
    const collision = existing.find((file) => file.roomId !== roomId);
    if (collision) {
      throw new Error(`File id ${collision.id} already belongs to another room.`);
    }
  }

  await prisma.$transaction([
    prisma.room.update({ where: { id: roomId }, data: { treeState } }),
    prisma.file.updateMany({
      where: { roomId, deletedAt: null, ...(keep.length > 0 ? { id: { notIn: keep } } : {}) },
      data: { deletedAt: new Date() },
    }),
    ...nodes.map((node) =>
      prisma.file.upsert({
        where: { id: node.id },
        create: {
          id: node.id,
          roomId,
          parentId: node.parentId,
          name: node.name,
          type: node.type as NodeType,
          language: node.language,
          order: Math.floor(Math.abs(node.order || 0)) % 2_147_483_647,
          deletedAt: null,
        },
        // Content columns are deliberately untouched: they are written by the
        // file's own document, which stores on its own schedule.
        update: {
          parentId: node.parentId,
          name: node.name,
          type: node.type as NodeType,
          language: node.language,
          order: Math.floor(Math.abs(node.order || 0)) % 2_147_483_647,
          deletedAt: null,
        },
      }),
    ),
  ]);
}

/**
 * Writes one file's Yjs snapshot plus a plain-text copy for search.
 *
 * The row may not exist yet: a file is created in the tree document, which
 * stores on a debounce, so content can arrive first. The placeholder name is
 * corrected by the next tree mirror, and a row for a node that was never in the
 * tree is pruned by that same mirror.
 */
export async function storeFileContent(roomId: string, fileId: string, doc: Y.Doc): Promise<void> {
  const textContent = doc.getText(CONTENT_TEXT_KEY).toString();
  const ydocState = Buffer.from(Y.encodeStateAsUpdate(doc));

  const existing = await prisma.file.findUnique({
    where: { id: fileId },
    select: { roomId: true },
  });

  if (existing && existing.roomId !== roomId) {
    throw new Error(`File id ${fileId} already belongs to another room.`);
  }

  // A file update can arrive before the tree's debounced mirror. The
  // placeholder is filled in with the real name, parent and language by the
  // next tree store.
  await prisma.file.upsert({
    where: { id: fileId },
    create: { id: fileId, roomId, name: fileId, type: NodeType.FILE, ydocState, textContent },
    update: { ydocState, textContent },
  });
}
