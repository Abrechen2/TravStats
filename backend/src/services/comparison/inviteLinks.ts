/**
 * Invitation links (spec 2026-11-07 §6.2, §6.3). A link carries the inviting server's identity
 * and a single-use token in the URL fragment; redeeming it on the friend's server either claims
 * at once (that server is already pinned with this key) or queues an outgoing admission request
 * for the friend's admin. A user never pins, replaces a key or re-enables a peer.
 */
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";
import type { DbTransaction } from "../../db";
import type { FederationAdmissionRequest } from "../../prisma";
import {
  inviteLinkPayloadSchema,
  INVITE_LINK_KIND,
  INVITE_PAYLOAD_MAX_CHARS,
  type InviteLinkPayload,
} from "../../schemas/inviteLink";
import type { LeaderboardScope } from "../../schemas/comparison";
import { admissionError } from "../federation/admissionErrors";
import { expireStaleAdmissions } from "../federation/admission";
import { deferIdentityFetch, fetchPeerIdentity } from "../federation/admissionIdentity";
import { loadIdentity } from "../federation/identity";
import { fingerprintOfRaw, pemFromRawPublicKey, rawPublicKey } from "../federation/rawKey";
import { PeerRefusal } from "../federation/refusal";
import { claimInvite, createInvite } from "./remote";
import { comparisonError } from "./errors";

export const OPEN_REQUESTS_PER_USER = 5;
export const OPEN_REQUESTS_PER_INSTANCE = 20;
const OPEN: string[] = ["pending", "sent"];

export type RedeemStatus = "claimed" | "awaitingAdmin" | "awaitingPeerAdmin";

const encode = (payload: InviteLinkPayload): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

/** Parses the text after `#`; any damage is a named 400 and nothing leaves this server. */
export function decodeInviteLinkPayload(text: string): InviteLinkPayload {
  const invalid = (reason: string) =>
    admissionError("FEDERATION_ADMISSION_INVALID", 400, "Not an invitation link", { reason });
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > INVITE_PAYLOAD_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(trimmed))
    throw invalid("shape");
  let parsed: InviteLinkPayload;
  try {
    parsed = inviteLinkPayloadSchema.parse(
      JSON.parse(Buffer.from(trimmed, "base64url").toString())
    );
  } catch {
    throw invalid("payload");
  }
  // The key and its fingerprint must agree, or the link describes no server at all.
  if (fingerprintOfRaw(parsed.publicKey) !== parsed.fingerprint) throw invalid("fingerprint");
  return parsed;
}

async function identityOrThrow(userId: string) {
  try {
    return await loadIdentity();
  } catch (error) {
    if (error instanceof PeerRefusal)
      throw admissionError(
        "FEDERATION_ADMISSION_DISABLED",
        409,
        "This server is not connected to other servers",
        { userId }
      );
    throw error;
  }
}

/** A link to hand to a friend: this server's identity plus one fresh single-use token. */
export async function createInviteLink(
  userId: string
): Promise<{ url: string; expiresAt: string }> {
  // The same row, cap and lock as a plain code; the link only wraps the secret.
  const { code, expiresAt } = await createInvite(userId);
  const at = code.lastIndexOf("#");
  const identity = await loadIdentity();
  const publicKey = rawPublicKey(identity.publicKey);
  if (!publicKey) throw new Error("The federation key is not an Ed25519 public key");
  const payload: InviteLinkPayload = {
    v: 1,
    kind: INVITE_LINK_KIND,
    origin: code.slice(0, at),
    publicKey,
    fingerprint: identity.fingerprint,
    token: code.slice(at + 1),
    expiresAt,
  };
  return { url: `${payload.origin}/freunde/einladung#${encode(payload)}`, expiresAt };
}

async function lockAdmissions(tx: DbTransaction): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended('federation-admissions-outgoing', 0))) l`;
}

const statusOf = (row: Pick<FederationAdmissionRequest, "status">): RedeemStatus =>
  row.status === "sent" ? "awaitingPeerAdmin" : "awaitingAdmin";

/** Queues the request under the caps; a repeat redeem of the same server answers the open one. */
async function queueOutgoing(
  userId: string,
  link: InviteLinkPayload,
  scope: LeaderboardScope
): Promise<RedeemStatus> {
  const pem = pemFromRawPublicKey(link.publicKey) as string;
  await expireStaleAdmissions();
  return prisma.$transaction(async (tx) => {
    await lockAdmissions(tx);
    const existing = await tx.federationAdmissionRequest.findUnique({
      where: {
        direction_origin_localUserId: {
          direction: "outgoing",
          origin: link.origin,
          localUserId: userId,
        },
      },
    });
    if (existing && OPEN.includes(existing.status)) return statusOf(existing);
    const open = await tx.federationAdmissionRequest.findMany({
      where: { direction: "outgoing", status: { in: OPEN } },
      select: { localUserId: true },
    });
    if (open.filter((r) => r.localUserId === userId).length >= OPEN_REQUESTS_PER_USER)
      throw admissionError("FEDERATION_ADMISSION_FULL", 429, "Too many open requests", { userId });
    if (open.length >= OPEN_REQUESTS_PER_INSTANCE)
      throw admissionError("FEDERATION_ADMISSION_FULL", 429, "The admission queue is full", {
        userId,
      });
    // A decided or expired request of the same pair makes way for the new one.
    if (existing) await tx.federationAdmissionRequest.delete({ where: { id: existing.id } });
    const created = await tx.federationAdmissionRequest.create({
      data: {
        direction: "outgoing",
        origin: link.origin,
        publicKey: pem,
        fingerprint: link.fingerprint,
        localUserId: userId,
        inviteRef: encryptApiKey(link.token) as string,
        scope: scope as never,
        // The token dies with the link; the 14 days start when this server's admin approves.
        expiresAt: new Date(link.expiresAt),
      },
    });
    return statusOf(created);
  });
}

export async function redeemInviteLink(
  userId: string,
  payloadText: string,
  scope: LeaderboardScope
): Promise<{ status: RedeemStatus }> {
  const link = decodeInviteLinkPayload(payloadText);
  const local = await identityOrThrow(userId);
  if (link.origin === local.origin)
    throw admissionError("FEDERATION_ADMISSION_INVALID", 400, "A link from this server", {
      userId,
    });
  if (new Date(link.expiresAt) <= new Date())
    throw comparisonError("COMPARISON_INVITE_INVALID", 400, "The invitation has expired", {
      userId,
    });
  const pem = pemFromRawPublicKey(link.publicKey) as string;
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: link.origin } });
  if (peer) {
    // A user never replaces a key (Codex 13) and never re-enables a suspended peer.
    if (peer.publicKey !== pem)
      throw admissionError(
        "FEDERATION_ADMISSION_KEY_MISMATCH",
        409,
        "That server is pinned with a different key",
        { userId, origin: link.origin }
      );
    if (!peer.enabled)
      throw admissionError("FEDERATION_ADMISSION_SUSPENDED", 409, "That server is suspended", {
        userId,
        origin: link.origin,
      });
    await claimInvite(userId, `${link.origin}#${link.token}`, scope);
    return { status: "claimed" };
  }
  if (!deferIdentityFetch()) {
    const found = await fetchPeerIdentity(link.origin);
    if (found.publicKey !== pem)
      throw admissionError(
        "FEDERATION_ADMISSION_KEY_MISMATCH",
        409,
        "The server's key is not the one in the link",
        { userId, origin: link.origin }
      );
  }
  return { status: await queueOutgoing(userId, link, scope) };
}

export interface OwnAdmission {
  id: string;
  origin: string;
  fingerprint: string;
  status: FederationAdmissionRequest["status"];
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
}

/** The caller's own outgoing requests, newest first. */
export async function listOwnAdmissions(userId: string): Promise<OwnAdmission[]> {
  await expireStaleAdmissions();
  const rows = await prisma.federationAdmissionRequest.findMany({
    where: { direction: "outgoing", localUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    origin: r.origin,
    fingerprint: r.fingerprint,
    status: r.status,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}
