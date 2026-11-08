/**
 * Delivering an approved outgoing admission request (spec 2026-11-07 §6.2 steps 3 and 5, §9.3).
 * After this server's admin pinned the inviting server, the job tells it "admit me" with the
 * invitation token, signed. The inviting server answers with a status; this job repeats the ask
 * with backoff (1 minute doubling to 6 hours) until it is answered or 14 days have passed. When
 * the other admin has admitted this server, the pending claim runs here and the friend's request
 * arrives on the other server.
 *
 * A pass holds a short lease on a request (`nextAttemptAt`), so the job and an immediate kick
 * after the admin's click cannot both run the claim.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey } from "../../utils/encryption";
import { admitReplySchema, type AdmitRequest } from "../../schemas/federationAdmission";
import { leaderboardScopeSchema } from "../../schemas/comparison";
import type { FederationAdmissionRequest } from "../../prisma";
import { connectionSwitchesSchema } from "../../schemas/tripSharePeer";
import { claimInvite } from "../comparison/remote";
import { expireStaleAdmissions } from "./admission";
import { ADMISSION_ACCEPTS } from "./envelope";
import { loadIdentity } from "./identity";
import { verifyPeerByPing } from "./peerVerification";
import { PeerRefusal } from "./refusal";
import { exchange, type PeerTransport } from "./security";

const MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 3_600_000;
const LEASE_MS = 5 * MINUTE_MS;
const PASS_LIMIT = 20;

export const ADMISSION_TRANSPORT: PeerTransport = {
  path: "/api/v1/federation-admission",
  maxRequest: 8_192,
  maxReply: 65_536,
  sendPurpose: "admission/1",
  accepts: ADMISSION_ACCEPTS,
  beforeVerification: (body) => (body as { action?: unknown }).action === "admit",
};

/** 1 min, 2 min, 4 min … capped at 6 h. */
export const backoffMs = (attempts: number): number =>
  Math.min(MINUTE_MS * 2 ** Math.min(attempts, 20), MAX_BACKOFF_MS);

export type DeliveryOutcome = "skipped" | "retry" | "approved" | "declined" | "failed" | "expired";

async function settle(
  row: FederationAdmissionRequest,
  status: "approved" | "declined" | "failed",
  failureReason: string | null
): Promise<DeliveryOutcome> {
  await prisma.federationAdmissionRequest.updateMany({
    where: { id: row.id, status: "sent" },
    data: { status, failureReason, decidedAt: new Date(), nextAttemptAt: null },
  });
  logger.info(
    {
      operation: "federation_admission_settled",
      origin: row.origin,
      fingerprint: row.fingerprint,
      status,
      failureReason,
    },
    "Federation admission settled"
  );
  return status;
}

async function retryLater(
  row: FederationAdmissionRequest,
  now: Date,
  hint: string | null
): Promise<DeliveryOutcome> {
  await prisma.federationAdmissionRequest.updateMany({
    where: { id: row.id, status: "sent" },
    data: {
      attempts: { increment: 1 },
      nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      // While the request is still open this is only the last transient cause.
      failureReason: hint,
    },
  });
  return "retry";
}

/** Runs the claim the user agreed to; the other server now knows this one. */
async function completeClaim(
  row: FederationAdmissionRequest,
  token: string,
  now: Date
): Promise<DeliveryOutcome> {
  try {
    // The pin has to be verified before the claim: a leaderboard packet from an unverified peer is refused.
    if (!(await verifyPeerByPing(row.origin))) return await retryLater(row, now, "unverified");
    const scope = leaderboardScopeSchema.parse(row.scope);
    const switches = connectionSwitchesSchema.safeParse(row.switches);
    await claimInvite(
      row.localUserId,
      `${row.origin}#${token}`,
      scope,
      ...(switches.success ? [switches.data] : [])
    );
    return await settle(row, "approved", null);
  } catch (error) {
    // A named refusal (invite spent, friend limit, duplicate …) will not change by waiting.
    if (
      error instanceof AppError &&
      error.statusCode < 500 &&
      error.code !== "COMPARISON_PEER_UNREACHABLE"
    )
      return settle(row, "failed", error.code ?? "claim-refused");
    logger.warn(
      { operation: "federation_admission_claim_retry", origin: row.origin, err: error },
      "The claim after admission will be retried"
    );
    return retryLater(row, now, "claim-unreachable");
  }
}

export async function deliverAdmission(
  id: string,
  now: Date = new Date()
): Promise<DeliveryOutcome> {
  const row = await prisma.federationAdmissionRequest.findUnique({ where: { id } });
  if (!row || row.direction !== "outgoing" || row.status !== "sent") return "skipped";
  if (row.expiresAt <= now) {
    await prisma.federationAdmissionRequest.updateMany({
      where: { id, status: "sent" },
      data: { status: "expired", decidedAt: now, nextAttemptAt: null },
    });
    return "expired";
  }
  const lease = await prisma.federationAdmissionRequest.updateMany({
    where: {
      id,
      status: "sent",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (lease.count !== 1) return "skipped";
  const token = decryptApiKey(row.inviteRef);
  if (!token) return settle(row, "failed", "token-unreadable");
  let reply;
  try {
    const local = await loadIdentity();
    const body: AdmitRequest = { action: "admit", origin: local.origin, token };
    reply = admitReplySchema.parse(await exchange(row.origin, body, ADMISSION_TRANSPORT));
  } catch (error) {
    const kind = error instanceof PeerRefusal ? error.kind : "error";
    // The other server turned the token down (unknown, spent, expired) or this server unpinned it:
    // waiting changes nothing. Everything else — down, unreachable, garbled — is tried again.
    if (kind === "remote-refused" || kind === "unknown-peer")
      return settle(row, "failed", kind === "remote-refused" ? "token-refused" : "peer-unpinned");
    return retryLater(row, now, kind);
  }
  if (reply.status === "declined") return settle(row, "declined", null);
  if (reply.status === "refused") return settle(row, "failed", reply.reason ?? "refused");
  if (reply.status === "pending") return retryLater(row, now, null);
  return completeClaim(row, token, now);
}

/** One pass of the job: expire what is stale, then deliver what is due. */
export async function runAdmissionDeliveries(now: Date = new Date()): Promise<number> {
  await expireStaleAdmissions(now);
  const due = await prisma.federationAdmissionRequest.findMany({
    where: {
      direction: "outgoing",
      status: "sent",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: PASS_LIMIT,
    select: { id: true },
  });
  for (const { id } of due)
    await deliverAdmission(id, now).catch((error: unknown) =>
      logger.warn({ operation: "federation_admission_delivery_error", id, err: error })
    );
  return due.length;
}
