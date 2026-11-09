import { prisma } from "../../db";
import type { LeaderboardRemote, RemoteShareAccount } from "../../prisma";
import { friendsError } from "./errors";

export type Resolved =
  | { type: "local"; otherId: string }
  | { type: "connection"; row: RemoteShareAccount; lb: LeaderboardRemote | null }
  | { type: "comparison"; lb: LeaderboardRemote };

const notFound = (userId: string) =>
  friendsError("FRIENDS_NOT_FOUND", 404, "No such friend", { userId });

/**
 * A friend key to what it names. `remote:<id>` is the connection's own id or its leaderboard
 * pairing's — the same person either way — and only the caller's rows resolve.
 */
export async function resolveFriend(userId: string, key: string): Promise<Resolved> {
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (kind === "local") {
    const other = await prisma.user.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!other || other.id === userId) throw notFound(userId);
    return { type: "local", otherId: id };
  }
  const direct = await prisma.remoteShareAccount.findFirst({ where: { id, userId } });
  if (direct) {
    const lb = direct.leaderboardRemoteId
      ? await prisma.leaderboardRemote.findUnique({ where: { id: direct.leaderboardRemoteId } })
      : null;
    return { type: "connection", row: direct, lb };
  }
  const lb = await prisma.leaderboardRemote.findFirst({
    where: { id, userId },
    include: { sharePairing: true },
  });
  if (!lb) throw notFound(userId);
  const { sharePairing, ...pairing } = lb;
  return sharePairing
    ? { type: "connection", row: sharePairing, lb: pairing }
    : { type: "comparison", lb: pairing };
}
