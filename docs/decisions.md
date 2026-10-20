# codeTogether: Decisions Log

Append-only. One entry per meaningful decision. Add new entries at the bottom.

Format:
```
## YYYY-MM-DD: Short title
- Decision: what was chosen
- Why: the reason
- Alternatives: what else was considered
```

---

## 2026-10-11: TypeScript over JavaScript
- Decision: TypeScript (strict) on both client and server.
- Why: Yjs, Hocuspocus, Monaco, and Prisma are TypeScript-first. Shared shapes (roles, tree nodes, messages) are easier to keep consistent with types, and refactoring the file tree logic is safer.
- Alternatives: plain JavaScript.

## 2026-10-11: PostgreSQL + Prisma over MongoDB
- Decision: PostgreSQL with Prisma.
- Why: the data is relational (users, rooms, memberships with roles, a file tree). Foreign keys, unique constraints, cascading deletes, and transactions help. Search is built in.
- Alternatives: MongoDB with Mongoose. It would work, but needs manual cascades and has weaker search.

## 2026-10-11: Yjs + Hocuspocus, no custom CRDT
- Decision: use Yjs for sync and Hocuspocus as the WebSocket server.
- Why: mature, proven implementation. Our effort goes into persistence, auth, reconnects, and testing. Hocuspocus has auth and persistence hooks.
- Alternatives: `y-websocket`, writing our own CRDT or OT (possible as a separate side experiment later).

## 2026-10-11: No Redis at first
- Decision: skip Redis initially.
- Why: a single server instance doesn't need it. Add it only if scaling to multiple instances.

## 2026-10-11: Hybrid guest access
- Decision: guests join via share link with a display name (signed short-lived token). Creating rooms, saving to an account, and downloading require login.
- Why: forcing signup kills the "send a friend a link" flow. Guests are not stored as users.

## 2026-10-11: Run code through Judge0, no terminal
- Decision: a Run button backed by Judge0. No in-browser terminal.
- Why: a real terminal means a shell per user on our server (security and infrastructure risk). Judge0 gives sandboxed execution.

## 2026-10-11: GitHub integration is optional and later
- Decision: GitHub OAuth, push, and import come after the core phases, if time allows.
- Why: not needed for the core product. A "Push to GitHub" button via API is simpler and safer than a terminal.

## 2026-10-11: VS Code-style layout
- Decision: icon bar plus a resizable side panel, editor always visible, chat as a right-side toggle.
- Why: developers already know it. Only the side panel changes between tabs, so the editor is never disrupted.
- Alternatives: separate pages for files, search, and rooms.

## 2026-10-12: npm workspaces for the Phase 0 monorepo
- Decision: use npm workspaces for `client/` and `server/`, with a root `npm run dev` launcher that starts PostgreSQL through Docker Compose, prepares the Prisma schema, and starts both development servers.
- Why: npm and Node.js are already available in the development environment, and the repository needs one documented command for the Phase 0 local stack.
- Alternatives: separate package installs or a third-party monorepo tool.

## 2026-10-12: PostgreSQL stores encoded Yjs state in Phase 1
- Decision: persist the one Phase 1 document as an encoded Yjs update in a `CollaborativeDocument` table through Hocuspocus load and store hooks.
- Why: Yjs updates preserve concurrent-edit history and can merge correctly after reconnecting. Hocuspocus debounces writes, and the binary state survives both browser refreshes and server restarts.
- Alternatives: storing plain text and recreating a Yjs document, which would lose the CRDT state needed for correct merging; adding a full room and file schema before Phase 3.

## 2026-10-12: Cookie sessions for users, signed tokens for guests
- Decision: registered users authenticate with a JWT in an httpOnly cookie; guests receive a short-lived signed token after entering a display name through a share link.
- Why: browser cookies keep the registered-user credential inaccessible to frontend code, while guest tokens carry only the temporary room access that the WebSocket provider needs.
- Alternatives: storing user JWTs in local storage, which exposes them to script access; persisting guests as database users.

## 2026-10-12: One collaborative document per room in Phase 2
- Decision: each new room has one persisted `main.ts` Yjs document. The file tree remains a later Phase 3 concern.
- Why: this lets rooms, roles, guest links, cursors, and permission enforcement be fully real without prematurely creating the multi-file synchronization design.
- Alternatives: keeping a global Phase 1 document, or implementing the entire project tree early.

## 2026-10-13: Viewer read-only is set in `onAuthenticate`, not `connected`
- Decision: set `connectionConfig.readOnly = true` inside the Hocuspocus `onAuthenticate` hook instead of assigning `connection.readOnly` in the `connected` hook.
- Why: Hocuspocus replays a client's queued messages into the new `Connection` *before* it awaits the `connected` hook, and it constructs that `Connection` from `connectionConfig.readOnly`. Assigning in `connected` therefore leaves a window in which a viewer's first sync messages are applied as writes. `connectionConfig.readOnly` is also the value sent to the client in the `authenticated` frame, so setting it there additionally lets the client's provider know it is read-only.
- Alternatives: keeping the `connected` assignment and additionally rejecting writes in `beforeHandleMessage`, which duplicates the check the library already performs.

## 2026-10-13: The file tree is a flat `Y.Map` in a room-level document
- Decision: real-time tree structure lives in one room-level Yjs document named `room:<roomId>:tree`, holding a single `Y.Map` of nodes keyed by node id. Each value is a plain object `{ id, parentId, name, type, language, order }`. Parentage is a field, not nesting. File *content* stays in its own document per file, `room:<roomId>:file:<fileId>`, loaded only when the file is opened.
- Why: a flat map makes every tree operation a single-key write, so concurrent operations on different nodes can never conflict, and a rename and a move of the same node converge on last-writer-wins for that one key instead of corrupting a nested structure. Nesting the tree inside nested `Y.Map`s would make "move a folder" a delete-plus-recreate, which loses any concurrent edit inside the moved subtree.
- Deletes: the deleting client removes the node and all its descendants in one transaction. Because a peer can concurrently create a child under a folder that is being deleted, readers treat a node whose `parentId` is absent from the map as a root-level node rather than dropping it. The tree therefore never silently loses a file.
- Alternatives: nested `Y.Map`s (bad move semantics, as above); keeping the tree only in Postgres and broadcasting invalidations (loses offline tree edits and needs its own conflict rules); one `Y.Array` per folder (ordering is nicer but moves span two documents).

## 2026-10-13: Postgres is a mirror of the tree, not its source of truth
- Decision: Yjs is authoritative for both tree structure and file content. The server mirrors into the `File` table from the Hocuspocus store hooks: storing the tree document upserts and prunes `File` rows, and storing a file document writes that row's `ydocState` plus a plain-text `textContent` copy.
- Why: search and zip export need to read a whole project without loading every file's Yjs document into memory, which `architecture.md` already calls for. Keeping Postgres a derived mirror means the CRDT stays the single source of truth and a mirroring bug can never lose an edit.
- Alternatives: querying live Yjs documents for search (needs every document loaded, and `architecture.md` explicitly rules it out); writing tree changes through a REST API instead of Yjs (no offline tree edits, and two conflicting paths to the same state).

## 2026-10-13: `File` replaces `CollaborativeDocument`; Phase 2 room content is not migrated
- Decision: drop the Phase 1/2 `CollaborativeDocument` table in favour of the `File` model from `architecture.md`, and move the tree document's snapshot onto `Room.treeState`. The project uses `prisma db push`, so applying this drops existing rows.
- Why: `CollaborativeDocument` hard-codes one document per room and carries a `name` column that only ever held a derived value, and room creation had to write it in two non-atomic steps because the room id was not known first. Keeping both tables would mean two code paths for loading a document.
- Cost: code typed into rooms during Phase 2 development is lost on the next `npm run dev`. Accepted because this is local development data only.
- Alternatives: keeping the old table alongside `File` and reading from whichever exists; writing a real migration to copy each room's single document into a `main.ts` `File` row, which is more code than the development data is worth.

## 2026-10-13: Phase 3 and 4 built in one pass, at the user's request
- Decision: implement Phase 3 in full and the parts of Phase 4 that the Phase 3 layout already requires (connection state in the status bar, per-user undo/redo, follow mode, share popup with role management and member removal, leave room, guest-to-account linking), instead of stopping at the Phase 3 "done when" check.
- Why: the user asked for as many phases as possible in one session. The Phase 4 items listed above are each a small addition on top of structures Phase 3 introduces anyway (the status bar, the awareness panel, the share dialog), so splitting them out would mean touching the same files twice.
- Not included: offline/reconnect automated tests and latency measurement (Phase 4's actual "done when"), Judge0 execution (Phase 5), chat (Phase 6), and deployment (Phase 7).
- Alternatives: the one-phase-at-a-time rule in `CLAUDE.md`, which the user explicitly overrode for this session.

## 2026-10-13: No new runtime dependencies for layout, routing, or zip
- Decision: implement the resizable side panel, the router, and zip import/export without adding `react-resizable-panels`, `react-router`, `zustand`, or `jszip`. The panel is a pointer-drag handle, routing is a small `history.pushState` hook, shared state is React context, and zip handling uses Node's built-in `zlib` on the server.
- Why: the development sandbox has no reliable package-registry access, so adding dependencies could not be verified in this session. Each replaced library covers a small, well-understood surface here, and the zip work belongs on the server anyway because export reads `File.textContent` straight from Postgres.
- Revisit: if the client's state handling outgrows context, Zustand is still the right call per `architecture.md`. This decision is about what could be installed today, not about the long-term stack.
- Alternatives: adding the dependencies from `architecture.md` as written, which stays the plan once the registry is reachable.

## 2026-10-14: UI architecture overhaul and Phase 3/4 completion
- Decision: Rebuilt `App.tsx` into a clean routed application integrating all Phase 3 and Phase 4 components (`RoomProvider`, `FilesPanel`, `EditorTabs`, `SearchPanel`, `RoomsPanel`, `CollaboratorList`, `SettingsPanel`), replaced image-based rail icons with stroked SVG icons, crafted a design-token CSS system with VS Code-inspired dark and light theme palettes, set up the Vite `/sync` WebSocket proxy, and connected model-swapping in `RoomProvider` to single-instance Monaco binding.
- Why: `App.tsx` was still running the legacy Phase 2 monolithic layout despite Phase 3/4 components existing in the codebase, and the UI styling needed to reach a clean, professional VS Code-level standard without broken assets or dead code.
- Alternatives: Mounting multiple Monaco editor instances simultaneously in tabs (which wasted memory and caused binding synchronization race conditions).

## 2026-10-20: Reset stale room connections after an access change
- Decision: when an owner changes a member's role or removes them, close that identity's active Hocuspocus document connections for the room.
- Why: Hocuspocus applies read-only status when it authenticates a connection. Without a reset, an already-connected editor could keep its former write permission until it reconnects.
- Alternatives: recheck database membership for every Yjs update, which adds a database query to the hot sync path; closing every room participant's connection, which disrupts collaborators who were unaffected.

## 2026-10-20: Guard globally keyed file mirrors by room
- Decision: keep the existing global `File.id` primary key and reject a tree or file update when its ID already belongs to another room.
- Why: this prevents a client-controlled Yjs tree from overwriting metadata in another room without requiring a potentially disruptive primary-key migration for existing local databases.
- Alternatives: changing `File` to a composite `[roomId, id]` primary key now, which Prisma correctly flags as a potentially partial data-loss migration; trusting client-generated UUIDs alone.

## 2026-10-20: Vitest regression coverage for tree and offline convergence
- Decision: add Vitest to both workspaces with regression tests for tree order normalization, cycle rendering safety, and offline Yjs convergence.
- Why: Phase 4 requires an automated test proving offline edits converge after reconnecting, and the project previously had no test runner.
- Alternatives: relying on manual two-tab verification, which cannot reliably catch regressions in CRDT merge behavior.

## 2026-10-20: Guest sessions are tied to their share link
- Decision: guest JWTs include the id of the share link that granted the session. The access layer verifies that link remains active, and revoking a link closes the affected guest sync connections.
- Why: a signed guest token otherwise retains access until expiry after the owner has revoked its link.
- Alternatives: accepting the token until its expiry, or querying share-link status for every individual Yjs update.

## 2026-10-20: The router is the single owner of default-room entry
- Decision: ordinary account sign-in and sign-up let the root router select or create a default room. Authentication only navigates directly when it returns a guest-linked room id.
- Why: overlapping workspace-entry effects could create two rooms for a new account and leave an invited guest in the first room while the owner was moved to the second.
- Alternatives: keeping several independently triggered entry effects and trying to coordinate their asynchronous requests with component-local flags.
