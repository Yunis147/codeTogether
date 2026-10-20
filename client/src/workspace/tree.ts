import * as Y from 'yjs';
import type { NodeType, TreeNode } from '../types';
import { languageFor } from './language';

export const TREE_MAP_KEY = 'tree';
export const CONTENT_TEXT_KEY = 'monaco';

export function treeMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(TREE_MAP_KEY);
}

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
 * Reads the tree, dropping malformed entries, surfacing orphans at the root and
 * breaking parent cycles. All three can happen from legitimate concurrent edits
 * (a file created inside a folder someone else is deleting, two people moving
 * each other's folders), and the tree is rendered recursively, so a cycle has to
 * be gone before anything draws. Mirrors `server/src/sync/tree.ts`.
 */
export function readTree(doc: Y.Doc): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const [id, value] of treeMap(doc).entries()) {
    const node = asTreeNode(id, value);
    if (node) nodes.push(node);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const rooted = nodes.map((node) =>
    node.parentId && !ids.has(node.parentId) ? { ...node, parentId: null } : node,
  );

  const byId = new Map(rooted.map((node) => [node.id, node]));

  return rooted.map((node) => {
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

/** Folders first, then files, each alphabetically — the VS Code ordering. */
export function childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'FOLDER' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true });
    });
}

export function pathOf(nodes: TreeNode[], id: string): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return segments.join('/');
}

export function descendantsOf(nodes: TreeNode[], id: string): string[] {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const collected: string[] = [];
  const queue = [id];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    collected.push(next);
    for (const child of children.get(next) ?? []) queue.push(child.id);
  }

  return collected;
}

/** True when `candidateParentId` sits inside `id`, which would make the move a cycle. */
export function isInside(nodes: TreeNode[], id: string, candidateParentId: string | null): boolean {
  return candidateParentId !== null && descendantsOf(nodes, id).includes(candidateParentId);
}

export function nameTaken(
  nodes: TreeNode[],
  parentId: string | null,
  name: string,
  ignoreId?: string,
): boolean {
  const target = name.trim().toLowerCase();
  return nodes.some(
    (node) =>
      node.parentId === parentId && node.id !== ignoreId && node.name.toLowerCase() === target,
  );
}

/** Appends " 2", " 3", … or "name 2.ts" until the name is free in that folder. */
export function uniqueName(
  nodes: TreeNode[],
  parentId: string | null,
  name: string,
  ignoreId?: string,
): string {
  if (!nameTaken(nodes, parentId, name, ignoreId)) return name;

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${stem} ${suffix}${extension}`;
    if (!nameTaken(nodes, parentId, candidate, ignoreId)) return candidate;
  }

  return `${stem} ${Date.now()}${extension}`;
}

export function createNode(
  doc: Y.Doc,
  input: { id: string; parentId: string | null; name: string; type: NodeType },
): TreeNode {
  const node: TreeNode = {
    id: input.id,
    parentId: input.parentId,
    name: input.name,
    type: input.type,
    language: input.type === 'FILE' ? languageFor(input.name) : null,
    order: Math.floor(Date.now() % 2_147_483_647),
  };

  treeMap(doc).set(node.id, node);
  return node;
}

function patch(doc: Y.Doc, id: string, changes: Partial<TreeNode>): void {
  const map = treeMap(doc);
  const existing = asTreeNode(id, map.get(id));
  if (!existing) return;

  map.set(id, { ...existing, ...changes });
}

export function renameNode(doc: Y.Doc, id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;

  const existing = asTreeNode(id, treeMap(doc).get(id));
  if (!existing) return;

  patch(doc, id, {
    name: trimmed,
    // A rename changes the language unless it was set by hand in the picker.
    language: existing.type === 'FILE' ? languageFor(trimmed) : null,
  });
}

export function setNodeLanguage(doc: Y.Doc, id: string, language: string): void {
  patch(doc, id, { language });
}

export function moveNode(doc: Y.Doc, id: string, parentId: string | null): void {
  patch(doc, id, { parentId });
}

/**
 * Deletes a node and everything under it in one transaction, so peers see the
 * whole subtree disappear at once rather than a half-deleted tree.
 * Returns every id removed, which the caller uses to close open tabs.
 */
export function deleteNode(doc: Y.Doc, nodes: TreeNode[], id: string): string[] {
  const removed = descendantsOf(nodes, id);

  doc.transact(() => {
    const map = treeMap(doc);
    for (const nodeId of removed) map.delete(nodeId);
  });

  return removed;
}
