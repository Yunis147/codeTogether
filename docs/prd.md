# codeTogether: Product Requirements

## What it is
A browser-based, real-time collaborative code editor. Users create a room, which is a project with files and folders, share the link, and edit together with live cursors. Built as a portfolio project to demonstrate real-time systems and distributed state (CRDTs), so the sync layer and its reliability matter more than UI novelty.

Typical use: pair programming, study groups, group projects.

## Users
- **Guest:** joins through a room link with just a display name.
- **Registered user:** has an account, owns rooms, and sees rooms they've joined.

## Features

### Editor and sync
- Monaco editor with syntax highlighting and a language picker
- Real-time sync with Yjs: concurrent edits merge without losing anything
- Live cursors and selections with a colored name label per user
- Active users panel (click a user to jump to where they're editing)
- Follow mode (your view tracks another user)
- Per-user undo/redo (undo only your own changes)
- Autosave with a "Saved" indicator in the status bar
- Documents persist across refreshes and server restarts
- Reconnect handling: a user can go offline, keep typing, come back, and everything merges
- Connection state in the status bar ("Connected" / "Reconnecting...")

### Projects and files
- A room is a project: files and folders in a tree
- New file and new folder buttons. New items are created inside the selected folder (root if nothing is selected).
- Rename, move, delete, plus a right-click menu
- Editor tabs for open files
- Graceful conflict handling (for example a "this file was deleted" banner when someone deletes a file you have open)
- Search across all files: type a word, see matching lines grouped by file, click to jump to the line
- Import a project from a zip, export the project as a zip (export requires login)

### Rooms and access
- Create a room, get a share link, choose whether the link grants editor or viewer access
- Roles: owner, editor, viewer
- Owner can change roles and remove members
- Joined rooms are saved to a logged-in user's account (My rooms / Shared with me), with a leave-room option
- Guests can view or edit depending on the link's role, use chat, and see cursors
- Guests cannot create rooms or download/export
- If a guest signs up mid-session, their guest identity links to the new account and they keep their place in the room

### Layout (VS Code-style)
- Thin icon bar on the left: Files, Search, Rooms (GitHub added later), with Settings and Profile at the bottom
- Clicking an icon swaps only the side panel. The editor never changes or reloads.
- Side panel is resizable. Clicking the active icon collapses it.
- Rooms panel: My rooms and Shared with me, plus a New room button
- Guests see the Rooms icon too. Clicking it opens a "Sign up to create and save rooms" popup, and after login they return to the room they came from.
- Top navbar: room name, Run button, Share button, user avatars, chat toggle, settings
- Chat is a right-side panel toggled from the navbar, with an unread badge and a keyboard shortcut
- Themes and font size (per user). Layout state (panel sizes, open/closed) is remembered.

### Chat
- In-room chat for everyone in the room

### Run code
- Run button with an output panel
- Input tab for stdin next to the Output tab. Input and output are per-user, and runs are independent
- Runs through Judge0 (never on our own server)
- Multi-file support for simple cases (a few Python or Java files)

### Share and export
- Share popup: link, viewer/editor toggle, member list with role management (owner)
- Download project as zip

## Later (optional)
- GitHub: OAuth, push project to a repo, import from a repo (new icon in the icon bar)
- AI agent that joins the room as a participant with its own cursor

## Quality goals
- Automated tests for simultaneous edits, offline/reconnect, and permission checks
- Measured sync latency, with the test conditions documented
- Deployed demo, README, architecture diagram, short demo video
