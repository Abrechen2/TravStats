import { z } from "zod";
import { prisma } from "../../db";
import type { ComparisonLink, Prisma } from "../../prisma";
import { circleSchema, type Circle, type Scope } from "./contract";
import { exchange, refused } from "./security";
import { ownedLink, saveGrant, revokeGrant } from "./links";
import { buildSnapshot, readFriend, sourceSnapshot } from "./snapshots";

export const audienceOf = (c: Pick<Circle, "id" | "version">) => `${c.id}:${c.version}`;
const view = (c: { id: string; name: string; version: number; members: unknown }) =>
  circleSchema.parse({ id: c.id, name: c.name, version: c.version, members: c.members });
export async function ownedCircle(userId: string, circleId: string) {
  const c = await prisma.comparisonCircle.findFirst({
    where: { id: circleId, userId, user: { isActive: true } },
  });
  if (!c) throw refused();
  return c;
}
export async function createCircle(userId: string, name: string, linkIds: string[]) {
  const links = await prisma.comparisonLink.findMany({
    where: { userId, id: { in: linkIds }, confirmed: true, remoteConfirmed: true, revoked: false },
  });
  if (links.length !== new Set(linkIds).size || !links.length || links.length > 19) throw refused();
  const members = links.map((l) => ({
    channel: l.channel,
    label: l.label,
    origin: l.origin,
    accepted: false,
  }));
  return view(
    await prisma.comparisonCircle.create({
      data: { userId, name, members: members as unknown as Prisma.InputJsonValue },
    })
  );
}
/** Called by a member's authenticated friendship. Only a listed member may see the roster. */
export async function circleInfo(hubLink: ComparisonLink, circleId: string) {
  const c = await ownedCircle(hubLink.userId, circleId);
  const result = view(c);
  if (
    hubLink.revoked ||
    !hubLink.confirmed ||
    !hubLink.remoteConfirmed ||
    !result.members.some((m) => m.channel === hubLink.channel)
  )
    throw refused();
  return result;
}
export async function incomingInfo(link: ComparisonLink, circleId: string): Promise<Circle> {
  if (link.origin !== "local")
    return circleSchema.parse(
      await exchange(link.origin, {
        action: "circle",
        operation: "info",
        channel: link.channel,
        circleId,
      })
    );
  const hub = await prisma.comparisonLink.findFirst({
    where: { channel: link.channel, id: { not: link.id }, origin: "local" },
  });
  if (!hub) throw refused();
  return circleInfo(hub, circleId);
}
/** A group grant is valid only for the CURRENT roster. A membership change invalidates every source. */
export async function validateAudience(link: ComparisonLink, audience: string) {
  if (!audience) return;
  const [circleId, revision, ...rest] = audience.split(":");
  if (rest.length || !circleId || !/^\d+$/.test(revision)) throw refused();
  const local = await prisma.comparisonCircle.findFirst({
    where: { id: circleId, userId: link.userId },
  });
  const c = local ? await circleInfo(link, circleId) : await incomingInfo(link, circleId);
  if (c.version !== Number(revision)) throw refused();
}
export async function acceptAtHub(
  hubLink: ComparisonLink,
  circleId: string,
  version: number,
  accepted: boolean
) {
  const c = await circleInfo(hubLink, circleId);
  if (c.version !== version) throw refused();
  const members = c.members.map((m) => (m.channel === hubLink.channel ? { ...m, accepted } : m));
  const updated = await prisma.comparisonCircle.updateMany({
    where: {
      id: circleId,
      version,
      members: { equals: c.members as unknown as Prisma.InputJsonValue },
    },
    data: {
      members: members as unknown as Prisma.InputJsonValue,
      ...(!accepted ? { version: { increment: 1 } } : {}),
    },
  });
  if (updated.count !== 1) throw refused();
  return { accepted };
}
export async function grantCircle(
  userId: string,
  linkId: string,
  circleId: string,
  version: number,
  scope: Scope
) {
  const link = await ownedLink(userId, linkId);
  const c = await incomingInfo(link, circleId);
  if (c.version !== version) throw refused();
  await saveGrant(userId, linkId, audienceOf(c), scope);
  if (link.origin !== "local")
    await exchange(link.origin, {
      action: "circle",
      operation: "accept",
      channel: link.channel,
      circleId,
      version,
    });
  else {
    const hub = await prisma.comparisonLink.findFirst({
      where: { channel: link.channel, id: { not: link.id } },
    });
    if (!hub) throw refused();
    await acceptAtHub(hub, circleId, version, true);
  }
  return { shared: true };
}
export async function ownerGrant(userId: string, circleId: string, version: number, scope: Scope) {
  const c = view(await ownedCircle(userId, circleId));
  if (c.version !== version) throw refused();
  for (const member of c.members) {
    const link = await prisma.comparisonLink.findFirst({
      where: { userId, channel: member.channel, revoked: false },
    });
    if (!link) throw refused();
    await saveGrant(userId, link.id, audienceOf(c), scope);
  }
  return { shared: true };
}
export async function listAtHub(hubLink: ComparisonLink) {
  if (hubLink.revoked || !hubLink.confirmed || !hubLink.remoteConfirmed) throw refused();
  const groups = await prisma.comparisonCircle.findMany({
    where: { userId: hubLink.userId },
    take: 100,
  });
  return groups.map(view).filter((c) => c.members.some((m) => m.channel === hubLink.channel));
}
export async function listCircles(userId: string) {
  const owned = (await prisma.comparisonCircle.findMany({ where: { userId }, take: 100 })).map(
    (c) => ({ ...view(c), linkId: null, host: "local" })
  );
  const links = await prisma.comparisonLink.findMany({
    where: { userId, confirmed: true, remoteConfirmed: true, revoked: false },
    take: 50,
  });
  const invited: Array<Circle & { linkId: string; host: string }> = [];
  for (const link of links) {
    try {
      let list: Circle[];
      if (link.origin !== "local")
        list = z
          .array(circleSchema)
          .max(100)
          .parse(
            await exchange(link.origin, {
              action: "circle",
              operation: "list",
              channel: link.channel,
            })
          );
      else {
        const hub = await prisma.comparisonLink.findFirst({
          where: { channel: link.channel, id: { not: link.id }, origin: "local" },
        });
        if (!hub) continue;
        list = await listAtHub(hub);
      }
      invited.push(...list.map((c) => ({ ...c, linkId: link.id, host: link.origin })));
    } catch {
      /* An offline host reveals no stale membership or cached data. */
    }
  }
  return [...owned, ...invited];
}
export async function readAtHub(
  userId: string,
  circleId: string,
  year: number | null,
  viewerLink?: ComparisonLink
) {
  const c = view(await ownedCircle(userId, circleId));
  if (viewerLink) {
    const member = c.members.find((m) => m.channel === viewerLink.channel);
    if (!member?.accepted || viewerLink.userId !== userId || viewerLink.revoked) throw refused();
  }
  const rows: Array<{
    channel: string;
    label: string;
    snapshot: Awaited<ReturnType<typeof readFriend>> | null;
  }> = [];
  let own = null;
  try {
    if (viewerLink) own = await sourceSnapshot(viewerLink, audienceOf(c), year);
    else {
      const domains = (await import("../domainVisibility")).loadVisibleDomains;
      own = await buildSnapshot(
        userId,
        {
          statistics: true,
          details: false,
          costs: true,
          personal: false,
          documents: false,
          photos: false,
          domains: await domains(userId),
          futureTrips: true,
          tripIds: [],
          precision: "exact",
          expiresAt: null,
          year,
          acceptedAt: new Date().toISOString(),
        },
        year
      );
    }
  } catch {
    /* No owner grant is not permission to borrow a personal one. */
  }
  if (own) own = { ...own, details: false, trips: [] };
  rows.push({ channel: "host", label: "host", snapshot: own });
  for (const member of c.members) {
    let snapshot = null;
    try {
      if (member.accepted) {
        const source = await prisma.comparisonLink.findFirst({
          where: { userId, channel: member.channel, revoked: false },
        });
        if (source) snapshot = await readFriend(userId, source.id, audienceOf(c), year);
      }
    } catch {
      /* Withheld or unreachable, never zero. */
    }
    // Shared group boards carry statistics only. Trip drill-down needs the original personal link.
    if (snapshot) snapshot = { ...snapshot, details: false, trips: [] };
    rows.push({ channel: member.channel, label: member.label, snapshot });
  }
  if ((await ownedCircle(userId, circleId)).version !== c.version) throw refused();
  if (viewerLink) {
    const latest = view(await ownedCircle(userId, circleId));
    if (!latest.members.find((m) => m.channel === viewerLink.channel)?.accepted) throw refused();
  }
  if (viewerLink) {
    const fresh = await prisma.comparisonLink.findUnique({ where: { id: viewerLink.id } });
    if (!fresh || fresh.revoked || !fresh.confirmed || !fresh.remoteConfirmed) throw refused();
  }
  return { circle: c, rows };
}
export async function leaveCircle(
  userId: string,
  linkId: string,
  circleId: string,
  version: number
) {
  const link = await ownedLink(userId, linkId);
  await revokeGrant(userId, linkId, `${circleId}:${version}`);
  if (link.origin !== "local")
    await exchange(link.origin, {
      action: "circle",
      operation: "leave",
      channel: link.channel,
      circleId,
      version,
    });
  else {
    const hub = await prisma.comparisonLink.findFirst({
      where: { channel: link.channel, id: { not: link.id } },
    });
    if (!hub) throw refused();
    await acceptAtHub(hub, circleId, version, false);
  }
  return { left: true };
}
export async function removeMember(userId: string, circleId: string, channel: string) {
  const c = view(await ownedCircle(userId, circleId));
  const members = c.members
    .filter((m) => m.channel !== channel)
    .map((m) => ({ ...m, accepted: false }));
  await prisma.comparisonCircle.update({
    where: { id: circleId },
    data: { members: members as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  return { removed: true };
}

export async function addMember(userId: string, circleId: string, linkId: string) {
  const c = view(await ownedCircle(userId, circleId));
  const link = await ownedLink(userId, linkId);
  if (
    !link.confirmed ||
    !link.remoteConfirmed ||
    c.members.length >= 19 ||
    c.members.some((m) => m.channel === link.channel)
  )
    throw refused();
  const members = [
    ...c.members,
    { channel: link.channel, label: link.label, origin: link.origin, accepted: false },
  ].map((m) => ({ ...m, accepted: false }));
  const result = await prisma.comparisonCircle.updateMany({
    where: { id: circleId, version: c.version },
    data: { members: members as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (result.count !== 1) throw refused();
  return { added: true };
}
