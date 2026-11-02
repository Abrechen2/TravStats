/**
 * Server-level trust instead of per-person invitation codes (owner direction 2026-10-26, spec
 * 2026-10-20 "Owner direction — simplify the setup", forgejo#301). Once two admins have pinned
 * each other's key, a user of one server finds a user of the other by name — among those who
 * opted in to being found (`users.federation_findable`, default off) — and the two servers make
 * the pairing the invitation code used to make: the trip pairing (`RemoteShareAccount` with its
 * consents) and a leaderboard pairing (`LeaderboardRemote`), both in one exchange.
 *
 * Fail closed, one answer: the receiving server says `paired: false` for every cause (no such
 * user, not findable, a consent the person withdrew before, a full list, a name clash), so the
 * answer cannot be used to enumerate its users; a per-peer budget bounds the guessing itself.
 * No network call runs inside a database transaction.
 */
import { randomUUID } from "crypto";
import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { PERSON_SELECT, toPerson } from "../people";
import {
  directoryPairReplySchema,
  type DirectoryPair,
  type DirectoryPairReply,
} from "../../../schemas/tripSharePeer";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { readRemotePerson, type RemotePersonView } from "./remotePeople";
import { peerSupports } from "./peerFeatures";
import { messageHeader, tripShareExchange } from "./transport";
import {
  LOCAL_ERROR,
  kindOf,
  requireAdmitted,
  requireTripSharePeer,
  unreachable,
} from "./peerCheck";

/** At most this many pairings per local user are made on a peer's request. */
export const DIRECTORY_PAIRING_LIMIT = 200;
/** Lookups one admitted server may make on this one per window: guessing names is bounded. */
export const DIRECTORY_LOOKUPS_PER_HOUR = 60;
const WINDOW_MS = 60 * 60 * 1000;

const lookups = new Map<string, number[]>();

/** Spend one lookup of `origin`'s budget; false when it is used up. */
export function takeDirectoryLookup(origin: string, now: number = Date.now()): boolean {
  const recent = (lookups.get(origin) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= DIRECTORY_LOOKUPS_PER_HOUR) {
    lookups.set(origin, recent);
    return false;
  }
  recent.push(now);
  lookups.set(origin, recent);
  return true;
}

/** Tests: forget the budgets. */
export function resetDirectoryLookups(): void {
  lookups.clear();
}

const NOT_PAIRED: DirectoryPairReply = { kind: "directory-pair-reply", paired: false };

/** Thrown inside the pairing transaction so nothing it wrote survives a refusal. */
class Unpaired extends Error {}

type Pairing = {
  id: string;
  userId: string;
  channel: string;
  localChannel: string;
  leaderboardRemoteId: string | null;
};

/** The leaderboard pairing of `pairing`: the linked one, else one made with the proposed channel. */
async function ensureLeaderboardPairing(
  tx: DbTransaction,
  pairing: Pairing,
  origin: string,
  names: { username: string; displayName: string },
  proposed: string
): Promise<string | null> {
  if (pairing.leaderboardRemoteId) {
    const linked = await tx.leaderboardRemote.findUnique({
      where: { id: pairing.leaderboardRemoteId },
      select: { channel: true },
    });
    if (linked) return linked.channel;
  }
  const clash = await tx.leaderboardRemote.findUnique({
    where: { origin_channel: { origin, channel: proposed } },
    select: { userId: true },
  });
  // Another pairing already holds that channel: not ours to take over.
  if (clash) return null;
  const remote = await tx.leaderboardRemote.create({
    data: { userId: pairing.userId, origin, channel: proposed, ...names },
  });
  await tx.remoteShareAccount.update({
    where: { id: pairing.id },
    data: { leaderboardRemoteId: remote.id },
  });
  return remote.channel;
}

/**
 * The receiving side (`directory-pair`): the route has authenticated the peer. The person asked for
 * must be active and findable; being findable is their standing yes to receive offers from the
 * connected servers' users (each offer still waits for their answer in the inbox), so the consent
 * that lets the asker offer trips is written here. A consent the person withdrew earlier is NOT
 * revived — that is their decision, and the answer is the same `paired: false`.
 */
export async function serveDirectoryPair(
  origin: string,
  body: DirectoryPair
): Promise<DirectoryPairReply> {
  if (!takeDirectoryLookup(origin))
    return { kind: "directory-pair-reply", paired: false, limited: true };
  const user = await prisma.user.findUnique({
    where: { username: body.username },
    select: { ...PERSON_SELECT, isActive: true, federationFindable: true },
  });
  if (!user?.isActive || !user.federationFindable) return NOT_PAIRED;
  const names = { username: body.fromUsername, displayName: body.fromDisplayName };
  try {
    return await prisma.$transaction(async (tx) => {
      const byChannel = await tx.remoteShareAccount.findUnique({
        where: { origin_channel: { origin, channel: body.channel } },
      });
      if (byChannel && byChannel.userId !== user.id) {
        logger.warn(
          { operation: "directory_pair_channel_taken", origin },
          "A pairing channel names another user's pairing"
        );
        throw new Unpaired();
      }
      // Reused ONLY by the channel the asker already holds. A name proves nothing: a new person
      // with a reused or renamed username must never inherit an old pairing's channels, level or
      // leaderboard consent, so they get a pairing of their own and the old one stays apart.
      const existing = byChannel;
      if (!existing) {
        // A person this user withdrew from or declined does not come back by asking again with a
        // fresh channel: the decision is theirs, and a name is all a new channel proves.
        const refusedBefore = await tx.shareConsent.count({
          where: {
            targetId: user.id,
            status: { in: ["withdrawn", "declined"] },
            remoteRequester: { origin, username: body.fromUsername },
          },
        });
        if (refusedBefore > 0) throw new Unpaired();
        const held = await tx.remoteShareAccount.count({ where: { userId: user.id } });
        if (held >= DIRECTORY_PAIRING_LIMIT) throw new Unpaired();
      }
      const pairing =
        existing ??
        (await tx.remoteShareAccount.create({
          data: {
            userId: user.id,
            origin,
            channel: body.channel,
            localChannel: randomUUID(),
            ...names,
          },
        }));
      const consent = await tx.shareConsent.findUnique({
        where: { remoteRequesterId_targetId: { remoteRequesterId: pairing.id, targetId: user.id } },
      });
      if (consent && consent.status !== "accepted") throw new Unpaired();
      if (!consent)
        await tx.shareConsent.create({
          data: {
            remoteRequesterId: pairing.id,
            targetId: user.id,
            status: "accepted",
            decidedAt: new Date(),
          },
        });
      const leaderboardChannel = await ensureLeaderboardPairing(
        tx,
        pairing,
        origin,
        names,
        body.leaderboardChannel
      );
      if (!leaderboardChannel) throw new Unpaired();
      const me = toPerson(user);
      return {
        kind: "directory-pair-reply" as const,
        paired: true as const,
        channel: pairing.localChannel,
        adoptChannel: pairing.channel,
        leaderboardChannel,
        username: me.username,
        displayName: me.displayName,
      };
    });
  } catch (error) {
    // A racing duplicate (same channel twice at once) loses on the unique index: not paired now,
    // the asker's next try finds the pairing the winner made.
    if (error instanceof Unpaired) return NOT_PAIRED;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NOT_PAIRED;
    throw error;
  }
}

/** Records the pairing the other server confirmed; the caller's side of `serveDirectoryPair`. */
async function recordPairing(
  userId: string,
  origin: string,
  reply: Extract<DirectoryPairReply, { paired: true }>
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const byChannel = await tx.remoteShareAccount.findUnique({
      where: { origin_channel: { origin, channel: reply.channel } },
    });
    if (byChannel && byChannel.userId !== userId)
      throw unreachable(userId, origin, "channel-reused");
    const pairing =
      byChannel ??
      (await tx.remoteShareAccount.create({
        data: {
          userId,
          origin,
          channel: reply.channel,
          localChannel: reply.adoptChannel,
          username: reply.username,
          displayName: reply.displayName,
        },
      }));
    // The other person's yes (they are findable): this account may offer trips to them.
    await tx.shareConsent.upsert({
      where: { requesterId_remoteTargetId: { requesterId: userId, remoteTargetId: pairing.id } },
      create: {
        requesterId: userId,
        remoteTargetId: pairing.id,
        status: "accepted",
        decidedAt: new Date(),
      },
      update: { status: "accepted", decidedAt: new Date() },
    });
    const linked = await ensureLeaderboardPairing(
      tx,
      pairing,
      origin,
      { username: reply.username, displayName: reply.displayName },
      reply.leaderboardChannel
    );
    if (linked && linked !== reply.leaderboardChannel)
      logger.warn(
        { operation: "directory_pair_leaderboard_mismatch", userId, origin },
        "The leaderboard channels of a pairing differ; the leaderboard stays unavailable for it"
      );
    return pairing.id;
  });
}

/**
 * Find a person on a connected server by username and pair with them. Every refusal is its own
 * code: the server is not admitted / too old / off / unreachable, the budget is spent, or no
 * findable user of that name (one answer for "unknown" and "not findable").
 */
export async function findRemotePerson(
  userId: string,
  origin: string,
  username: string
): Promise<RemotePersonView> {
  const local = await requireTripFederation(userId);
  if (origin === local.origin)
    throw remoteShareError("SHARE_REMOTE_INVITE_OWN_SERVER", 400, "That is this server", {
      userId,
    });
  await requireAdmitted(userId, origin);
  await requireTripSharePeer(userId, origin);
  if (!(await peerSupports(origin, "directory").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin },
      { origin }
    );
  const me = toPerson(
    await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT })
  );
  // A pairing made earlier keeps its channels: the other server finds it by them.
  const known = await prisma.remoteShareAccount.findFirst({
    where: { userId, origin, username },
    include: { leaderboardRemote: { select: { channel: true } } },
  });
  let reply: DirectoryPairReply;
  try {
    reply = directoryPairReplySchema.parse(
      await tripShareExchange(origin, {
        kind: "directory-pair",
        ...messageHeader(),
        username,
        channel: known?.localChannel ?? randomUUID(),
        leaderboardChannel: known?.leaderboardRemote?.channel ?? randomUUID(),
        fromUsername: me.username,
        fromDisplayName: me.displayName,
      })
    );
  } catch (error) {
    const kind = kindOf(error);
    throw kind === LOCAL_ERROR ? error : unreachable(userId, origin, kind);
  }
  if (!reply.paired)
    throw reply.limited
      ? remoteShareError(
          "SHARE_REMOTE_LOOKUP_LIMITED",
          429,
          "That server's lookups are used up for now",
          { userId, origin },
          { origin }
        )
      : remoteShareError(
          "SHARE_REMOTE_PERSON_UNKNOWN",
          404,
          "No findable user of that name",
          { userId, origin },
          { origin }
        );
  const id = await recordPairing(userId, origin, reply);
  return readRemotePerson(userId, id);
}
