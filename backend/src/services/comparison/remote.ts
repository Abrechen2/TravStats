/**
 * Friends on other servers (spec §9.1, §10). The invitation code is `<origin>#<64 hex>`: the
 * secret is single-use and 72 h valid; the origin says which admitted peer to ask. A pull asks
 * the friend's server for the friend's totals under the consent that friend gave there.
 *
 * Every reply from another server is that server's word: it is parsed with the wire schemas
 * before anything here looks at it, and a reply that does not parse — or parses but answers a
 * question nobody asked — is a refusal with a named kind in the log, never a crash and never a
 * stored value. No network call runs inside a database transaction: a transaction held open
 * for up to ten seconds per peer would pin a pooled connection and every lock it took.
 */
import { randomBytes } from "crypto";
import { ZodError } from "zod";
import { prisma, type DbTransaction } from "../../db";
import { Prisma, type LeaderboardRemote } from "../../prisma";
import logger from "../../utils/logger";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { exchange, PeerRefusal } from "../federation/security";
import { loadIdentity, type Identity } from "../federation/identity";
import { origin as originSchema } from "../federation/contract";
import { hash } from "../federation/refusal";
import { pingReplySchema } from "../../schemas/federationAdmin";
import {
  SERVED_VERSIONS,
  aggregateReplySchema,
  lbClaimReplySchema,
  type LbClaimReply,
  leaderboardScopeSchema,
  type LeaderboardScope,
  type LeaderboardSnapshot,
  type PersonView,
  type RowStatus,
} from "../../schemas/comparison";
import { lockRemotePair, personView, remoteKey, scopeJson } from "./consents";
import { comparisonError } from "./errors";

const INVITE_TTL_MS = 72 * 3_600_000;
const OPEN_INVITES = 20;
const SECRET_BYTES = 32;

export type PeerReadiness = "ready" | "outdated" | "unknown" | "unreachable";
export type RemoteResult =
  | { status: "ok"; snapshot: LeaderboardSnapshot }
  | { status: Exclude<RowStatus, "ok">; sharedYear?: number };

/** A reply that parsed but does not answer what was asked (another year, a reused channel). */
class UnexpectedReply extends Error {
  constructor(readonly kind: string) {
    super(`Unexpected peer reply: ${kind}`);
    this.name = "UnexpectedReply";
  }
}

/** The log's name for why another server's answer was not used. */
const failureKind = (error: unknown): string => {
  if (error instanceof PeerRefusal) return error.kind;
  if (error instanceof UnexpectedReply) return error.kind;
  if (error instanceof ZodError || error instanceof SyntaxError) return "malformed";
  return "unreachable";
};

const speaksOurVersion = (versions: readonly number[]) =>
  versions.some((v) => (SERVED_VERSIONS as readonly number[]).includes(v));

export function parseInviteCode(code: string): { origin: string; secret: string } | null {
  const text = code.trim();
  const at = text.lastIndexOf("#");
  if (at < 0) return null;
  const origin = text.slice(0, at);
  const secret = text.slice(at + 1);
  if (origin === "local" || !originSchema.safeParse(origin).success) return null;
  return /^[a-f0-9]{64}$/.test(secret) ? { origin, secret } : null;
}

/**
 * Whether a peer can be asked for totals. A stored version list is trusted; an empty one is
 * re-checked with one ping, because the other admin may have updated since the last check.
 * The answer is stored only while the peer is still pinned as it was read: an admin who
 * suspended or re-pinned it during the ping must not see a stale answer written over that.
 */
export async function peerReadiness(origin: string): Promise<PeerReadiness> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled || !peer.verifiedAt) return "unknown";
  if (speaksOurVersion(peer.leaderboardVersions)) return "ready";
  let versions: number[];
  try {
    versions = pingReplySchema.parse(await exchange(origin, { action: "ping" })).leaderboard ?? [];
  } catch (error) {
    logger.warn(
      { operation: "comparison_peer_ping_failed", origin, kind: failureKind(error) },
      "Peer did not answer"
    );
    return "unreachable";
  }
  const stored = await prisma.comparisonPeer.updateMany({
    where: { origin, enabled: true, publicKey: peer.publicKey, verifiedAt: { not: null } },
    data: { leaderboardVersions: versions },
  });
  if (stored.count === 0) return "unknown";
  return speaksOurVersion(versions) ? "ready" : "outdated";
}

/** This server's identity, or null when it is not connected to other servers. */
async function identityOrNull(): Promise<Identity | null> {
  try {
    return await loadIdentity();
  } catch (error) {
    if (error instanceof PeerRefusal) return null;
    throw error;
  }
}

export async function pullRemote(
  remote: LeaderboardRemote,
  year: number | null
): Promise<RemoteResult> {
  if (!(await identityOrNull())) return { status: "federationOff" };
  const readiness = await peerReadiness(remote.origin);
  if (readiness === "outdated") return { status: "outdated" };
  if (readiness !== "ready") return { status: "unreachable" };
  try {
    const reply = aggregateReplySchema.parse(
      await exchange(remote.origin, {
        action: "aggregate",
        channel: remote.channel,
        year,
        accept: [...SERVED_VERSIONS],
      })
    );
    if (reply.status === "ok") {
      // Totals for a year nobody asked for would be shown under the wrong heading.
      if (reply.snapshot.year !== year) throw new UnexpectedReply("wrong-year");
      return { status: "ok", snapshot: reply.snapshot };
    }
    if (reply.status === "yearNotShared")
      return { status: "yearNotShared", sharedYear: reply.year };
    if (reply.status === "unsupportedVersion") return { status: "outdated" };
    return { status: reply.status };
  } catch (error) {
    // A malformed reply is treated like no reply: nothing unvalidated reaches the page.
    logger.warn(
      { operation: "comparison_pull_failed", origin: remote.origin, kind: failureKind(error) },
      "A remote friend's totals could not be read"
    );
    return { status: "unreachable" };
  }
}

async function connectedIdentity(userId: string): Promise<Identity> {
  const identity = await identityOrNull();
  if (!identity)
    throw comparisonError(
      "COMPARISON_FEDERATION_OFF",
      409,
      "This server is not connected to other servers",
      { userId }
    );
  return identity;
}

/** Serialises one user's invitation writes, so two parallel requests cannot both pass the count. */
async function lockInvites(tx: DbTransaction, userId: string): Promise<void> {
  const key = `leaderboard-invites|${userId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))) l`;
}

export async function createInvite(userId: string): Promise<{ code: string; expiresAt: string }> {
  const local = await connectedIdentity(userId);
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await lockInvites(tx, userId);
    const open = await tx.leaderboardInvite.count({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (open >= OPEN_INVITES)
      throw comparisonError("COMPARISON_INVITE_LIMIT", 429, "Too many open invitations", {
        userId,
      });
    await tx.leaderboardInvite.create({ data: { hash: hash(secret), userId, expiresAt } });
  });
  return { code: `${local.origin}#${secret}`, expiresAt: expiresAt.toISOString() };
}

const unreachable = (userId: string, origin: string, kind?: string) =>
  comparisonError("COMPARISON_PEER_UNREACHABLE", 502, "That server does not answer", {
    userId,
    origin,
    kind,
  });

async function requireReadyPeer(userId: string, origin: string): Promise<void> {
  const readiness = await peerReadiness(origin);
  if (readiness === "unknown")
    throw comparisonError(
      "COMPARISON_PEER_UNKNOWN",
      403,
      "The admin has not connected that server",
      {
        userId,
        origin,
      }
    );
  if (readiness === "outdated")
    throw comparisonError("COMPARISON_PEER_OUTDATED", 409, "That server needs an update", {
      userId,
      origin,
    });
  if (readiness === "unreachable") throw unreachable(userId, origin);
}

type AcceptedClaim = Extract<LbClaimReply, { accepted: true }>;

/**
 * Writes the claim's result: the remote friend and the claimant's own yes, which IS the claim
 * (the inviter answers on their own server). Runs after the network call, never around it.
 */
async function recordClaim(
  userId: string,
  origin: string,
  answer: AcceptedClaim,
  grant: Prisma.InputJsonValue
): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      // A channel the other server already gave us belongs to another friendship; reusing it
      // would let one of the two read under the other's consent.
      const taken = await tx.leaderboardRemote.findUnique({
        where: { origin_channel: { origin, channel: answer.channel } },
      });
      if (taken) throw new UnexpectedReply("channel-reused");
      const remote = await tx.leaderboardRemote.create({
        data: {
          userId,
          origin,
          channel: answer.channel,
          username: answer.username,
          displayName: answer.displayName,
        },
      });
      await lockRemotePair(tx, userId, remote.id);
      await tx.leaderboardConsent.create({
        data: {
          ownerId: userId,
          remoteId: remote.id,
          status: "accepted",
          scope: grant,
          decidedAt: new Date(),
        },
      });
      return remote.id;
    });
  } catch (error) {
    const reused =
      error instanceof UnexpectedReply ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    if (reused) throw unreachable(userId, origin, "channel-reused");
    throw error;
  }
}

export async function claimInvite(
  userId: string,
  code: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const parsed = parseInviteCode(code);
  if (!parsed)
    throw comparisonError("COMPARISON_INVITE_INVALID", 400, "Not an invitation code", { userId });
  const grant = scopeJson(leaderboardScopeSchema.parse(scope));
  const local = await connectedIdentity(userId);
  if (parsed.origin === local.origin)
    throw comparisonError(
      "COMPARISON_INVITE_INVALID",
      400,
      "A code from this server: add the person by username",
      { userId }
    );
  await requireReadyPeer(userId, parsed.origin);
  const me = toPerson(
    await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT })
  );
  let reply;
  try {
    reply = lbClaimReplySchema.parse(
      await exchange(parsed.origin, {
        action: "lb-claim",
        code: parsed.secret,
        username: me.username,
        displayName: me.displayName,
      })
    );
    if (reply.accepted && (!reply.username.trim() || !reply.displayName.trim()))
      throw new UnexpectedReply("nameless");
  } catch (error) {
    throw unreachable(userId, parsed.origin, failureKind(error));
  }
  if (!reply.accepted)
    throw comparisonError("COMPARISON_INVITE_INVALID", 400, "Unknown, used or expired code", {
      userId,
    });
  const remoteId = await recordClaim(userId, parsed.origin, reply, grant);
  return personView(userId, remoteKey(remoteId));
}

/** Ends a remote friendship here at once; the other server is told best-effort, afterwards. */
export async function endRemote(userId: string, remoteId: string): Promise<void> {
  const remote = await prisma.leaderboardRemote.findFirst({ where: { id: remoteId, userId } });
  if (!remote)
    throw comparisonError("COMPARISON_NOT_FOUND", 404, "No such comparison", { userId, remoteId });
  const removed = await prisma.$transaction(async (tx) => {
    await lockRemotePair(tx, userId, remote.id);
    // Conditional on the row read above: the other server may have ended it in between.
    return tx.leaderboardRemote.deleteMany({
      where: { id: remote.id, userId, origin: remote.origin, channel: remote.channel },
    });
  });
  if (removed.count === 0)
    throw comparisonError("COMPARISON_NOT_FOUND", 404, "No such comparison", { userId, remoteId });
  try {
    await exchange(remote.origin, {
      action: "lb-state",
      channel: remote.channel,
      status: "withdrawn",
    });
  } catch (error) {
    // Its pulls are refused (unknown channel) from now on, so nothing more is served.
    logger.warn(
      {
        operation: "comparison_remote_end_unsent",
        origin: remote.origin,
        kind: failureKind(error),
      },
      "The other server was not told that a comparison ended"
    );
  }
}
