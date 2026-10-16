import { createHash, createPublicKey, verify } from "crypto";
import { z } from "zod";
import { prisma } from "../../../db";
import type { ComparisonLink, Prisma } from "../../../prisma";
import { ownedLink } from "../links";
import { currentGrant, assertUnchanged, audit } from "../snapshots";
import { refused } from "../security";
// Runtime-only cycle: relay calls readSealed, readSealed asks the requester's roster via relay.
import { ask } from "./relay";
import {
  deviceSchema,
  contextSchema,
  manifestSchema,
  chunkSchema,
  type PublicDevice,
  type Manifest,
} from "./wire";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
export async function registerDevice(userId: string, input: unknown) {
  const d = deviceSchema.parse(input);
  for (const value of [d.encryption, d.signing]) {
    const key = createPublicKey({ key: Buffer.from(value, "base64"), type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
      throw refused();
  }
  if (digest(canonical({ encryption: d.encryption, signing: d.signing })) !== d.fingerprint)
    throw refused();
  const previous = await prisma.comparisonDevice.findUnique({ where: { id: d.id } });
  if (
    previous &&
    (previous.userId !== userId || previous.fingerprint !== d.fingerprint || previous.revoked)
  )
    throw refused();
  if (
    !previous &&
    (await prisma.comparisonDevice.count({ where: { userId, revoked: false } })) >= 5
  )
    throw refused();
  await prisma.comparisonDevice.upsert({
    where: { id: d.id },
    create: { ...d, userId },
    update: { name: d.name },
  });
  return d;
}
export async function ownDevices(userId: string): Promise<PublicDevice[]> {
  return (
    await prisma.comparisonDevice.findMany({
      where: { userId, revoked: false, user: { isActive: true } },
      orderBy: { id: "asc" },
    })
  ).map((d) =>
    deviceSchema.parse({
      id: d.id,
      name: d.name,
      encryption: d.encryption,
      signing: d.signing,
      fingerprint: d.fingerprint,
    })
  );
}
export async function revokeDevice(userId: string, id: string) {
  const d = await prisma.comparisonDevice.findFirst({ where: { userId, id } });
  if (!d) throw refused();
  await prisma.$transaction([
    prisma.comparisonDevice.update({ where: { id }, data: { revoked: true } }),
    prisma.comparisonPublication.deleteMany({ where: { userId, sender: d.fingerprint } }),
  ]);
  return { revoked: true };
}
export async function sourceDevices(link: ComparisonLink) {
  await ownedLink(link.userId, link.id);
  if (!link.confirmed || !link.remoteConfirmed) throw refused();
  return ownDevices(link.userId);
}
async function publicationOwner(userId: string, id: string) {
  const pub = await prisma.comparisonPublication.findFirst({
    where: { id, userId, expiresAt: { gt: new Date() } },
  });
  if (!pub) throw refused();
  const link = await ownedLink(userId, pub.linkId),
    grant = await currentGrant(link, pub.audience);
  if (
    grant.revision !== pub.revision ||
    !(await ownDevices(userId)).some((d) => d.fingerprint === pub.sender)
  )
    throw refused();
  return { pub, link, grant };
}
export async function beginPublication(userId: string, linkId: string, input: unknown) {
  const c = contextSchema.parse(input),
    link = await ownedLink(userId, linkId),
    grant = await currentGrant(link, c.audience);
  if (
    c.channel !== link.channel ||
    c.revision !== grant.revision ||
    !(await ownDevices(userId)).some((d) => d.fingerprint === c.sender) ||
    Math.abs(Date.parse(c.createdAt) - Date.now()) > 300000 ||
    Date.parse(c.expiresAt) <= Date.now() ||
    Date.parse(c.expiresAt) > Date.now() + 31 * 86400000 ||
    (grant.expiresAt && Date.parse(c.expiresAt) > grant.expiresAt.getTime())
  )
    throw refused();
  // Expired and abandoned ciphertext has no continuing purpose.
  await prisma.comparisonPublication.deleteMany({
    where: {
      userId,
      OR: [
        { expiresAt: { lt: new Date() } },
        { ready: false, createdAt: { lt: new Date(Date.now() - 86400000) } },
      ],
    },
  });
  if ((await prisma.comparisonPublication.count({ where: { userId } })) >= 100) throw refused();
  await prisma.comparisonPublication.create({
    data: {
      id: c.id,
      userId,
      linkId,
      audience: c.audience,
      revision: c.revision,
      sender: c.sender,
      context: json(c),
      expiresAt: new Date(c.expiresAt),
    },
  });
  return { id: c.id };
}
export async function putChunk(userId: string, id: string, input: unknown) {
  const { pub } = await publicationOwner(userId, id),
    b = chunkSchema.parse(input);
  if (pub.ready || Buffer.from(b.bytes, "base64").length > 262172) throw refused();
  const sha = digest(Buffer.from(b.bytes, "base64"));
  await prisma.$transaction(async (tx) => {
    // Serialize the per-owner quota; simultaneous tabs cannot race the total.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const fresh = await tx.comparisonPublication.findUnique({ where: { id } });
    if (!fresh || fresh.ready) throw refused();
    const existing = await tx.comparisonChunk.findUnique({
      where: { publicationId_part: { publicationId: id, part: b.part } },
    });
    if (existing) {
      if (existing.digest !== sha) throw refused();
      return;
    }
    const total = await tx.comparisonPublication.aggregate({
      where: { userId },
      _sum: { bytes: true },
    });
    if ((total._sum.bytes ?? 0) + b.bytes.length > 1024 * 1024 * 1024) throw refused();
    await tx.comparisonChunk.create({ data: { publicationId: id, ...b, digest: sha } });
    await tx.comparisonPublication.update({
      where: { id },
      data: { bytes: { increment: b.bytes.length } },
    });
  });
  return { stored: true };
}
export async function finishPublication(userId: string, id: string, input: unknown) {
  const { pub, link, grant } = await publicationOwner(userId, id),
    m = manifestSchema.parse(input);
  const sender = (await ownDevices(userId)).find((d) => d.fingerprint === pub.sender);
  if (
    m.indexStart + m.indexCount !== m.digests.length ||
    pub.ready ||
    !sender ||
    canonical(m.context) !== canonical(pub.context)
  )
    throw refused();
  const { signature, ...unsigned } = m;
  const key = createPublicKey({
    key: Buffer.from(sender.signing, "base64"),
    type: "spki",
    format: "der",
  });
  if (
    !verify(
      "sha256",
      Buffer.from(canonical(unsigned)),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64")
    )
  )
    throw refused();
  const chunks = await prisma.comparisonChunk.findMany({
    where: { publicationId: id },
    orderBy: { part: "asc" },
    select: { part: true, digest: true },
  });
  if (
    chunks.length !== m.digests.length ||
    chunks.some((c, i) => c.part !== i || c.digest !== m.digests[i])
  )
    throw refused();
  await assertUnchanged(link, grant);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const fresh = await tx.comparisonGrant.findUnique({ where: { id: grant.id } });
    if (!fresh?.active || fresh.revision !== pub.revision) throw refused();
    await tx.comparisonPublication.update({
      where: { id },
      data: { ready: true, manifest: json(m) },
    });
    // Replaced snapshots become inaccessible, without accumulating unbounded ciphertext.
    await tx.comparisonPublication.deleteMany({
      where: {
        userId,
        linkId: pub.linkId,
        audience: pub.audience,
        sender: pub.sender,
        ready: true,
        id: { not: id },
        createdAt: { lte: pub.createdAt },
      },
    });
  });
  await audit(link, grant, "encrypted-publication");
  return { published: true };
}
const REQUESTER_DEVICES_TTL_MS = 30_000;
const requesterCache = new Map<string, { until: number; fingerprints: Set<string> }>();
/**
 * The devices a sealed read may legitimately be addressed to: the friend's own devices on a
 * personal link, the group roster on a group audience. Checking only the manifest let the friend
 * collect the copy wrapped for the OWNER's device (or any other recipient's). Cached briefly,
 * because one publication is read chunk by chunk.
 */
async function requesterDevices(link: ComparisonLink, audience: string): Promise<Set<string>> {
  const key = `${link.id}|${audience}`;
  const hit = requesterCache.get(key);
  if (hit && hit.until > Date.now()) return hit.fingerprints;
  let fingerprints: string[];
  if (!audience)
    fingerprints = z
      .array(deviceSchema)
      .max(5)
      .parse(await ask(link, { operation: "devices", audience: "" }))
      .map((d) => d.fingerprint);
  else {
    const [circleId] = audience.split(":");
    const roster = z
      .strictObject({
        audience: z.string().max(100),
        members: z.array(z.object({ devices: z.array(deviceSchema).max(5) })).max(20),
      })
      .parse(await ask(link, { operation: "group-devices", audience: "", circleId }));
    if (roster.audience !== audience) throw refused();
    fingerprints = roster.members.flatMap((m) => m.devices.map((d) => d.fingerprint));
  }
  const value = new Set(fingerprints);
  requesterCache.set(key, { until: Date.now() + REQUESTER_DEVICES_TTL_MS, fingerprints: value });
  return value;
}
export async function readSealed(
  link: ComparisonLink,
  audience: string,
  recipient: string,
  publication?: string,
  part?: number,
  groupOwner = false
) {
  const grant = await currentGrant(link, audience);
  const publications = await prisma.comparisonPublication.findMany({
    where: {
      userId: link.userId,
      ...(groupOwner ? {} : { linkId: link.id }),
      audience,
      ready: true,
      expiresAt: { gt: new Date() },
      ...(publication ? { id: publication } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  for (const p of publications) {
    const manifest = manifestSchema.parse(p.manifest);
    if (!manifest.recipients.some((r) => r.fingerprint === recipient)) continue;
    const active = await publicationOwner(p.userId, p.id);
    if (!groupOwner && p.revision !== grant.revision) continue;
    const sender = (await ownDevices(p.userId)).find((d) => d.fingerprint === p.sender);
    if (!sender) continue;
    if (!groupOwner && !(await requesterDevices(link, audience)).has(recipient)) throw refused();
    let data: unknown = { manifest, sender };
    if (part !== undefined) {
      const chunk = await prisma.comparisonChunk.findUnique({
        where: { publicationId_part: { publicationId: p.id, part } },
      });
      if (!chunk) throw refused();
      data = { part: chunk.part, bytes: chunk.bytes };
    }
    await assertUnchanged(active.link, active.grant);
    await assertUnchanged(link, grant);
    await audit(link, grant, "encrypted-read");
    return data;
  }
  return null;
}
export async function ownSealed(
  userId: string,
  audience: string,
  recipient: string,
  publication?: string,
  part?: number
) {
  const p = await prisma.comparisonPublication.findFirst({
    where: { userId, audience, ready: true, ...(publication ? { id: publication } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!p) return null;
  return readSealed(
    await ownedLink(userId, p.linkId),
    audience,
    recipient,
    publication,
    part,
    true
  );
}
export type SealedHead = { manifest: Manifest; sender: PublicDevice };
