/**
 * The claiming side of an invitation (spec 2026-10-20 F1, phase F-S4b): a user pastes a code
 * from someone on another server; this server redeems it there and records the pairing.
 *
 * Each way it can fail is its own code, because each asks the user for something different: a
 * leaderboard code pasted here (`WRONG_TAG`), a server the admin has not admitted (`PEER_NOT_
 * ADMITTED`, naming the origin so the user can ask their admin), a server with the feature off
 * or too old to have it (`PEER_DISABLED` / `PEER_OUTDATED`), one that does not answer
 * (`UNREACHABLE`), and the code's own fate (`INVITE_USED`, `INVITE_EXPIRED`, `INVITE_INVALID`).
 *
 * No network call runs inside a database transaction: the pairing is written after the other
 * server answered, never around the call.
 */
import { randomUUID } from "crypto";
import { ZodError } from "zod";
import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { PeerRefusal } from "../../federation/refusal";
import { PERSON_SELECT, toPerson } from "../people";
import {
  TRIP_SHARE_VERSIONS,
  inviteClaimReplySchema,
  tripPingReplySchema,
  type InviteClaimReply,
  type InviteRefusal,
} from "../../../schemas/tripSharePeer";
import { requireTripFederation } from "./access";
import { remoteShareError, type RemoteShareErrorCode } from "./errors";
import { parseTripInviteCode } from "./inviteCode";
import { readRemotePerson, type RemotePersonView } from "./remotePeople";
import { messageHeader, tripShareExchange } from "./transport";

const kindOf = (error: unknown): string =>
  error instanceof PeerRefusal
    ? error.kind
    : error instanceof ZodError || error instanceof SyntaxError
      ? "malformed"
      : "unreachable";

const unreachable = (userId: string, origin: string, kind: string) =>
  remoteShareError(
    "SHARE_REMOTE_UNREACHABLE",
    502,
    "That server does not answer",
    { userId, origin, kind },
    { origin }
  );

/** Admitted by this server's admin (pinned, enabled) AND verified by a ping that reached it. */
async function requireAdmitted(userId: string, origin: string): Promise<void> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled || !peer.verifiedAt)
    throw remoteShareError(
      "SHARE_REMOTE_PEER_NOT_ADMITTED",
      403,
      "The admin has not admitted that server",
      { userId, origin },
      { origin }
    );
}

/** The other server serves trip sharing version 1 and has it switched on. */
async function requireTripSharePeer(userId: string, origin: string): Promise<void> {
  let versions: number[];
  try {
    const reply = await tripShareExchange(origin, { kind: "ping", ...messageHeader() });
    versions = tripPingReplySchema.parse(reply).tripShare;
  } catch (error) {
    // 404: off there, or a server from before trip sharing — the route is absent either way.
    if (error instanceof PeerRefusal && error.kind === "remote-absent")
      throw remoteShareError(
        "SHARE_REMOTE_PEER_DISABLED",
        409,
        "That server does not share trips across servers",
        { userId, origin },
        { origin }
      );
    throw unreachable(userId, origin, kindOf(error));
  }
  if (!versions.some((v) => (TRIP_SHARE_VERSIONS as readonly number[]).includes(v)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin },
      { origin }
    );
}

const REFUSAL_CODES: Record<InviteRefusal, RemoteShareErrorCode> = {
  unknown: "SHARE_REMOTE_INVITE_INVALID",
  used: "SHARE_REMOTE_INVITE_USED",
  expired: "SHARE_REMOTE_INVITE_EXPIRED",
  duplicate: "SHARE_REMOTE_DUPLICATE",
};

type Accepted = Extract<InviteClaimReply, { accepted: true }>;

async function recordPairing(
  userId: string,
  origin: string,
  localChannel: string,
  answer: Accepted
): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const remote = await tx.remoteShareAccount.create({
        data: {
          userId,
          origin,
          channel: answer.channel,
          localChannel,
          username: answer.username,
          displayName: answer.displayName,
        },
      });
      // The claimant's yes: the issuer may share trips into this account.
      await tx.shareConsent.create({
        data: {
          remoteRequesterId: remote.id,
          targetId: userId,
          status: "accepted",
          decidedAt: new Date(),
        },
      });
      return remote.id;
    });
  } catch (error) {
    // A channel that server already gave us names another pairing: its answer is not usable.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw unreachable(userId, origin, "channel-reused");
    throw error;
  }
}

export async function claimTripInvite(userId: string, code: string): Promise<RemotePersonView> {
  const parsed = parseTripInviteCode(code);
  if (!parsed.ok)
    throw parsed.reason === "leaderboardCode"
      ? remoteShareError(
          "SHARE_REMOTE_INVITE_WRONG_TAG",
          400,
          "A leaderboard code, not a trip-sharing code",
          { userId }
        )
      : remoteShareError("SHARE_REMOTE_INVITE_INVALID", 400, "Not an invitation code", { userId });
  const local = await requireTripFederation(userId);
  if (parsed.origin === local.origin)
    throw remoteShareError("SHARE_REMOTE_INVITE_OWN_SERVER", 400, "A code from this server", {
      userId,
    });
  await requireAdmitted(userId, parsed.origin);
  await requireTripSharePeer(userId, parsed.origin);
  const me = toPerson(
    await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT })
  );
  const localChannel = randomUUID();
  let reply: InviteClaimReply;
  try {
    reply = inviteClaimReplySchema.parse(
      await tripShareExchange(parsed.origin, {
        kind: "invite-claim",
        ...messageHeader(),
        code: parsed.secret,
        channel: localChannel,
        username: me.username,
        displayName: me.displayName,
      })
    );
  } catch (error) {
    throw unreachable(userId, parsed.origin, kindOf(error));
  }
  if (!reply.accepted)
    throw remoteShareError(
      REFUSAL_CODES[reply.reason],
      reply.reason === "duplicate" ? 409 : 400,
      "The invitation was not redeemed",
      { userId, origin: parsed.origin, kind: reply.reason }
    );
  const remoteId = await recordPairing(userId, parsed.origin, localChannel, reply);
  return readRemotePerson(userId, remoteId);
}
