# codeTogether

A real-time collaborative code editor built for seamless pair programming and team collaboration. It features live multi-cursor editing, presence awareness, synchronized file trees, and room sharing powered by Yjs, Hocuspocus, and Monaco Editor.

---

## Run locally from a fresh clone

### Install first

Install these tools before cloning the project:

| Tool | Required version | Why it is needed |
|---|---:|---|
| Git | Current stable version | Clones the repository |
| Node.js | 20.19+ or 22.12+ | Runs the client and server; npm is included |
| Docker with Docker Compose | Current stable version | Runs PostgreSQL and the Judge0 code runner |

Use Node.js **22 LTS** if you do not already have a preferred compatible version.

### Windows setup

1. Install Git for Windows, Node.js 22 LTS, and Docker Desktop.
2. In Docker Desktop, make sure it is running with **Linux containers**. If Docker Desktop asks, enable its WSL 2 integration.
3. Open PowerShell and clone the project:

   ```powershell
   git clone <repository-url>
   cd codeTogether
   npm install
   Copy-Item .env.example .env
   ```

4. Generate a private JWT secret and replace the `JWT_SECRET` value in `.env` with the output:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

5. Start the application:

   ```powershell
   npm run dev
   ```

### Ubuntu setup

1. Install Git, Node.js, and Docker Engine with the Docker Compose plugin. Confirm they are available:

   ```bash
   git --version
   node --version
   npm --version
   docker compose version
   ```

2. Let your user run Docker without `sudo`, then sign out and back in once:

   ```bash
   sudo usermod -aG docker "$USER"
   ```

3. Clone and set up the project:

   ```bash
   git clone <repository-url>
   cd codeTogether
   npm install
   cp .env.example .env
   ```

4. Generate a private JWT secret and put it in `.env` as the value of `JWT_SECRET`:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

5. Start the application:

   ```bash
   npm run dev
   ```

### Open the app

After `npm run dev` reports that the services are ready, open [http://localhost:5173](http://localhost:5173).

The start command automatically starts PostgreSQL and Judge0 through Docker Compose, applies the Prisma schema, then starts the API, sync server, chat server, and Vite client.

To stop the development servers, press `Ctrl+C`. Database data remains in Docker volumes, so it is available at the next start.

### Stop or reset local services

Stop only the containers while keeping database data:

```bash
docker compose stop
```

Remove the containers and all local database data, then start from a blank state:

```bash
docker compose down --volumes
```

The first run downloads the Judge0 image, which is several gigabytes. It can
take a while on a slower connection; later starts reuse the local image. Judge0
is bound to `127.0.0.1:2358` and is reached only through the app API, which
checks room access before forwarding a run request.

Judge0 CE 1.13.1 requires a Docker host using **cgroup v1** for its `isolate`
sandbox. Check with `docker info --format '{{.CgroupVersion}}'`. If it prints
`2`, switch the host to cgroup v1 following the
[Judge0 deployment instructions](https://github.com/judge0/judge0/releases/tag/v1.13.1),
restart the machine, and then run `npm run dev` again.

## Running code

Open a Python, JavaScript, TypeScript, C, C++, or Java source file and select
**Run** (or press `Ctrl+Enter`). The runner sends a small snapshot of the
project to Judge0, so matching source files in the same room are available
during that execution. Python and JavaScript run the chosen entry file;
TypeScript compiles every `.ts` file; C and C++ compile only the selected
source file; and Java compiles every `.java` file. For C and C++, the selected
file must contain one `main` function. Standard input is available in the
**Input** tab of the bottom panel. Owners and editors can run code; viewers
cannot.

## Room chat and preferences

Select **Chat** in the top bar, or press `Alt+Shift+C`, to open the room
conversation. Guests and signed-in users can send messages. The latest 100
messages are retained for each room, and the chat button shows an unread badge
while its panel is closed.

Open **Settings & Profile** from the bottom-left rail to choose the light or
dark theme, set the editor font size, download a project when signed in, or
update your display name. The theme, font size, selected side panel, panel
width, chat state, and output state are remembered in the browser.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts database, backend services, and frontend in development mode |
| `npm run build` | Compiles both client and server for production |
| `npm run typecheck` | Runs TypeScript type checking across all packages |
| `npm run lint` | Runs ESLint across client and server |
| `npm run db:push` | Pushes Prisma schema updates to PostgreSQL |
