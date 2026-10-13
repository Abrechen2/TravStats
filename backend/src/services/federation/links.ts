import { prepareScope } from "./permissions";
import { z } from "zod";
import { validateAudience } from "./circles";
import { randomBytes, randomUUID } from "crypto";
import { prisma } from "../../db";
import { type Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { scopeSchema, type Scope } from "./contract";
import { exchange, hash, identity, refused } from "./security";

export async function ownedLink(userId: string, id: string) {
  const link = await prisma.comparisonLink.findFirst({
    where: { id, userId, revoked: false },
    include: { grants: true },
  });
  if (!link) throw refused();
  return link;
}
export async function invite(userId: string) {
  if (
    (await prisma.comparisonInvite.count({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    })) >= 20
  )
    throw new AppError("Too many invitations", 429);
  const code = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 3600_000);
  await prisma.comparisonInvite.create({ data: { hash: hash(code), userId, expiresAt } });
  let origin = "local";
  try {
    origin = identity().origin;
  } catch {
    /* Local-only comparison remains available. */
  }
  return { code, origin, expiresAt: expiresAt.toISOString() };
}
export async function receiveClaim(
  origin: string,
  code: string,
  claimNonce: string,
  localUserId?: string,
  label = ""
) {
  // Mix fresh inviter entropy into the channel so a claimant cannot grind a chosen confirmation code.
  const entropy = hash(claimNonce + randomBytes(32).toString("hex"));
  const channel = `${entropy.slice(0, 8)}-${entropy.slice(8, 12)}-4${entropy.slice(13, 16)}-a${entropy.slice(17, 20)}-${entropy.slice(20, 32)}`;
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.comparisonInvite.findUnique({ where: { hash: hash(code) } });
    if (
      !invitation ||
      invitation.userId === localUserId ||
      invitation.usedAt ||
      invitation.expiresAt <= new Date()
    )
      throw refused();
    const consumed = await tx.comparisonInvite.updateMany({
      where: { hash: invitation.hash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw refused();
    // Public channel IDs are random handshake identifiers, never remote account IDs.
    await tx.comparisonLink.create({
      data: { channel, userId: invitation.userId, origin, label: origin },
    });
    if (localUserId)
      await tx.comparisonLink.create({
        data: { channel, userId: localUserId, origin: "local", label },
      });
    return { accepted: true, channel };
  });
}
export async function claim(
  userId: string,
  input: { origin: string; code: string; label: string }
) {
  const nonce = randomUUID();
  let channel: string;
  if (input.origin === "local")
    channel = (await receiveClaim("local", input.code, nonce, userId, input.label)).channel;
  else {
    const result = z
      .strictObject({ accepted: z.literal(true), channel: z.string().uuid() })
      .parse(await exchange(input.origin, { action: "claim", code: input.code, channel: nonce }));
    channel = result.channel;
    await prisma.comparisonLink.create({
      data: { userId, channel, origin: input.origin, label: input.label },
    });
  }
  return { channel };
}
export function comparisonCode(channel: string) {
  return (parseInt(hash("travstats-comparison-confirm-v1:" + channel).slice(0, 12), 16) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
export async function receiveState(
  origin: string,
  channel: string,
  confirmed: boolean,
  revoked: boolean
) {
  const link = await prisma.comparisonLink.findFirst({ where: { origin, channel } });
  if (!link) throw refused();
  await prisma.comparisonLink.update({
    where: { id: link.id },
    data: { remoteConfirmed: confirmed, revoked: link.revoked || revoked },
  });
  if (revoked)
    await prisma.comparisonGrant.updateMany({
      where: { linkId: link.id },
      data: { active: false, revision: { increment: 1 } },
    });
  return { confirmed: link.confirmed, revoked: link.revoked || revoked };
}
export async function changeLink(
  userId: string,
  id: string,
  action: "confirm" | "revoke",
  label?: string,
  code?: string
) {
  const link = await ownedLink(userId, id);
  if (action === "confirm" && code !== comparisonCode(link.channel)) throw refused();
  await prisma.comparisonLink.update({
    where: { id },
    data: {
      ...(label ? { label } : {}),
      ...(action === "confirm" ? { confirmed: true } : { revoked: true }),
    },
  });
  if (action === "revoke")
    await prisma.comparisonGrant.updateMany({
      where: { linkId: id },
      data: { active: false, revision: { increment: 1 } },
    });
  if (link.origin === "local") {
    await prisma.comparisonLink.updateMany({
      where: { channel: link.channel, id: { not: id } },
      data: action === "confirm" ? { remoteConfirmed: true } : { revoked: true },
    });
  } else {
    try {
      const state = await exchange(link.origin, {
        action: "state",
        channel: link.channel,
        confirmed: action === "confirm",
        revoked: action === "revoke",
      });
      if (
        state &&
        typeof state === "object" &&
        "confirmed" in state &&
        typeof state.confirmed === "boolean"
      ) {
        await prisma.comparisonLink.update({
          where: { id },
          data: { remoteConfirmed: state.confirmed },
        });
      }
    } catch {
      /* Local revocation is final even if the peer is offline. Reads always re-authorise at source. */
    }
  }
  return { updated: true };
}
export async function saveGrant(userId: string, id: string, audience: string, input: Scope) {
  const link = await ownedLink(userId, id);
  if (!link.confirmed || !link.remoteConfirmed) throw refused();
  await validateAudience(link, audience);
  const scope = scopeSchema.parse(input);
  const expiresAt = scope.expiresAt ? new Date(scope.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) throw refused();
  const stored = await prepareScope(userId, scope);
  const grant = await prisma.comparisonGrant.upsert({
    where: { linkId_audience: { linkId: id, audience } },
    create: { linkId: id, audience, scope: stored as unknown as Prisma.InputJsonValue, expiresAt },
    update: {
      scope: stored as unknown as Prisma.InputJsonValue,
      expiresAt,
      active: true,
      revision: { increment: 1 },
    },
  });
  await prisma.comparisonAudit.create({
    data: {
      ownerId: userId,
      channel: link.channel,
      audience,
      revision: grant.revision,
      operation: "grant",
    },
  });
  return { revision: grant.revision };
}
export async function revokeGrant(userId: string, id: string, audience: string) {
  const link = await ownedLink(userId, id);
  await prisma.comparisonGrant.updateMany({
    where: { linkId: id, audience },
    data: { active: false, revision: { increment: 1 } },
  });
  await prisma.comparisonAudit.create({
    data: { ownerId: userId, channel: link.channel, audience, revision: 0, operation: "revoke" },
  });
  return { revoked: true };
}
export async function listLinks(userId: string) {
  const links = await prisma.comparisonLink.findMany({
    where: { userId, revoked: false },
    include: { grants: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return links.map((l) => ({
    id: l.id,
    channel: l.channel,
    origin: l.origin,
    label: l.label,
    confirmed: l.confirmed,
    remoteConfirmed: l.remoteConfirmed,
    code: comparisonCode(l.channel),
    grants: l.grants.map((g) => ({
      audience: g.audience,
      scope: g.scope,
      active: g.active,
      revision: g.revision,
    })),
  }));
}
