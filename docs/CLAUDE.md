# codeTogether: instructions for Claude Code

A real-time collaborative code editor. A room is a project (files and folders), shared by link.

Read these before doing any work:
- `docs/prd.md`: what we're building
- `docs/architecture.md`: stack and design (a starting point, it can evolve)
- `docs/phases.md`: build order. Work one phase at a time, in order.

## Workflow
- Work on the current phase only. Don't build features from later phases early.
- Before starting a phase, state a short plan. Ask before making big architecture changes.
- Log every meaningful decision in `docs/decisions.md` (append only: date, decision, why, alternatives considered). This includes library choices, schema changes, and any deviation from `architecture.md`.
- If the docs are unclear or contradict each other, ask instead of guessing.
- Small commits with clear messages.

## Code rules
- TypeScript in strict mode. No `any` unless justified in a comment.
- Monorepo: `client/` (React + Vite) and `server/` (Node, Express, Hocuspocus, Prisma).
- Sync uses Yjs + Hocuspocus. Never hand-roll a CRDT.
- Validate all server input (zod). Check the user's room role on every API request and every WebSocket connection. Never trust the client for permissions.
- Passwords hashed with argon2. Auth tokens in httpOnly cookies.
- Never execute user code on our own server. Code execution goes through Judge0 only.
- Secrets live in `.env` (never committed). Keep `.env.example` up to date.
- Write tests for sync logic, permission checks, and reconnect behavior (Vitest + Playwright).
- Keep it simple. Readable beats clever. Add a short comment when a choice isn't obvious.
Define all colors as CSS variables from the start, so a light theme is just a second set of values.

## Scope guard
Don't add a terminal, video chat, or anything not listed in `docs/prd.md` without asking first. GitHub integration and the AI agent are optional and come later.
