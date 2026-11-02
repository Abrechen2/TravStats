/**
 * What the guest feature asks of the admin's pin (spec 2026-10-20 "server-level key pinning is the
 * trust"): a server counts only while it is pinned, enabled AND verified by a ping. The pin's
 * fingerprint is what a credential remembers, so a replaced key is a different server.
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { hash } from "../../federation/refusal";
import { loadIdentity } from "../../federation/identity";

export async function verifiedPeer(origin: string) {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  return peer?.enabled && peer.verifiedAt ? peer : null;
}

/** The fingerprint of a currently admitted server's key, or null when it is not admitted. */
export async function pinFingerprint(origin: string): Promise<string | null> {
  const peer = await verifiedPeer(origin);
  return peer ? hash(peer.publicKey) : null;
}

export async function requireVerifiedPeer(
  origin: string,
  code:
    "PLAN_GUEST_PEER_NOT_ADMITTED" | "PLAN_GUEST_HOST_NOT_ADMITTED" = "PLAN_GUEST_PEER_NOT_ADMITTED"
) {
  const peer = await verifiedPeer(origin);
  if (!peer)
    throw new AppError("The admin has not admitted that server", 403, code, undefined, { origin });
  return peer;
}

/** This server's identity for guests; an off federation is its own refusal. */
export async function guestIdentity() {
  try {
    return await loadIdentity();
  } catch {
    throw new AppError(
      "Federation is switched off on this server",
      409,
      "PLAN_GUEST_FEDERATION_OFF"
    );
  }
}
