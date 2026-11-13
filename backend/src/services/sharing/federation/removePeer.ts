/**
 * Stop trusting a server for good (settings v3 `peerremove`). Where `/peers/suspend` only holds the
 * memberships until the pin is re-enabled, this ends them: every pairing with a person there is
 * revoked locally (consents withdrawn, memberships tombstoned, a spoke's copy of a shared trip
 * leaves its group and stays a plain local trip), leaderboard friendships, comparison grants and
 * admission requests with it end, the queues towards that server are dropped and the pin itself is
 * deleted. Without a pin nothing is accepted from that origin and nothing is sent
 * (`requireAdmitted`, the signature check), and the other server is not told: it is the one
 * being cut off, and its next message is refused.
 */
import { prisma } from "../../../db";
import { revokePairing } from "./lifecycle";

export interface RemovedPeer {
  pairings: number;
  /** Trips that were shared through this server; they all stay here as local copies. */
  trips: number;
}

export async function removePeer(origin: string): Promise<RemovedPeer> {
  return prisma.$transaction(
    async (tx) => {
      const pairings = await tx.remoteShareAccount.findMany({
        where: { origin, state: { notIn: ["revoked", "declined"] } },
      });
      const groups = await tx.tripShareRemoteMember.findMany({
        where: { remote: { origin } },
        select: { groupId: true },
      });
      const groupIds = [...new Set(groups.map((g) => g.groupId))];
      // Counted before the revoke detaches copies: these are the trips that were shared through it.
      const trips = await tx.trip.count({ where: { shareGroupId: { in: groupIds } } });
      for (const pairing of pairings) await revokePairing(tx, pairing, false, true);
      await tx.tripShareOutbox.deleteMany({ where: { peerOrigin: origin } });
      // Everything else that rode on the pin ends too, or re-pinning the same server would bring
      // it back without anyone reconnecting (Codex, rc.29 review): leaderboard friendships (their
      // consents cascade), end-to-end comparison grants, queued connection messages and open
      // admission requests.
      await tx.leaderboardRemote.deleteMany({ where: { origin } });
      await tx.comparisonGrant.updateMany({
        where: { link: { origin }, active: true },
        data: { active: false },
      });
      await tx.comparisonLink.updateMany({ where: { origin }, data: { revoked: true } });
      await tx.connectionAnnouncement.deleteMany({ where: { peerOrigin: origin } });
      await tx.federationAdmissionRequest.updateMany({
        where: { origin, status: { in: ["pending", "sent", "approved"] } },
        data: { status: "failed", failureReason: "peer-removed", nextAttemptAt: null },
      });
      await tx.comparisonPeer.delete({ where: { origin } });
      return { pairings: pairings.length, trips };
    },
    { timeout: 30_000 }
  );
}
