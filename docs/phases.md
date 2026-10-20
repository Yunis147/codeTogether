# codeTogether: Build Phases

Work through these in order, one at a time. Each phase has a "done when" check. Don't start the next phase until it passes.

## Phase 0: Setup
- Monorepo with `client/` and `server/`, TypeScript strict, linting
- Docker Compose with Postgres, Prisma set up and connected
- **Done when:** one command starts the database, server, and client, and the client loads a placeholder page that talks to the server.

## Phase 1: Single-file sync
- Monaco editor in the client, Yjs + `y-monaco`, Hocuspocus server
- One hardcoded room and file, persisted to Postgres
- **Done when:** two browser tabs edit the same file and stay in sync, and the content is still there after a refresh and after a server restart.

## Phase 2: Auth, rooms, and presence
- Signup and login, JWT in httpOnly cookies
- Create rooms, share links with a role, guest join with a display name
- Roles (owner, editor, viewer) enforced in the Hocuspocus auth hook (viewers are read-only)
- Live cursors, selections, colored name labels, active users panel
- **Done when:** a logged-in user creates a room, a guest joins from the link, both see each other's cursors, and a viewer cannot edit.

## Phase 3: Projects, files, and layout
- VS Code-style layout: icon bar, resizable side panel, editor tabs, status bar
- File tree: create, rename, move, delete files and folders, with real-time sync of the tree
- One Yjs document per file, loaded on open
- Search panel across files
- Rooms panel (My rooms / Shared with me), sign-up popup for guests
- Import and export as zip
- **Done when:** two users build a small multi-file project together, search finds text across files, and deleting a file someone has open shows a banner instead of crashing.

## Phase 4: Reliability and collaboration depth
- Offline editing and reconnect merge, connection state in the status bar
- Per-user undo/redo
- Follow mode
- Share popup with role management, member removal, leave room
- Guest-to-account linking on mid-session signup
- **Done when:** a client goes offline, edits, reconnects, and all clients converge with no lost changes, verified by an automated test.

## Phase 5: Run code
- Judge0 in Docker, API proxy with role check and rate limiting
- Run button and output panel, simple multi-file support
- **Done when:** an editor can run a multi-file Python or Java project and see the output, and a viewer cannot.

## Phase 6: Chat and polish
- In-room chat as a right-side toggle with unread badge and shortcut
- Themes, font size, remembered layout
- Settings and profile panels
- **Done when:** chat works for guests and users, and preferences persist between sessions.

## Phase 7: Tests, deployment, and presentation
- Playwright multi-client tests for concurrent edits, reconnect, and permissions
- Latency measurements with documented conditions
- CI with GitHub Actions
- Deploy frontend, server, and database
- README, architecture diagram, demo video
- **Done when:** the deployed app works end to end and the README explains how to run it and what was measured.

## Optional, after Phase 7
- GitHub integration (OAuth, push, import)
- AI agent as a room participant
