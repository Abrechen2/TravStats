/**
 * The friends API's verbs (spec 2026-11-08 §11.4). A local friend is a `local_connections` row
 * (`localConnections.ts`); a remote friend delegates to the `/sharing/connections` services, which
 * stay the one implementation of the cross-server protocol; a leaderboard pairing without a
 * connection (the other server predates them) supports the comparison verbs only.
 */
import { prisma } from "../../db";
import type { LeaderboardScope } from "../../schemas/comparison";
import type { ConnectionSwitches } from "../../schemas/tripSharePeer";
import {
  acceptConnection,
  declineConnection,
  endConnection,
  requestConnection,
  updateConnectionSwitches,
} from "../sharing/federation/connections/actions";
import { lockPair, acceptConsent, declineConsent, remoteKey } from "../comparison/consents";
import { endRemote } from "../comparison/remote";
import { PERSON_SELECT } from "../sharing/people";
import { friendsError } from "./errors";
import {
  acceptLocal,
  declineLocal,
  findLocal,
  requestLocal,
  revokeLocal,
  setLocalSwitches,
  sidesOf,
} from "./localConnections";
import { resolveFriend } from "./resolve";
import { defaultScope, storeScope } from "./scopeStore";
import { listFriends, type Friend } from "./view";

/** The friend as the page reads it now; the key or the connection id names it. */
export async function readFriend(
  userId: string,
  key: string,
  connectionId?: string
): Promise<Friend> {
  const { friends, requests } = await listFriends(userId);
  const found = [...friends, ...requests].find(
    (f) => f.key === key || (connectionId && f.connectionId === connectionId)
  );
  if (!found) throw friendsError("FRIENDS_NOT_FOUND", 404, "No such friend", { userId });
  return found;
}

/**
 * Ask for a friend. The answer never says whether the person exists or whether a request was
 * dropped: an unknown, inactive or own name on this server answers like a sent request.
 */
export async function createFriend(
  userId: string,
  input: { username: string; origin: string | null; switches: ConnectionSwitches }
): Promise<{ requested: true }> {
  if (input.origin && input.origin !== "local") {
    await requestConnection(userId, {
      origin: input.origin,
      username: input.username,
      switches: input.switches,
    });
    return { requested: true };
  }
  const target = await prisma.user.findFirst({
    where: { username: { equals: input.username.trim(), mode: "insensitive" }, isActive: true },
    select: PERSON_SELECT,
  });
  if (target && target.id !== userId) await requestLocal(userId, target.id, input.switches);
  return { requested: true };
}

export async function acceptFriend(
  userId: string,
  key: string,
  switches: ConnectionSwitches
): Promise<Friend> {
  const target = await resolveFriend(userId, key);
  if (target.type === "local") {
    await acceptLocal(userId, target.otherId, switches);
    return readFriend(userId, key);
  }
  if (target.type === "connection") {
    await acceptConnection(userId, target.row.id, switches);
    return readFriend(userId, key, target.row.id);
  }
  const question = await prisma.leaderboardConsent.findFirst({
    where: { ownerId: userId, remoteId: target.lb.id, status: "pending", decidedAt: null },
    select: { id: true },
  });
  if (!question)
    throw friendsError("FRIENDS_CONNECTION_STATE", 409, "Nothing waits for an answer", { userId });
  await acceptConsent(userId, question.id, await defaultScope(userId));
  return readFriend(userId, remoteKey(target.lb.id));
}

export async function declineFriend(userId: string, key: string): Promise<{ declined: true }> {
  const target = await resolveFriend(userId, key);
  if (target.type === "local") await declineLocal(userId, target.otherId);
  else if (target.type === "connection") {
    await declineConnection(userId, target.row.id);
    await dropOpenQuestion(userId, target.lb?.id ?? null);
  } else {
    const question = await prisma.leaderboardConsent.findFirst({
      where: { ownerId: userId, remoteId: target.lb.id, status: "pending", decidedAt: null },
      select: { id: true },
    });
    if (!question)
      throw friendsError("FRIENDS_CONNECTION_STATE", 409, "Nothing waits for an answer", {
        userId,
      });
    await declineConsent(userId, question.id);
  }
  return { declined: true };
}

/**
 * A request that came over an invitation link left the inviter an open comparison question
 * (spec §11.8). Declining the connection declines that too — the pairing goes and the link, already
 * spent, can not be used again.
 */
async function dropOpenQuestion(userId: string, lbId: string | null): Promise<void> {
  if (!lbId) return;
  const question = await prisma.leaderboardConsent.findFirst({
    where: { ownerId: userId, remoteId: lbId, status: "pending", decidedAt: null },
    select: { id: true },
  });
  if (question) await declineConsent(userId, question.id);
}

export async function setFriendSwitches(
  userId: string,
  key: string,
  switches: ConnectionSwitches
): Promise<Friend> {
  const target = await resolveFriend(userId, key);
  if (target.type === "local") {
    await setLocalSwitches(userId, target.otherId, switches);
    return readFriend(userId, key);
  }
  if (target.type === "connection") {
    await updateConnectionSwitches(userId, target.row.id, switches);
    return readFriend(userId, key, target.row.id);
  }
  throw friendsError("FRIENDS_CONNECTION_STATE", 409, "That server has no connections to switch", {
    userId,
  });
}

/** Store the comparison scope; the leaderboard switch keeps its state. */
export async function setFriendScope(
  userId: string,
  key: string,
  scope: LeaderboardScope
): Promise<Friend> {
  const target = await resolveFriend(userId, key);
  if (target.type === "local") {
    await prisma.$transaction(async (tx) => {
      await lockPair(tx, userId, target.otherId);
      const row = await findLocal(tx, userId, target.otherId);
      if (!row || row.state !== "active")
        throw friendsError("FRIENDS_CONNECTION_STATE", 409, "Not connected", { userId });
      await storeScope(
        tx,
        userId,
        { viewerId: target.otherId },
        scope,
        sidesOf(row, userId).mine.leaderboard
      );
    });
    return readFriend(userId, key);
  }
  const lb = target.lb;
  if (!lb)
    throw friendsError("FRIENDS_SCOPE_UNAVAILABLE", 409, "That connection has no leaderboard", {
      userId,
    });
  if (target.type === "connection" && target.row.state !== "active")
    throw friendsError("FRIENDS_CONNECTION_STATE", 409, "Not connected", { userId });
  const on = target.type === "connection" ? target.row.shareLeaderboard : true;
  await prisma.$transaction((tx) => storeScope(tx, userId, { remoteId: lb.id }, scope, on));
  return readFriend(userId, remoteKey(lb.id));
}

export async function removeFriend(userId: string, key: string): Promise<{ removed: true }> {
  const target = await resolveFriend(userId, key);
  if (target.type === "local") await revokeLocal(userId, target.otherId);
  else if (target.type === "connection") await endConnection(userId, target.row.id);
  else await endRemote(userId, target.lb.id);
  return { removed: true };
}
