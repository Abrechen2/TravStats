/**
 * The one place where the trip-share side of a pairing (a remote person's statistics level and
 * leaderboard switch, forgejo#301) touches the leaderboard's own machinery: the totals builder,
 * its snapshot schema and its consent. `separation.test.ts` keeps the two PROTOCOLS apart — no
 * packet of one parses as the other, and neither wire module imports the other — so this bridge
 * lives outside both lists, and the trip-share wire carries the snapshot as opaque JSON that is
 * parsed here, on the receiving side only.
 */
import { prisma, type DbTransaction } from "../../db";
import { METRIC_GROUPS } from "../../shared/comparisonMetrics";
import { leaderboardSnapshotSchema, type LeaderboardSnapshot } from "../../schemas/comparison";
import { buildLeaderboardSnapshot } from "../comparison/aggregates";
import { lockRemotePair, scopeJson } from "../comparison/consents";
import { loadVisibleDomains } from "../domainVisibility";

export type { LeaderboardSnapshot };

/**
 * The groups the trip-share leaderboard switch hands over: the totals groups. Achievements are
 * their own consent (spec §6.4) and a switch that predates them must not grow into them.
 */
const TOTALS_GROUPS = METRIC_GROUPS.filter((g) => g !== "achievements");

/** Every group of every domain the person has visible, lifetime or one year: no entries. */
export async function buildOverviewSnapshot(
  userId: string,
  year: number | null
): Promise<LeaderboardSnapshot> {
  return buildLeaderboardSnapshot(
    userId,
    { groups: [...TOTALS_GROUPS], domains: await loadVisibleDomains(userId), year: null },
    year
  );
}

/** A snapshot another server sent: parsed before anything here looks at it. */
export const parseOverviewSnapshot = (raw: unknown): LeaderboardSnapshot =>
  leaderboardSnapshotSchema.parse(raw);

/**
 * The leaderboard switch for one remote pairing: on shares the totals through the existing
 * leaderboard consent (accepted, all groups, the domains the owner has visible), off withdraws it.
 */
export async function setLeaderboardConsent(
  ownerId: string,
  leaderboardRemoteId: string,
  on: boolean
): Promise<void> {
  const scope = scopeJson({
    groups: [...TOTALS_GROUPS],
    domains: await loadVisibleDomains(ownerId),
    year: null,
  });
  await prisma.$transaction(async (tx) => {
    await lockRemotePair(tx, ownerId, leaderboardRemoteId);
    const now = new Date();
    if (on)
      await tx.leaderboardConsent.upsert({
        where: { ownerId_remoteId: { ownerId, remoteId: leaderboardRemoteId } },
        create: {
          ownerId,
          remoteId: leaderboardRemoteId,
          status: "accepted",
          scope,
          decidedAt: now,
        },
        update: { status: "accepted", scope, decidedAt: now },
      });
    else
      await tx.leaderboardConsent.updateMany({
        where: { ownerId, remoteId: leaderboardRemoteId },
        data: { status: "withdrawn", decidedAt: now },
      });
  });
}

/** Withdraw the consent inside the caller's transaction (ending a pairing ends what it showed). */
export async function withdrawLeaderboardConsent(
  tx: Pick<DbTransaction, "leaderboardConsent">,
  ownerId: string,
  leaderboardRemoteId: string
): Promise<void> {
  await tx.leaderboardConsent.updateMany({
    where: { ownerId, remoteId: leaderboardRemoteId },
    data: { status: "withdrawn", decidedAt: new Date() },
  });
}
