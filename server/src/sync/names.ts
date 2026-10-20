/**
 * Document naming. Every Yjs document belongs to exactly one room, and the room
 * id is encoded in the name so `onAuthenticate` can check access before any
 * content is loaded.
 *
 *   room:<roomId>:tree            the file tree, plus room-wide presence
 *   room:<roomId>:file:<fileId>   one file's content, loaded when it is opened
 */

export type DocumentTarget =
  | { kind: 'tree'; roomId: string }
  | { kind: 'file'; roomId: string; fileId: string };

// cuid ids are lowercase alphanumeric; generated node ids may also contain
// dashes and underscores.
const TREE_NAME = /^room:([A-Za-z0-9_-]+):tree$/;
const FILE_NAME = /^room:([A-Za-z0-9_-]+):file:([A-Za-z0-9_-]+)$/;

export function treeDocumentName(roomId: string): string {
  return `room:${roomId}:tree`;
}

export function fileDocumentName(roomId: string, fileId: string): string {
  return `room:${roomId}:file:${fileId}`;
}

export function parseDocumentName(name: string): DocumentTarget | null {
  const tree = TREE_NAME.exec(name);
  if (tree) return { kind: 'tree', roomId: tree[1] };

  const file = FILE_NAME.exec(name);
  if (file) return { kind: 'file', roomId: file[1], fileId: file[2] };

  return null;
}
