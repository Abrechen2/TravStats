/**
 * The verifying ping, in one place: the admin's "Verbinden prüfen", an approved admission and the
 * delivery job all mark a pin as verified the same way. The answer is stored only while the peer
 * is still pinned as it was read (an admin who suspended or re-pinned it meanwhile wins).
 */
import { prisma } from "../../db";
import { pingReplySchema } from "../../schemas/federationAdmin";
import { exchange } from "./security";

export async function verifyPeerByPing(origin: string): Promise<boolean> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled) return false;
  const reply = pingReplySchema.parse(await exchange(origin, { action: "ping" }));
  const stored = await prisma.comparisonPeer.updateMany({
    where: { origin, enabled: true, publicKey: peer.publicKey },
    data: { verifiedAt: new Date(), leaderboardVersions: reply.leaderboard ?? [] },
  });
  return stored.count === 1;
}
