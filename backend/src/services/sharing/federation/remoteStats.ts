/**
 * Per remote person (Einstellungen → Teilen → „Personen auf verbundenen Servern", simplified
 * setup 2026-11-02, forgejo#301): what the caller lets that person see — their leaderboard totals
 * (the existing `LeaderboardConsent`, one switch) and their statistics at one of three levels:
 * off, `overview` (the leaderboard's totals for every group, lifetime or one year — no entries)
 * and `full` (those, plus the entries behind the figures as fact lists, paged). Private notes,
 * costs and documents are not on this wire at all: an entry is what the trip-share wire carries
 * (`wire/shapes.ts`), the fact lists and nothing else.
 *
 * Serving fails closed and answers one way: an unknown pairing, a level too low for the part
 * asked, an inactive owner all read `notShared`. Stats travel signed like the leaderboard's
 * totals (the trip-share transport, purpose `trip-share/1`) over the pairing the directory made.
 */
import { randomUUID } from "crypto";
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { exchange } from "../../federation/security";
import {
  STATS_LEVELS,
  STATS_PAGE_SIZE,
  statsReplySchema,
  type StatsLevel,
  type StatsRead,
  type StatsReply,
} from "../../../schemas/tripSharePeer";
import {
  buildOverviewSnapshot,
  type LeaderboardSnapshot,
  parseOverviewSnapshot,
  setLeaderboardConsent,
  withdrawLeaderboardConsent,
} from "../../federation/leaderboardBridge";
import { ADAPTERS } from "../adapters";
import { SHARE_ENTITIES, SHARE_TYPES, type ShareEntity } from "../shareTypes";
import { loadVisibleDomains } from "../../domainVisibility";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { peerSupports } from "./peerFeatures";
import {
  LOCAL_ERROR,
  kindOf,
  requireAdmitted,
  requireTripSharePeer,
  unreachable,
} from "./peerCheck";
import { readRemotePerson, type RemotePersonView } from "./remotePeople";
import { STATS_TRANSPORT, messageHeader } from "./transport";
import { toWireEntries } from "./wire/encode";
import type { WireEntry } from "./wire/shapes";

/** The entry types a statistics read pages through: a stop only exists inside its trip. */
export const STATS_ENTITIES: readonly ShareEntity[] = SHARE_ENTITIES.filter(
  (e) => e !== "stop" && e !== "roadtrip"
);

const NOT_SHARED: StatsReply = { kind: "stats-reply", status: "notShared" };

// ---------------------------------------------------------------- owner: findable + switches

export async function getFindable(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { federationFindable: true },
  });
  return user.federationFindable;
}

/** Opt in or out of being found by users of connected servers. Existing pairings are untouched. */
export async function setFindable(userId: string, findable: boolean): Promise<boolean> {
  await requireTripFederation(userId);
  await prisma.user.update({ where: { id: userId }, data: { federationFindable: findable } });
  return findable;
}

/** The pairing's consent, either direction, is a yes (withdrawn, declined, pending after a restore: no). */
const consentAccepted = async (userId: string, remoteId: string): Promise<boolean> =>
  (await prisma.shareConsent.count({
    where: {
      status: "accepted",
      OR: [
        { requesterId: userId, remoteTargetId: remoteId },
        { remoteRequesterId: remoteId, targetId: userId },
      ],
    },
  })) > 0;

async function ownPairing(userId: string, remoteId: string, mustBeLive = false) {
  const pairing = await prisma.remoteShareAccount.findFirst({ where: { id: remoteId, userId } });
  if (!pairing)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  // A switch on a pairing that is withdrawn (here or there) or held after a restore stays off.
  if (mustBeLive && !(await consentAccepted(userId, remoteId)))
    throw remoteShareError(
      "SHARE_REMOTE_CONSENT_MISSING",
      409,
      "No accepted consent with that person",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  return pairing;
}

export async function setStatsLevel(
  userId: string,
  remoteId: string,
  level: StatsLevel
): Promise<RemotePersonView> {
  await requireTripFederation(userId);
  const pairing = await ownPairing(userId, remoteId, level !== "off");
  await prisma.remoteShareAccount.update({
    where: { id: pairing.id },
    data: { statsLevel: level },
  });
  return readRemotePerson(userId, remoteId);
}

/**
 * The leaderboard switch of one person: on shares the caller's totals (every group, every domain
 * the caller has visible, lifetime and any year) through the existing leaderboard consent; off
 * withdraws it. A pairing made with an invitation code has no leaderboard pairing.
 */
export async function setRemoteLeaderboard(
  userId: string,
  remoteId: string,
  on: boolean
): Promise<RemotePersonView> {
  await requireTripFederation(userId);
  const pairing = await ownPairing(userId, remoteId, on);
  const lbId = pairing.leaderboardRemoteId;
  if (!lbId)
    throw remoteShareError(
      "SHARE_REMOTE_LEADERBOARD_UNAVAILABLE",
      409,
      "That pairing has no leaderboard",
      { userId, origin: pairing.origin }
    );
  await setLeaderboardConsent(userId, lbId, on);
  return readRemotePerson(userId, remoteId);
}

/**
 * Ending a pairing ends what was shown through it, whoever ended it (a local withdrawal, the other
 * server's revoke): statistics back to off, the leaderboard consent withdrawn.
 */
export async function endShowing(tx: DbTransaction, pairingId: string): Promise<void> {
  const pairing = await tx.remoteShareAccount.findUnique({ where: { id: pairingId } });
  if (!pairing) return;
  await tx.remoteShareAccount.update({ where: { id: pairing.id }, data: { statsLevel: "off" } });
  if (pairing.leaderboardRemoteId)
    await withdrawLeaderboardConsent(tx, pairing.userId, pairing.leaderboardRemoteId);
}

// ---------------------------------------------------------------- serving a statistics read

/** What a page of an owner's rows needs of a Prisma delegate (they all take this shape). */
interface Listing {
  count(args: { where: { userId: string } }): Promise<number>;
  findMany(args: {
    where: { userId: string };
    select: { id: true };
    orderBy: { id: "asc" };
    skip: number;
    take: number;
  }): Promise<{ id: string }[]>;
}

/** One page of the owner's entries of one type, as the trip-share wire carries them. */
async function entriesPage(
  userId: string,
  entity: ShareEntity,
  offset: number
): Promise<{ total: number; entries: WireEntry[] }> {
  const delegate = (prisma as unknown as Record<string, Listing>)[SHARE_TYPES[entity].delegate];
  const where = { userId };
  const [total, rows] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      skip: offset,
      take: STATS_PAGE_SIZE,
    }),
  ]);
  return prisma.$transaction(async (tx) => {
    const shared = await ADAPTERS[entity].load(
      tx,
      rows.map((r) => r.id)
    );
    // A random key per row and per read: the real share key is a peer-only secret of a group
    // this person is not part of, and a viewer has no use for it.
    const keyed = shared.filter((r) => !r.excluded).map((r) => ({ ...r, shareKey: randomUUID() }));
    return { total, entries: await toWireEntries(tx, entity, keyed) };
  });
}

export async function serveStatsRead(origin: string, body: StatsRead): Promise<StatsReply> {
  const pairing = await prisma.remoteShareAccount.findFirst({
    where: { origin, channel: body.from, localChannel: body.to },
    include: { user: { select: { isActive: true } } },
  });
  if (!pairing?.user.isActive || pairing.statsLevel === "off") return NOT_SHARED;
  // The level is a grant on a live pairing: withdrawn, revoked or held after a restore shows nothing.
  if (!(await consentAccepted(pairing.userId, pairing.id))) return NOT_SHARED;
  const level = pairing.statsLevel as StatsLevel;
  if (body.part === "overview") {
    const snapshot = await buildOverviewSnapshot(pairing.userId, body.year);
    return {
      kind: "stats-reply",
      status: "ok",
      level: level === "full" ? "full" : "overview",
      part: "overview",
      snapshot,
    };
  }
  // Entries: only the full level, only a type that has entries of its own.
  if (level !== "full" || !body.entity || !STATS_ENTITIES.includes(body.entity)) return NOT_SHARED;
  // A domain the owner hid or disabled has no entries to show, whatever the level.
  const domain = SHARE_TYPES[body.entity].domain;
  if (!domain || !(await loadVisibleDomains(pairing.userId)).includes(domain)) return NOT_SHARED;
  const page = await entriesPage(pairing.userId, body.entity, body.offset ?? 0);
  return {
    kind: "stats-reply",
    status: "ok",
    level: "full",
    part: "entries",
    entity: body.entity,
    total: page.total,
    offset: body.offset ?? 0,
    entries: page.entries as Extract<StatsReply, { part: "entries" }>["entries"],
  };
}

// ---------------------------------------------------------------- viewing a person's statistics

async function ask(
  userId: string,
  remoteId: string,
  part: Pick<StatsRead, "part" | "year" | "entity" | "offset">
): Promise<StatsReply> {
  await requireTripFederation(userId);
  const pairing = await ownPairing(userId, remoteId);
  await requireAdmitted(userId, pairing.origin);
  await requireTripSharePeer(userId, pairing.origin);
  if (!(await peerSupports(pairing.origin, "stats").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  let reply: StatsReply;
  try {
    reply = statsReplySchema.parse(
      await exchange(
        pairing.origin,
        {
          kind: "stats-read",
          ...messageHeader(),
          from: pairing.localChannel,
          to: pairing.channel,
          ...part,
        },
        STATS_TRANSPORT
      )
    );
  } catch (error) {
    const kind = kindOf(error);
    throw kind === LOCAL_ERROR ? error : unreachable(userId, pairing.origin, kind);
  }
  if (reply.status === "notShared")
    throw remoteShareError(
      "SHARE_REMOTE_STATS_NOT_SHARED",
      403,
      "That person does not show their statistics at this level",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  return reply;
}

export interface RemoteOverview {
  level: "overview" | "full";
  snapshot: LeaderboardSnapshot;
}

export async function readRemoteOverview(
  userId: string,
  remoteId: string,
  year: number | null
): Promise<RemoteOverview> {
  const reply = await ask(userId, remoteId, { part: "overview", year });
  if (reply.status !== "ok" || reply.part !== "overview") throw unexpected(userId, remoteId);
  return { level: reply.level, snapshot: parseOverviewSnapshot(reply.snapshot) };
}

export interface RemoteEntriesPage {
  entity: ShareEntity;
  total: number;
  offset: number;
  entries: WireEntry[];
}

export async function readRemoteEntries(
  userId: string,
  remoteId: string,
  entity: ShareEntity,
  offset: number
): Promise<RemoteEntriesPage> {
  // The viewer's own hidden domains are not shown either.
  const domain = SHARE_TYPES[entity].domain;
  if (!domain || !(await loadVisibleDomains(userId)).includes(domain))
    throw remoteShareError("SHARE_REMOTE_STATS_NOT_SHARED", 403, "That domain is hidden here", {
      userId,
    });
  const reply = await ask(userId, remoteId, { part: "entries", year: null, entity, offset });
  if (reply.status !== "ok" || reply.part !== "entries" || reply.entity !== entity)
    throw unexpected(userId, remoteId);
  return {
    entity,
    total: reply.total,
    offset: reply.offset,
    entries: reply.entries as WireEntry[],
  };
}

/** A well-formed answer to another question than the one asked: the other server's fault. */
function unexpected(userId: string, remoteId: string): unknown {
  logger.warn(
    { operation: "stats_read_unexpected_reply", userId, remoteId },
    "A statistics reply answered another question"
  );
  return remoteShareError("SHARE_REMOTE_UNREACHABLE", 502, "That server does not answer", {
    userId,
    kind: "unexpected-reply",
  });
}

export const STATS_LEVEL_VALUES: readonly StatsLevel[] = STATS_LEVELS;
