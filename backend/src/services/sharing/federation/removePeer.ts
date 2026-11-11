/**
 * Stop trusting a server for good (settings v3 `peerremove`). Where `/peers/suspend` only holds the
 * memberships until the pin is re-enabled, this ends them: every pairing with a person there is
 * revoked locally (consents withdrawn, memberships tombstoned, a spoke's copy of a shared trip
 * leaves its group and stays a plain local trip), the queue towards that server is dropped and the
 * pin itself is deleted. Without a pin nothing is accepted from that origin and nothing is sent
 * (`requireAdmitted`, the signature check), and the other server is not told: it is the one
 * being cut off, and its next message is refused.
 */
import { prisma } from "../../../db";
import { revokePairing } from "./lifecycle";

export interface RemovedPeer {
  pairings: number;
  /** Shared trips that were linked to a group through this server and now stand alone here. */
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
      for (const pairing of pairings) await revokePairing(tx, pairing, false, true);
      const trips = await tx.trip.count({ where: { shareGroupId: { in: groupIds } } });
      await tx.tripShareOutbox.deleteMany({ where: { peerOrigin: origin } });
      await tx.comparisonPeer.delete({ where: { origin } });
      return { pairings: pairings.length, trips };
    },
    { timeout: 30_000 }
  );
}
