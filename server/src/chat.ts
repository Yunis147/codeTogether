import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { AccessError, cookieFromHeader, resolveRoomAccess, type RoomAccess } from './access.js';
import { prisma } from './prisma.js';
import { SESSION_COOKIE } from './tokens.js';

const HISTORY_LIMIT = 100;
const MESSAGE_WINDOW_MS = 10_000;
const MESSAGE_LIMIT = 12;

const joinSchema = z.object({
  roomId: z.string().min(1).max(100),
});

const sendSchema = z.object({
  content: z.string().trim().min(1, 'Write a message before sending.').max(2_000),
});

const activeFileSchema = z.object({
  fileId: z.string().min(1).max(100).nullable(),
});

type ChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: string;
};

type RoomPresence = {
  id: string;
  name: string;
  color: string;
  role: RoomAccess['role'];
  guest: boolean;
  fileId: string | null;
};

type Ack = (result: { ok: true } | { ok: false; error: string }) => void;

type ServerToClientEvents = {
  'chat:history': (messages: ChatMessage[]) => void;
  'chat:message': (message: ChatMessage) => void;
  'room:presence': (people: RoomPresence[]) => void;
  'room:renamed': (payload: { name: string }) => void;
};

type ClientToServerEvents = {
  'chat:join': (payload: unknown, acknowledge: Ack) => void;
  'chat:send': (payload: unknown, acknowledge: Ack) => void;
  'room:active-file': (payload: unknown) => void;
};

type SocketData = {
  session?: { roomId: string; token: string | null; access: RoomAccess; fileId: string | null };
  sentAt: number[];
};

let activeChatServer: Server<ClientToServerEvents, ServerToClientEvents, object, SocketData> | null = null;

function roomChannel(roomId: string): string {
  return `room:${roomId}:chat`;
}

function asMessage(message: {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: Date;
}): ChatMessage {
  return { ...message, createdAt: message.createdAt.toISOString() };
}

function errorMessage(error: unknown): string {
  if (error instanceof AccessError) return error.message;
  return 'Chat is temporarily unavailable.';
}

function roomPresence(access: RoomAccess, fileId: string | null): RoomPresence {
  return {
    id: access.identityId,
    name: access.name,
    color: access.color,
    role: access.role,
    guest: access.guest,
    fileId,
  };
}

async function currentAccess(socket: Socket, roomId: string): Promise<RoomAccess> {
  const guestToken = typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : null;
  const cookie = cookieFromHeader(socket.handshake.headers.cookie, SESSION_COOKIE);

  // A signed-in user's httpOnly cookie takes precedence over an old guest token
  // that may still exist in sessionStorage after they create an account.
  return resolveRoomAccess(roomId, cookie ? null : guestToken, cookie);
}

/**
 * A socket joins exactly one room chat. Access is resolved at join and before
 * every send, so removing a member or revoking a guest link takes effect
 * without trusting the browser's original join claim.
 */
export function createChatServer(httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents, object, SocketData> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(httpServer, {
    path: '/socket.io',
    serveClient: false,
  });
  activeChatServer = io;

  const broadcastPresence = (roomId: string): void => {
    const identities = new Map<string, RoomPresence>();
    const sockets = io.sockets.adapter.rooms.get(roomChannel(roomId));

    for (const socketId of sockets ?? []) {
      const socket = io.sockets.sockets.get(socketId);
      const session = socket?.data.session;
      const access = session?.access;
      if (session && access?.roomId === roomId) identities.set(access.identityId, roomPresence(access, session.fileId));
    }

    io.to(roomChannel(roomId)).emit(
      'room:presence',
      Array.from(identities.values()).sort((left, right) => left.name.localeCompare(right.name)),
    );
  };

  io.on('connection', (socket) => {
    socket.data.sentAt = [];

    socket.on('chat:join', async (payload, acknowledge) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: 'This room cannot be opened for chat.' });
        return;
      }

      try {
        const access = await currentAccess(socket, parsed.data.roomId);
        const previous = socket.data.session;
        if (previous) socket.leave(roomChannel(previous.roomId));

        socket.data.session = {
          roomId: access.roomId,
          token: typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : null,
          access,
          fileId: null,
        };
        socket.join(roomChannel(access.roomId));

        const messages = await prisma.chatMessage.findMany({
          where: { roomId: access.roomId },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        });
        socket.emit('chat:history', messages.reverse().map(asMessage));
        broadcastPresence(access.roomId);
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on('chat:send', async (payload, acknowledge) => {
      const parsed = sendSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: parsed.error.issues[0]?.message ?? 'Check the message.' });
        return;
      }

      const session = socket.data.session;
      if (!session) {
        acknowledge({ ok: false, error: 'Connect to the room chat first.' });
        return;
      }

      const now = Date.now();
      socket.data.sentAt = socket.data.sentAt.filter((sentAt) => sentAt > now - MESSAGE_WINDOW_MS);
      if (socket.data.sentAt.length >= MESSAGE_LIMIT) {
        acknowledge({ ok: false, error: 'Please wait a moment before sending more messages.' });
        return;
      }

      try {
        const access = await currentAccess(socket, session.roomId);
        socket.data.session = { ...session, access };
        socket.data.sentAt.push(now);

        const message = await prisma.chatMessage.create({
          data: {
            roomId: access.roomId,
            authorId: access.identityId,
            authorName: access.name,
            authorColor: access.color,
            content: parsed.data.content,
          },
        });
        io.to(roomChannel(access.roomId)).emit('chat:message', asMessage(message));
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on('room:active-file', (payload) => {
      const parsed = activeFileSchema.safeParse(payload);
      const session = socket.data.session;
      if (!parsed.success || !session) return;

      socket.data.session = { ...session, fileId: parsed.data.fileId };
      broadcastPresence(session.roomId);
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.session?.roomId;
      if (roomId) queueMicrotask(() => broadcastPresence(roomId));
    });
  });

  return io;
}

/** Announce a room rename to connected collaborators and preserve it in chat history. */
export async function announceRoomRename(
  roomId: string,
  owner: Pick<RoomAccess, 'identityId' | 'name' | 'color'>,
  name: string,
): Promise<void> {
  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      authorId: owner.identityId,
      authorName: owner.name,
      authorColor: owner.color,
      content: `renamed this room to “${name}”.`,
    },
  });

  activeChatServer?.to(roomChannel(roomId)).emit('room:renamed', { name });
  activeChatServer?.to(roomChannel(roomId)).emit('chat:message', asMessage(message));
}
