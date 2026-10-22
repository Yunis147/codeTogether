import cookieParser from 'cookie-parser';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { createChatServer } from './chat.js';
import { env } from './env.js';
import { authRouter } from './http/auth.js';
import { errorHandler } from './http/middleware.js';
import { roomsRouter } from './http/rooms.js';
import { shareRouter } from './http/share.js';
import { prisma } from './prisma.js';
import { syncServer, handleSyncUpgrade } from './sync/index.js';

const app = express();
const httpServer = createServer(app);
const chatServer = createChatServer(httpServer);

// Multiplex Hocuspocus WebSocket synchronization onto the primary HTTP server.
httpServer.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/sync') || url.pathname.startsWith('/room:')) {
    try {
      await handleSyncUpgrade(request, socket, head);
    } catch {
      socket.destroy();
    }
  }
});

// Needed for the rate limiter to see real client addresses behind a proxy.
app.set('trust proxy', 1);

// Cross-origin support for separate frontend (e.g. Vercel) and backend deployments.
app.use((request, response, next) => {
  const origin = request.headers.origin;
  const allowed = env.CLIENT_ORIGIN || origin;
  if (origin && (allowed === '*' || allowed === origin || !env.CLIENT_ORIGIN)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});

// Execution requests can carry a small project snapshot while typed edits still
// travel through Yjs. The run route enforces its own tighter 1 MB source limit.
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.resolve('uploads')));

app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/share', shareRouter);

app.get('/api/health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: 'ok', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.use(errorHandler);

async function start(): Promise<void> {
  await prisma.$connect();
  if (env.SYNC_PORT && env.SYNC_PORT !== env.PORT) {
    try {
      await syncServer.listen();
    } catch {
      console.warn(`Standalone sync port ${env.SYNC_PORT} unavailable; multiplexing on ${env.PORT}.`);
    }
  }

  httpServer.listen(env.PORT, '0.0.0.0', () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
    console.log(`Sync server active on ws://localhost:${env.PORT}/sync (and ws://localhost:${env.SYNC_PORT})`);
    console.log(`Chat server listening on ws://localhost:${env.PORT}/socket.io`);
  });
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await new Promise<void>((resolve) => chatServer.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await syncServer.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}

start().catch(async (error: unknown) => {
  console.error('Could not start codeTogether.', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
