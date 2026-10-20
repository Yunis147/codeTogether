export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
export type NodeType = 'FILE' | 'FOLDER';

/**
 * One entry in a room's file tree. Mirrors `server/src/sync/tree.ts`; both sides
 * read the same `Y.Map`, so the two definitions have to agree.
 */
export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  language: string | null;
  order: number;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  color: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  role: Role;
  updatedAt: string;
  joinedAt?: string;
  ownerName: string;
  memberCount: number;
};

export type RoomDetail = {
  room: { id: string; name: string; updatedAt: string; ownerName: string };
  role: Role;
  guest: boolean;
  identity: { id: string; name: string; color: string };
};

/** Someone currently connected to the room, as reported by Yjs awareness. */
export type Person = {
  clientId: number;
  id: string;
  name: string;
  color: string;
  role: Role;
  guest: boolean;
  /** Which file they have open, when they have told us. */
  fileId: string | null;
  isYou: boolean;
};

export type Member = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  joinedAt: string;
  isYou: boolean;
};

export type ShareLink = {
  id: string;
  token: string;
  role: Exclude<Role, 'OWNER'>;
  createdAt: string;
};

export type SearchMatch = { line: number; column: number; text: string };
export type SearchResult = { fileId: string; name: string; matches: SearchMatch[] };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export function canEdit(role: Role): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}
