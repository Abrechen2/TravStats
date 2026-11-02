/**
 * The user's side of a connection (spec 2026-11-02 §5): ask, confirm, decline, change what is
 * shared, end. No network call runs inside a database transaction.
 *
 * Asking and confirming need the other server, so they send and fail as themselves: a confirmation
 * changes nothing until the other server has it, and a request that failed to send stays as a
 * pending row (the answer may be what was lost) that can be sent again or taken back. Declining, changing a switch and ending act on this server FIRST: what
 * this side gives must stop at once whether or not the other server answers. The announcement
 * follows once, best effort; a missed one is logged, and the next change carries a newer generation.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import { Prisma } from "../../../../prisma";
import logger from "../../../../utils/logger";
import { PERSON_SELECT, toPerson } from "../../people";
import {
  connectReplySchema,
  type ConnectionSwitches,
  type TripSharePacket,
} from "../../../../schemas/tripSharePeer";
import { requireTripFederation } from "../access";
import { remoteShareError } from "../errors";
import { peerSupports } from "../peerFeatures";
import { revokePairing } from "../lifecycle";
import {
  LOCAL_ERROR,
  kindOf,
  requireAdmitted,
  requireTripSharePeer,
  unreachable,
} from "../peerCheck";
import { messageHeader, tripShareExchange } from "../transport";
import { activateConnection, applyLeaderboardSwitch, reconcileLeaderboard } from "./activate";
import { columnsOf } from "./switches";
import { connectionView, readConnection, type ConnectionView } from "./view";

type Account = Prisma.RemoteShareAccountGetPayload<object>;

async function own(userId: string, id: string): Promise<Account> {
  const row = await prisma.remoteShareAccount.findFirst({ where: { id, userId } });
  if (!row)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  return row;
}

const wrongState = (userId: string, origin: string) =>
  remoteShareError(
    "SHARE_REMOTE_CONNECTION_STATE",
    409,
    "The connection is not in a state this can be done in",
    { userId, origin },
    { origin }
  );

/** Send one connection message and require the plain acknowledgement. */
async function send(userId: string, origin: string, body: TripSharePacket): Promise<void> {
  try {
    connectReplySchema.parse(await tripShareExchange(origin, body));
  } catch (error) {
    const kind = kindOf(error);
    throw kind === LOCAL_ERROR ? error : unreachable(userId, origin, kind);
  }
}

/** The announcement of something already done here: tried once, a miss is logged. */
async function announce(row: Account, body: TripSharePacket): Promise<void> {
  try {
    await send(row.userId, row.origin, body);
  } catch (err) {
    logger.warn(
      { operation: "connection_announce_failed", userId: row.userId, origin: row.origin, err },
      "The other server did not get a connection message; it learns from the next one"
    );
  }
}

async function me(userId: string) {
  return toPerson(
    await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT })
  );
}

async function requireReachable(userId: string, origin: string): Promise<void> {
  await requireAdmitted(userId, origin);
  await requireTripSharePeer(userId, origin);
  if (!(await peerSupports(origin, "connections").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin },
      { origin }
    );
}

/** The leaderboard channel this side proposes: the linked pairing's own, else a new one. */
async function leaderboardChannelOf(row: Pick<Account, "leaderboardRemoteId">): Promise<string> {
  const linked = row.leaderboardRemoteId
    ? await prisma.leaderboardRemote.findUnique({
        where: { id: row.leaderboardRemoteId },
        select: { channel: true },
      })
    : null;
  return linked?.channel ?? randomUUID();
}

/** Send a request for `row` (a new one or a pairing to confirm), putting the row back on failure. */
async function sendRequest(
  userId: string,
  row: Account,
  switches: ConnectionSwitches,
  toUsername: string
): Promise<ConnectionView> {
  const person = await me(userId);
  const proposed = await leaderboardChannelOf(row);
  const generation = row.generation + 1;
  const pending = await prisma.remoteShareAccount.update({
    where: { id: row.id },
    data: {
      state: "pending_out",
      generation,
      ...columnsOf(switches),
      peerLeaderboardChannel: proposed,
      requestedAt: new Date(),
      confirmedAt: null,
      endedAt: null,
      endedByMe: false,
    },
  });
  // A failed send does not prove the other server got nothing (the answer may be what was lost),
  // so the pending row stays: the person sees it, can send again (the same row, a newer
  // generation) or take it back.
  await send(userId, row.origin, {
    kind: "connect-request",
    ...messageHeader(),
    channel: row.localChannel,
    leaderboardChannel: proposed,
    generation,
    toUsername,
    fromUsername: person.username,
    fromDisplayName: person.displayName,
    switches,
  });
  return connectionView(pending);
}

/**
 * Ask a person on a connected server to connect. The answer never says whether the person exists
 * or is findable: a request to anyone is "sent" and waits.
 */
export async function requestConnection(
  userId: string,
  input: { origin: string; username: string; switches: ConnectionSwitches }
): Promise<ConnectionView> {
  const local = await requireTripFederation(userId);
  if (input.origin === local.origin)
    throw remoteShareError("SHARE_REMOTE_INVITE_OWN_SERVER", 400, "That is this server", {
      userId,
    });
  await requireReachable(userId, input.origin);
  const known = await prisma.remoteShareAccount.findFirst({
    where: { userId, origin: input.origin, username: input.username },
    orderBy: { createdAt: "desc" },
  });
  if (known && ["active", "pending_in"].includes(known.state))
    throw remoteShareError(
      "SHARE_REMOTE_CONNECTION_EXISTS",
      409,
      "There is a connection with that person already",
      { userId, origin: input.origin },
      { origin: input.origin }
    );
  const row =
    known ??
    // The other side's channel is unknown until it answers: a placeholder keeps the row unique.
    (await prisma.remoteShareAccount.create({
      data: {
        userId,
        origin: input.origin,
        channel: randomUUID(),
        localChannel: randomUUID(),
        username: input.username,
        displayName: input.username,
        state: "pending_out",
      },
    }));
  return sendRequest(userId, row, input.switches, input.username);
}

/**
 * Confirm a request with the switches the person chose, or — for a pairing from before
 * connections (`reconfirm`) — ask the other side to confirm it again.
 */
export async function acceptConnection(
  userId: string,
  id: string,
  switches: ConnectionSwitches
): Promise<ConnectionView> {
  await requireTripFederation(userId);
  const row = await own(userId, id);
  if (row.state === "reconfirm") {
    await requireReachable(userId, row.origin);
    return sendRequest(userId, row, switches, row.username);
  }
  if (row.state !== "pending_in") throw wrongState(userId, row.origin);
  await requireReachable(userId, row.origin);
  const person = await me(userId);
  const proposed = row.peerLeaderboardChannel ?? (await leaderboardChannelOf(row));
  const generation = row.generation + 1;
  await send(userId, row.origin, {
    kind: "connect-accept",
    ...messageHeader(),
    from: row.localChannel,
    to: row.channel,
    generation,
    username: person.username,
    displayName: person.displayName,
    leaderboardChannel: proposed,
    switches,
  });
  // Only if nothing happened to the row while the other server was answering (a revoke, a second
  // answer): the state and generation read before the send must still hold.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.remoteShareAccount.updateMany({
      where: { id: row.id, state: "pending_in", generation: row.generation },
      data: {
        state: "active",
        generation,
        ...columnsOf(switches),
        confirmedAt: new Date(),
        endedAt: null,
        endedByMe: false,
      },
    });
    if (claimed.count !== 1) throw wrongState(userId, row.origin);
    const active = await tx.remoteShareAccount.findUniqueOrThrow({ where: { id: row.id } });
    const linked = await activateConnection(tx, active, proposed);
    await reconcileLeaderboard(tx, active, linked, proposed);
  });
  if (switches.leaderboard) await applyLeaderboardSwitch(userId, row.id, true);
  return readConnection(userId, id);
}

/** Decline a request; the person's next requests are dropped for 30 days. Tells them once. */
export async function declineConnection(userId: string, id: string): Promise<ConnectionView> {
  await requireTripFederation(userId);
  const row = await own(userId, id);
  if (row.state !== "pending_in") throw wrongState(userId, row.origin);
  const generation = row.generation + 1;
  await prisma.remoteShareAccount.update({
    where: { id },
    data: { state: "declined", generation, endedAt: new Date(), endedByMe: true },
  });
  await announce(row, {
    kind: "connect-decline",
    ...messageHeader(),
    from: row.localChannel,
    to: row.channel,
    generation,
  });
  return readConnection(userId, id);
}

/** Change what this side gives. It takes effect here at once; the other side is told after. */
export async function updateConnectionSwitches(
  userId: string,
  id: string,
  switches: ConnectionSwitches
): Promise<ConnectionView> {
  await requireTripFederation(userId);
  const row = await own(userId, id);
  if (row.state !== "active") throw wrongState(userId, row.origin);
  if (switches.leaderboard && !row.leaderboardRemoteId)
    throw remoteShareError(
      "SHARE_REMOTE_LEADERBOARD_UNAVAILABLE",
      409,
      "That connection has no leaderboard",
      { userId, origin: row.origin }
    );
  const generation = row.generation + 1;
  const changed = await prisma.remoteShareAccount.updateMany({
    where: { id, state: "active", generation: row.generation },
    data: { ...columnsOf(switches), generation },
  });
  if (changed.count !== 1) throw wrongState(userId, row.origin);
  // After the switch is stored: the consent follows it, and a revoke that lands meanwhile is
  // re-checked (`applyLeaderboardSwitch`).
  if (switches.leaderboard !== row.shareLeaderboard)
    await applyLeaderboardSwitch(userId, row.id, switches.leaderboard);
  await announce(row, {
    kind: "connect-settings",
    ...messageHeader(),
    from: row.localChannel,
    to: row.channel,
    generation,
    switches,
  });
  return readConnection(userId, id);
}

/**
 * End a connection, or take back a request not yet answered. Everything shown through it stops
 * here at once (statistics, leaderboard, consents, memberships, open trip offers); the other side
 * is told, and refuses on its own as soon as it is.
 */
export async function endConnection(userId: string, id: string): Promise<ConnectionView> {
  await requireTripFederation(userId);
  const row = await own(userId, id);
  if (row.state === "pending_in") return declineConnection(userId, id);
  if (!["active", "reconfirm", "pending_out"].includes(row.state))
    throw wrongState(userId, row.origin);
  const generation = row.generation + 1;
  await prisma.$transaction(
    async (tx) => {
      await revokePairing(tx, row, true, false);
      await tx.remoteShareAccount.update({
        where: { id },
        data: { generation, endedByMe: true },
      });
    },
    { timeout: 30_000 }
  );
  await announce(row, {
    kind: "connect-revoke",
    ...messageHeader(),
    from: row.localChannel,
    to: row.channel,
    generation,
  });
  return readConnection(userId, id);
}
