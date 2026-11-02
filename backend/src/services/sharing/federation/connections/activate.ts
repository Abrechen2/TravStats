/**
 * What a connection turning `active` writes (spec 2026-11-02 §2), on either side: the consents the
 * trip-sharing code reads (a yes in both directions — WHO may offer is the switch, checked in
 * `switches.ts`, not the consent), and the leaderboard pairing both servers name alike. The
 * leaderboard consent itself follows the person's switch and is written outside the transaction
 * (`applyLeaderboardSwitch`), because it opens a transaction of its own.
 */
import { prisma, type DbTransaction } from "../../../../db";
import logger from "../../../../utils/logger";
import { setLeaderboardConsent } from "../../../federation/leaderboardBridge";
import { ensureLeaderboardPairing } from "../directory";
import { endShowing } from "../remoteStats";

interface Pairing {
  id: string;
  userId: string;
  origin: string;
  channel: string;
  localChannel: string;
  username: string;
  displayName: string;
  leaderboardRemoteId: string | null;
}

export async function activateConnection(
  tx: DbTransaction,
  pairing: Pairing,
  proposedLeaderboardChannel: string
): Promise<string | null> {
  const now = new Date();
  await tx.shareConsent.upsert({
    where: {
      requesterId_remoteTargetId: { requesterId: pairing.userId, remoteTargetId: pairing.id },
    },
    create: {
      requesterId: pairing.userId,
      remoteTargetId: pairing.id,
      status: "accepted",
      decidedAt: now,
    },
    update: { status: "accepted", decidedAt: now },
  });
  await tx.shareConsent.upsert({
    where: {
      remoteRequesterId_targetId: { remoteRequesterId: pairing.id, targetId: pairing.userId },
    },
    create: {
      remoteRequesterId: pairing.id,
      targetId: pairing.userId,
      status: "accepted",
      decidedAt: now,
    },
    update: { status: "accepted", decidedAt: now },
  });
  return ensureLeaderboardPairing(
    tx,
    pairing,
    pairing.origin,
    { username: pairing.username, displayName: pairing.displayName },
    proposedLeaderboardChannel
  );
}

/**
 * The two servers must name the leaderboard pairing alike; when they do not, it is unlinked and the
 * leaderboard switch goes off (as the directory did), so nothing reads as a pairing the other side
 * does not know.
 */
export async function reconcileLeaderboard(
  tx: DbTransaction,
  pairing: Pairing,
  local: string | null,
  theirs: string
): Promise<boolean> {
  if (local === theirs) return true;
  logger.warn(
    {
      operation: "connection_leaderboard_mismatch",
      userId: pairing.userId,
      origin: pairing.origin,
    },
    "The leaderboard channels of a connection differ; the leaderboard is unlinked for it"
  );
  await endShowing(tx, pairing.id);
  await tx.remoteShareAccount.update({
    where: { id: pairing.id },
    data: { leaderboardRemoteId: null, shareLeaderboard: false },
  });
  return false;
}

/**
 * Make the leaderboard consent follow the switch. Granting runs in a transaction of its own, so a
 * revoke can land between the connection's commit and the grant: after granting, the connection is
 * read again and a grant on a connection that is no longer active, or whose switch went off, is
 * withdrawn at once.
 */
export async function applyLeaderboardSwitch(
  userId: string,
  connectionId: string,
  on: boolean
): Promise<void> {
  const row = await prisma.remoteShareAccount.findUnique({
    where: { id: connectionId },
    select: { leaderboardRemoteId: true },
  });
  const lbId = row?.leaderboardRemoteId;
  if (!lbId) return;
  try {
    await setLeaderboardConsent(userId, lbId, on);
    if (!on) return;
    const now = await prisma.remoteShareAccount.findUnique({
      where: { id: connectionId },
      select: { state: true, shareLeaderboard: true },
    });
    if (now?.state !== "active" || !now.shareLeaderboard)
      await setLeaderboardConsent(userId, lbId, false);
  } catch (err) {
    logger.error(
      { operation: "connection_leaderboard_switch_failed", userId, err },
      "The leaderboard consent could not follow the connection's switch"
    );
    throw err;
  }
}
