/**
 * The lookup budget of the connection requests (spec 2026-11-02 §3) and the leaderboard pairing
 * both servers name alike. Server-level trust is unchanged (the admins pinned each other's keys);
 * what used to follow from a lookup — an accepted pairing on the asker's word — is now a
 * connection the other person confirms (`connections/`).
 *
 * Fail closed, one answer: a receiving server never says why a request or lookup came to nothing
 * (no such user, not findable, declined before, a full list), so the answer cannot be used to
 * enumerate its users; a per-peer budget bounds the guessing itself.
 */
import type { DbTransaction } from "../../../db";
import type { DirectoryPair, DirectoryPairReply } from "../../../schemas/tripSharePeer";

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

type Pairing = {
  id: string;
  userId: string;
  channel: string;
  localChannel: string;
  leaderboardRemoteId: string | null;
};

/** The leaderboard pairing of `pairing`: the linked one, else one made with the proposed channel. */
export async function ensureLeaderboardPairing(
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
    select: { id: true, userId: true, sharePairing: { select: { id: true } } },
  });
  if (clash) {
    // The pairing a redeemed link made for THIS user and server, not yet bound to a connection,
    // is this connection's own (spec 2026-11-08 §11.8). Any other holder is not ours to take over.
    if (clash.userId !== pairing.userId || clash.sharePairing) return null;
    await tx.remoteShareAccount.update({
      where: { id: pairing.id },
      data: { leaderboardRemoteId: clash.id },
    });
    return proposed;
  }
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
 * `directory-pair` (the pairing without a confirmation) is retired by user connections
 * (spec 2026-11-02): a findable person is asked for a connection and decides themselves. The
 * message stays readable for peers that still send it and answers `paired: false` to all of them —
 * the same answer as for an unknown user — after spending the peer's lookup budget as before.
 */
export async function serveDirectoryPair(
  origin: string,
  _body: DirectoryPair
): Promise<DirectoryPairReply> {
  if (!takeDirectoryLookup(origin))
    return { kind: "directory-pair-reply", paired: false, limited: true };
  return NOT_PAIRED;
}
