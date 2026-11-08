/**
 * Redeeming an invitation link asks for a connection (spec 2026-11-08 §11.8). It never activates
 * one: the connection request goes to the inviter, who sees who redeemed it and confirms. It is
 * bound to the leaderboard pairing the claim just made, so the two are one friend.
 *
 * Best effort: the claim already stands. A server that predates connections, or one that is not
 * reachable for trip sharing, leaves the friend as a comparison-only pairing (§11.7).
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { ConnectionSwitches } from "../../schemas/tripSharePeer";
import { requestConnection } from "../sharing/federation/connections/actions";

export async function requestAfterClaim(
  userId: string,
  leaderboardRemoteId: string,
  switches: ConnectionSwitches
): Promise<"requested" | "comparisonOnly"> {
  const lb = await prisma.leaderboardRemote.findFirst({
    where: { id: leaderboardRemoteId, userId },
  });
  if (!lb) return "comparisonOnly";
  try {
    await requestConnection(userId, {
      origin: lb.origin,
      username: lb.username,
      switches,
      leaderboardRemoteId: lb.id,
    });
    return "requested";
  } catch (error) {
    logger.info(
      { operation: "friends_link_request_fallback", userId, origin: lb.origin, err: error },
      "The link's connection request was not sent; the friend stays comparison-only"
    );
    return "comparisonOnly";
  }
}
