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
import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { PERSON_SELECT, toPerson } from "../people";
import {
  inviteClaimReplySchema,
  type InviteClaimReply,
  type InviteRefusal,
  type TripOffer,
} from "../../../schemas/tripSharePeer";
import logger from "../../../utils/logger";
import { serveOffer } from "./offerInbox";
import { hash } from "../../federation/refusal";
import { requireTripFederation } from "./access";
import { remoteShareError, type RemoteShareErrorCode } from "./errors";
import { parseTripInviteCode } from "./inviteCode";
import { readRemotePerson, type RemotePersonView } from "./remotePeople";
import { messageHeader, tripShareExchange } from "./transport";
import {
  LOCAL_ERROR,
  kindOf,
  requireAdmitted,
  requireTripSharePeer,
  unreachable,
} from "./peerCheck";

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
  answer: Accepted,
  claimedCodeHash: string
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
          claimedCodeHash,
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

/**
 * A trip page's invitation brings its offer in the reply (F-S4c). It is recorded like an offer
 * that arrived on its own — the pairing it is addressed to exists by now — and waits for the
 * person's answer. If it cannot be recorded, the pairing still stands and the issuer can offer
 * the trip again from the trip page; the claim itself has succeeded either way.
 */
async function takeOfferWithClaim(userId: string, origin: string, offer: TripOffer): Promise<void> {
  try {
    const ack = await serveOffer(origin, offer);
    if ("rejected" in ack)
      logger.warn(
        { operation: "trip_share_claim_offer_rejected", userId, origin, kind: ack.rejected },
        "The offer that came with the invitation was not recorded"
      );
  } catch (err) {
    logger.error(
      { operation: "trip_share_claim_offer_failed", userId, origin, err },
      "The offer that came with the invitation was not recorded"
    );
  }
}

/**
 * The issuer answered "used": if this account redeemed exactly this code with that server before
 * (a double click, a retry after the reply was shown late), the pairing it made is the answer —
 * the person is connected already. Only the issuer's one-time rule decided anything; nothing about
 * it changes here.
 */
async function alreadyRedeemedHere(
  userId: string,
  origin: string,
  secret: string
): Promise<string | null> {
  const pairing = await prisma.remoteShareAccount.findFirst({
    where: { userId, origin, claimedCodeHash: hash(secret) },
    select: { id: true },
  });
  return pairing?.id ?? null;
}

/** A claim's result: the person, and whether the pairing existed before this claim. */
export type ClaimResult = RemotePersonView & { alreadyConnected?: true };

export async function claimTripInvite(userId: string, code: string): Promise<ClaimResult> {
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
    // This server's own failure is its own (a 500), not the other server's silence.
    const kind = kindOf(error);
    throw kind === LOCAL_ERROR ? error : unreachable(userId, parsed.origin, kind);
  }
  if (!reply.accepted && reply.reason === "used") {
    const existing = await alreadyRedeemedHere(userId, parsed.origin, parsed.secret);
    if (existing)
      return { ...(await readRemotePerson(userId, existing)), alreadyConnected: true as const };
  }
  if (!reply.accepted)
    throw remoteShareError(
      REFUSAL_CODES[reply.reason],
      reply.reason === "duplicate" ? 409 : 400,
      "The invitation was not redeemed",
      { userId, origin: parsed.origin, kind: reply.reason }
    );
  const remoteId = await recordPairing(
    userId,
    parsed.origin,
    localChannel,
    reply,
    hash(parsed.secret)
  );
  if (reply.offer) await takeOfferWithClaim(userId, parsed.origin, reply.offer);
  return readRemotePerson(userId, remoteId);
}
