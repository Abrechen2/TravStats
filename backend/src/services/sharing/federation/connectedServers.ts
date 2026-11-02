/**
 * The servers a user can reach for trip sharing, people lookup and statistics: the ones this
 * server's admin pinned, enabled, and a ping verified (server-level trust, forgejo#301). A server
 * the admin has not admitted is not listed, and every call towards it is refused anyway
 * (`requireAdmitted`).
 */
import { prisma } from "../../../db";

export async function listConnectedServers(): Promise<{ origin: string }[]> {
  const peers = await prisma.comparisonPeer.findMany({
    where: { enabled: true, verifiedAt: { not: null } },
    select: { origin: true },
    orderBy: { origin: "asc" },
    take: 100,
  });
  return peers.map((p) => ({ origin: p.origin }));
}
