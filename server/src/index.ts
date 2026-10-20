import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './env.js';
import { authRouter } from './http/auth.js';
import { errorHandler } from './http/middleware.js';
import { roomsRouter } from './http/rooms.js';
import { shareRouter } from './http/share.js';
import { prisma } from './prisma.js';
import { syncServer } from './sync/index.js';

const app = express();

// Needed for the rate limiter to see real client addresses behind a proxy.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

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
  await syncServer.listen();

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
    console.log(`Sync server listening on ws://localhost:${env.SYNC_PORT}`);
  });
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

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
