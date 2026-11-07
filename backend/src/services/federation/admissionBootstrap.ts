/**
 * The receiving end of the bootstrap admission action (spec 2026-11-07 §6.2 step 4). The only
 * thing an unpinned origin can reach, so every step is a gate and every gate comes BEFORE
 * anything is stored or fetched that an anonymous caller could drive:
 *
 *   1. the envelope is well formed, for this protocol and for this server;
 *   2. the token is one of ours: known, unused, unexpired, its user active;
 *   3. only then is the sender's identity fetched (egress-checked) and the signature verified
 *      against THAT key, or against the pinned key if the sender is already pinned;
 *   4. only then is a request stored — one per token, one per sender and inviter.
 *
 * Any failure is the same `PeerRefusal` (the route answers a bare 403 and stores nothing). Once
 * the sender has proved itself, answers are signed replies with a status, never a 403.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { encryptApiKey } from "../../utils/encryption";
import { admitRequestSchema, type AdmitReply } from "../../schemas/federationAdmission";
import { ADMISSION_ACCEPTS, signedEnvelope, verifyEnvelope, type Envelope } from "./envelope";
import { ADMISSION_WINDOW_MS } from "./admission";
import { fetchPeerIdentity } from "./admissionIdentity";
import { loadIdentity, type Identity } from "./identity";
import { verifyPeerByPing } from "./peerVerification";
import { hash, refused } from "./refusal";
import { consumeNonce } from "./security";

export const MAX_OPEN_INCOMING = 20;
export const MAX_ADMIT_BODY_BYTES = 8_192;
const OPEN = ["pending"];

export async function handleAdmit(
  raw: unknown
): Promise<{ data: AdmitReply; message: Envelope; local: Identity }> {
  const local = await loadIdentity();
  const candidate = signedEnvelope.parse(raw);
  if (!("v" in candidate) || candidate.purpose !== ADMISSION_ACCEPTS.purpose)
    throw refused("wrong-purpose");
  if (candidate.destination !== local.origin || candidate.origin === local.origin) throw refused();
  const body = admitRequestSchema.parse(JSON.parse(candidate.body));
  if (body.origin !== candidate.origin) throw refused("bad-signature");

  // Gate 2: a token of ours, before this server fetches anything for an anonymous caller.
  const invite = await prisma.leaderboardInvite.findUnique({
    where: { hash: hash(body.token) },
    include: { user: { select: { isActive: true } } },
  });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.user.isActive)
    throw refused("unknown-peer");

  // Gate 3: whose key is it? A pinned sender is held to the pinned key and never re-read.
  const pinned = await prisma.comparisonPeer.findUnique({ where: { origin: candidate.origin } });
  if (pinned && !pinned.enabled) throw refused("unknown-peer");
  let publicKey = pinned?.publicKey;
  if (!publicKey) {
    try {
      publicKey = (await fetchPeerIdentity(candidate.origin)).publicKey;
    } catch {
      throw refused("unreachable");
    }
  }
  const message = verifyEnvelope(candidate, publicKey, local.origin, Date.now(), ADMISSION_ACCEPTS);
  await consumeNonce(message);

  if (pinned) {
    // Already admitted here (the old manual pin): no queue, straight to the claim. A pin nobody
    // has pinged yet is verified now, or the claim that follows would be refused as unverified.
    if (!pinned.verifiedAt)
      await verifyPeerByPing(pinned.origin).catch((error: unknown) =>
        logger.warn(
          { operation: "federation_admission_verify_failed", origin: pinned.origin, err: error },
          "Pinned sender could not be verified"
        )
      );
    return { data: { status: "approved" }, message, local };
  }
  const data = await storeIncoming({
    origin: candidate.origin,
    publicKey,
    inviterId: invite.userId,
    token: body.token,
  });
  return { data, message, local };
}

async function storeIncoming(input: {
  origin: string;
  publicKey: string;
  inviterId: string;
  token: string;
}): Promise<AdmitReply> {
  const inviteHash = hash(input.token);
  const expiresAt = new Date(Date.now() + ADMISSION_WINDOW_MS);
  return prisma.$transaction(async (tx) => {
    // One writer at a time: the cap, the one-per-token rule and the pair rule are all
    // read-then-write, and two admits of one token arrive together.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended('federation-admissions-incoming', 0))) l`;
    const bound = await tx.federationAdmissionRequest.findUnique({ where: { inviteHash } });
    if (bound) {
      // A token belongs to the first server that presented it; another one gets nothing.
      if (bound.origin !== input.origin) throw refused("unknown-peer");
      if (bound.status === "pending") return { status: "pending" as const };
      if (bound.status === "approved") return { status: "approved" as const };
      if (bound.status === "declined") return { status: "declined" as const };
      return { status: "refused" as const, reason: "expired" as const };
    }
    const open = await tx.federationAdmissionRequest.count({
      where: { direction: "incoming", status: { in: OPEN } },
    });
    if (open >= MAX_OPEN_INCOMING) return { status: "refused" as const, reason: "full" as const };
    const pair = await tx.federationAdmissionRequest.findUnique({
      where: {
        direction_origin_localUserId: {
          direction: "incoming",
          origin: input.origin,
          localUserId: input.inviterId,
        },
      },
    });
    if (pair && OPEN.includes(pair.status))
      return { status: "refused" as const, reason: "duplicate" as const };
    if (pair) await tx.federationAdmissionRequest.delete({ where: { id: pair.id } });
    await tx.federationAdmissionRequest.create({
      data: {
        direction: "incoming",
        origin: input.origin,
        publicKey: input.publicKey,
        fingerprint: hash(input.publicKey),
        localUserId: input.inviterId,
        inviteRef: encryptApiKey(input.token) as string,
        inviteHash,
        expiresAt,
      },
    });
    // A slow admin must not kill the invitation (§6.2 step 6): it stays redeemable as long as the
    // request is open. The claim that follows spends it, atomically, in `serveClaim`.
    await tx.leaderboardInvite.updateMany({
      where: { hash: inviteHash, expiresAt: { lt: expiresAt } },
      data: { expiresAt },
    });
    return { status: "pending" as const };
  });
}
