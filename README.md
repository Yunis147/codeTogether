# codeTogether

A real-time collaborative code editor built for seamless pair programming and team collaboration. It features live multi-cursor editing, presence awareness, synchronized file trees, and room sharing powered by Yjs, Hocuspocus, and Monaco Editor.

---

## Prerequisites

Before running the project, ensure you have:
- **Node.js** v20.19+ (or v22.12+)
- **npm** v10+
- **Docker & Docker Compose** (for running the PostgreSQL database)

---

## Quick Start (How to Run)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd codeTogether
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *(The default `.env.example` settings work out-of-the-box for local Docker development).*

4. **Start the development stack:**
   ```bash
   npm run dev
   ```
   This command automatically:
   - Starts PostgreSQL using Docker Compose.
   - Applies the database schema with Prisma.
   - Boots the Express API server and Hocuspocus WebSocket sync server.
   - Starts the Vite frontend client.

5. **Open in browser:**
   - **Frontend App:** [http://localhost:5173](http://localhost:5173)
   - **API Server:** [http://localhost:3001](http://localhost:3001)
   - **Sync Server:** `ws://localhost:1234`

To stop the development servers, press `Ctrl+C`. PostgreSQL container data is preserved in a named Docker volume.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts database, backend services, and frontend in development mode |
| `npm run build` | Compiles both client and server for production |
| `npm run typecheck` | Runs TypeScript type checking across all packages |
| `npm run lint` | Runs ESLint across client and server |
| `npm run db:push` | Pushes Prisma schema updates to PostgreSQL |
