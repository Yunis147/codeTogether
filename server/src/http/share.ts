import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../access.js';
import { prisma } from '../prisma.js';
import { resetRoomIdentityConnections } from '../sync/index.js';
import { signToken } from '../tokens.js';
import { firstIssue, rateLimit } from './middleware.js';

export const shareRouter = Router();

// Tokens are 24 random bytes, so guessing is hopeless, but a limiter keeps a
// scripted sweep from costing database queries.
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60 });

const joinSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter a display name of at least 2 characters.')
    .max(40, 'That display name is too long.'),
});

async function activeLink(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { room: { select: { id: true, name: true, owner: { select: { name: true } } } } },
  });

  return link && !link.revokedAt ? link : null;
}

shareRouter.get('/:token', limiter, async (request, response) => {
  const link = await activeLink(String(request.params.token));
  if (!link) {
    response.status(404).json({ error: 'This share link is no longer active.' });
    return;
  }

  const user = currentUser(request);

  response.json({
    room: { id: link.room.id, name: link.room.name, ownerName: link.room.owner.name },
    role: link.role,
    // Lets the client offer "continue as <name>" instead of asking a signed-in
    // person to invent a guest display name.
    signedInAs: user ? { name: user.name } : null,
  });
});

shareRouter.post('/:token/join', limiter, async (request, response) => {
  const link = await activeLink(String(request.params.token));
  if (!link) {
    response.status(404).json({ error: 'This share link is no longer active.' });
    return;
  }

  const user = currentUser(request);

  // A signed-in person becomes a real member, so the room shows up under
  // "Shared with me" and is still theirs after the guest token would expire.
  if (user) {
    const existing = await prisma.membership.findUnique({
      where: { userId_roomId: { userId: user.userId, roomId: link.roomId } },
    });

    // The link being used defines access for this join. In particular, someone
    // who previously used an editor invite must not keep editing after joining
    // through a viewer invite. The room owner always retains owner access.
    const role = existing?.role === 'OWNER' ? existing.role : link.role;

    await prisma.membership.upsert({
      where: { userId_roomId: { userId: user.userId, roomId: link.roomId } },
      create: { userId: user.userId, roomId: link.roomId, role },
      update: { role },
    });

    if (existing && existing.role !== role) {
      resetRoomIdentityConnections(link.roomId, user.userId);
    }

    response.json({
      room: { id: link.room.id, name: link.room.name, ownerName: link.room.owner.name },
      role,
      member: true,
    });
    return;
  }

  const parsed = joinSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const guestId = randomBytes(12).toString('base64url');
  const token = signToken({
    kind: 'guest',
    guestId,
    linkId: link.id,
    roomId: link.roomId,
    name: parsed.data.name,
    role: link.role,
  });

  response.json({
    room: { id: link.room.id, name: link.room.name, ownerName: link.room.owner.name },
    role: link.role,
    member: false,
    guest: { id: guestId, name: parsed.data.name },
    token,
  });
});
