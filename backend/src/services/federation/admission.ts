/**
 * The admission queue (spec 2026-11-07 §6.2): what the admin sees and decides. A request is never
 * a pin; only `approveAdmission` pins, through the same `pinPeer` as the manual pin, and it never
 * replaces a different key or re-enables a suspended peer.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { FederationAdmissionRequest } from "../../prisma";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { admissionError } from "./admissionErrors";
import { fetchPeerIdentity } from "./admissionIdentity";
import { verifyPeerByPing } from "./peerVerification";
import { pinPeer } from "./pinning";

/** An open request is alive this long (spec §6.2 step 6). */
export const ADMISSION_WINDOW_MS = 14 * 24 * 3_600_000;
const LIST_LIMIT = 200;

export type AdmissionStatus = "pending" | "sent" | "approved" | "declined" | "failed" | "expired";
export type AdmissionDirection = "outgoing" | "incoming";

export interface AdmissionView {
  id: string;
  direction: AdmissionDirection;
  origin: string;
  fingerprint: string;
  status: AdmissionStatus;
  failureReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  /** The local person the request is about: who redeemed (outgoing) or whose invitation it was. */
  person: { username: string; displayName: string } | null;
}

/** Open requests whose window has passed become `expired`; they no longer count against caps. */
export async function expireStaleAdmissions(now = new Date()): Promise<void> {
  await prisma.federationAdmissionRequest.updateMany({
    where: { status: { in: ["pending", "sent"] }, expiresAt: { lte: now } },
    data: { status: "expired", decidedAt: now },
  });
}

type PersonRow = Parameters<typeof toPerson>[0];

export function toAdmissionView(
  row: FederationAdmissionRequest,
  user: PersonRow | null
): AdmissionView {
  const person = user ? toPerson(user) : null;
  return {
    id: row.id,
    direction: row.direction as AdmissionDirection,
    origin: row.origin,
    fingerprint: row.fingerprint,
    status: row.status as AdmissionStatus,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    person: person ? { username: person.username, displayName: person.displayName } : null,
  };
}

export async function listAdmissions(): Promise<AdmissionView[]> {
  await expireStaleAdmissions();
  const rows = await prisma.federationAdmissionRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    include: { user: { select: PERSON_SELECT } },
  });
  return rows.map(({ user, ...row }) => toAdmissionView(row, user));
}

async function loadOpen(id: string): Promise<FederationAdmissionRequest> {
  await expireStaleAdmissions();
  const row = await prisma.federationAdmissionRequest.findUnique({ where: { id } });
  if (!row)
    throw admissionError("FEDERATION_ADMISSION_NOT_FOUND", 404, "No such admission request", {
      id,
    });
  if (row.status !== "pending")
    throw admissionError("FEDERATION_ADMISSION_NOT_PENDING", 409, "Already decided", {
      id,
      status: row.status,
    });
  return row;
}

/**
 * Whether the stored pin allows this request to proceed. A different key is a refusal, never a
 * silent re-pin (Codex 13); a suspended peer stays suspended (an admin suspended it on purpose).
 * Returns true when the peer is already pinned with the same key and active.
 */
async function checkExistingPin(row: FederationAdmissionRequest): Promise<boolean> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: row.origin } });
  if (!peer) return false;
  if (peer.publicKey !== row.publicKey)
    throw admissionError(
      "FEDERATION_ADMISSION_KEY_MISMATCH",
      409,
      "That server is pinned with a different key",
      { id: row.id, origin: row.origin }
    );
  if (!peer.enabled)
    throw admissionError("FEDERATION_ADMISSION_SUSPENDED", 409, "That server is suspended", {
      id: row.id,
      origin: row.origin,
    });
  return true;
}

export async function approveAdmission(id: string, adminId: string): Promise<AdmissionView> {
  const row = await loadOpen(id);
  const alreadyPinned = await checkExistingPin(row);
  // The admin's click is the moment a key becomes trusted, so the server is asked once more what
  // key it publishes now: the link may be days old, and a private origin was never fetched at
  // redeem (Codex 11). An incoming request was verified when it arrived.
  if (row.direction === "outgoing" && !alreadyPinned) {
    const found = await fetchPeerIdentity(row.origin);
    if (found.publicKey !== row.publicKey)
      throw admissionError(
        "FEDERATION_ADMISSION_KEY_MISMATCH",
        409,
        "That server now publishes a different key",
        { id, origin: row.origin }
      );
  }
  const target: AdmissionStatus = row.direction === "outgoing" ? "sent" : "approved";
  // Conditional on still being pending: two admins (or one double click) decide once.
  const flipped = await prisma.federationAdmissionRequest.updateMany({
    where: { id, status: "pending" },
    data: {
      status: target,
      decidedAt: new Date(),
      decidedBy: adminId,
      // An outgoing request is now due for delivery (`admissionDelivery.ts`).
      ...(row.direction === "outgoing" ? { nextAttemptAt: null, attempts: 0 } : {}),
    },
  });
  if (flipped.count !== 1)
    throw admissionError("FEDERATION_ADMISSION_NOT_PENDING", 409, "Already decided", { id });
  try {
    if (!alreadyPinned)
      await pinPeer({
        origin: row.origin,
        publicKey: row.publicKey,
        fingerprint: row.fingerprint,
        enabled: true,
      });
  } catch (error) {
    await prisma.federationAdmissionRequest.updateMany({
      where: { id, status: target },
      data: { status: "pending", decidedAt: null, decidedBy: null },
    });
    throw error;
  }
  logger.info(
    {
      operation: "federation_admission_approved",
      adminId,
      origin: row.origin,
      fingerprint: row.fingerprint,
      direction: row.direction,
    },
    "Federation admission approved"
  );
  // The other server pinned this one before it asked (outgoing there), so it can answer a ping
  // now. Verifying here lets the claim that follows pass; if it fails the admin can verify by
  // hand, and the sender's next ask retries it (`admissionBootstrap`).
  if (row.direction === "incoming" && !alreadyPinned)
    await verifyPeerByPing(row.origin).catch((error: unknown) =>
      logger.warn(
        { operation: "federation_admission_verify_failed", id, origin: row.origin, err: error },
        "Admitted server could not be verified yet"
      )
    );
  return viewOf(id);
}

export async function declineAdmission(id: string, adminId: string): Promise<AdmissionView> {
  const row = await loadOpen(id);
  const flipped = await prisma.federationAdmissionRequest.updateMany({
    where: { id, status: "pending" },
    data: { status: "declined", decidedAt: new Date(), decidedBy: adminId },
  });
  if (flipped.count !== 1)
    throw admissionError("FEDERATION_ADMISSION_NOT_PENDING", 409, "Already decided", { id });
  logger.info(
    {
      operation: "federation_admission_declined",
      adminId,
      origin: row.origin,
      fingerprint: row.fingerprint,
      direction: row.direction,
    },
    "Federation admission declined"
  );
  return viewOf(id);
}

async function viewOf(id: string): Promise<AdmissionView> {
  const { user, ...row } = await prisma.federationAdmissionRequest.findUniqueOrThrow({
    where: { id },
    include: { user: { select: PERSON_SELECT } },
  });
  return toAdmissionView(row, user);
}
