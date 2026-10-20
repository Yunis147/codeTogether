# codeTogether: Architecture

This is a starting point, not a contract. If something here turns out wrong, change it and log the reason in `decisions.md`.

## Overview

```
React + TypeScript (Vite)
  Monaco + Yjs (y-monaco)  <--WebSocket-->  Hocuspocus server (Yjs sync, auth, persistence)
  REST (auth, rooms, files, search)  --->   Express API  ---> PostgreSQL (Prisma)
  Chat                       <--Socket.IO--> Chat server
  Run button                 --->  Express API --> Judge0 (Docker)
```

Hocuspocus and Express can live in the same Node process at first. Split them only if there's a reason.

## Stack

| Area | Choice |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind, Zustand, React Router, `react-resizable-panels` |
| Editor | Monaco Editor, Yjs, `y-monaco` |
| Sync server | Hocuspocus (Yjs WebSocket server with auth and persistence hooks) |
| API | Node.js, TypeScript, Express, zod for validation |
| Chat | Socket.IO |
| Database | PostgreSQL with Prisma |
| Auth | JWT in httpOnly cookies, argon2 password hashing |
| Code execution | Self-hosted Judge0 in Docker (or a hosted Judge0 instance if hosting is a problem) |
| Tests | Vitest, Playwright (multi-client and offline tests) |
| DevOps | Docker Compose for local dev, GitHub Actions for CI |
| Hosting | Frontend on Vercel. Server on a WebSocket-capable host (Railway, Render, or Fly). Postgres on Neon or Supabase. |

Redis is not used at first. Add it only if running multiple server instances.

## Data model (Prisma, PostgreSQL)

- **User:** id, email (unique), name, passwordHash, createdAt
- **Room:** id, name, ownerId, createdAt, updatedAt
- **Membership:** id, userId, roomId, role (OWNER / EDITOR / VIEWER), joinedAt. Unique on (userId, roomId).
- **File:** id, roomId, parentId (nullable, self-reference), name, type (FILE / FOLDER), language, ydocState (bytes, the Yjs snapshot), textContent (plain-text copy used by search), updatedAt
- **ShareLink:** id, roomId, token (unique), role (EDITOR / VIEWER), createdAt, revokedAt

Deleting a room cascades to its memberships, files, and share links.

## Sync design

- One Yjs document per file for its content. Documents are loaded only when a file is opened.
- The file tree structure also needs real-time sync (create, rename, move, delete). Suggested approach: a room-level Yjs document holding a `Y.Map` of tree nodes, mirrored into the `File` table by server hooks so search and export can query it. Propose the exact design in `decisions.md` before building it.
- Hocuspocus `onAuthenticate` identifies the user (cookie) or guest (signed token), checks their role for the room, and sets read-only for viewers.
- Hocuspocus `onLoadDocument` and `onStoreDocument` read and write snapshots through Prisma. On store, also update `textContent` for search.
- Awareness (Yjs) carries cursors, selections, name, and color, and feeds the active users panel.

## Auth and guests

- Registered users: signup/login, JWT in an httpOnly cookie.
- Guests are not stored as users. Opening a share link and entering a display name returns a short-lived signed guest token containing guestId, displayName, roomId, and the role granted by the link.
- Guest signs up mid-session: create the account, add a Membership for that room with the guest's role, then continue the session as the user.
- Every API route and WebSocket connection checks the role. The client UI hides things, but the server enforces.

## Search

Server-side over `File.textContent` for a room (case-insensitive match, return file, line number, and line text). Fine at project size. Don't search live Yjs documents.

## Run code

The client calls our API, which checks the user is at least an editor, then forwards the files and language to Judge0 and returns stdout, stderr, and exit status. Apply a rate limit. Keep it to simple multi-file cases.
Input tab for stdin next to the Output tab. Input and output are per-user, and runs are independent

## Testing

- Unit tests (Vitest) for permission logic, tree operations, and the persistence hooks.
- Playwright with multiple browser contexts: concurrent edits converge, an offline client's edits merge on reconnect, viewers can't edit, guests can't reach restricted routes.
- Measure sync latency with several clients and document the conditions.
