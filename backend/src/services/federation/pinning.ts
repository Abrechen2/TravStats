/**
 * Pinning a peer: the one code path for the admin's manual pin and for approving an admission
 * request (spec 2026-11-07 §6.2 step 3), so both validate, replace a key and hold the dependent
 * connections identically. Moved unchanged out of `routes/admin/federation.ts`.
 */
import { prisma } from "../../db";
import { comparisonError } from "../comparison/errors";
import { admissionError } from "./admissionErrors";
import { holdConnectionsOfOrigin } from "../sharing/federation/connections/hooks";
import { holdPeerMemberships } from "../sharing/federation/lifecycle";
import { loadIdentity } from "./identity";
import { parsePeerPublicKey } from "./peerKey";
import { hash, PeerRefusal } from "./refusal";

export interface PinInput {
  origin: string;
  publicKey: string;
  fingerprint: string;
  enabled: boolean;
}

/** This server's own origin, or null while federation is off. */
async function ownOrigin(): Promise<string | null> {
  try {
    return (await loadIdentity()).origin;
  } catch (error) {
    if (error instanceof PeerRefusal) return null;
    throw error;
  }
}

/** The checks every pin passes; returns the SPKI PEM to store. */
async function validatedKey(body: PinInput): Promise<string> {
  if (body.origin === (await ownOrigin()))
    throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "A server cannot pin itself");
  const pem = parsePeerPublicKey(body.publicKey);
  if (!pem)
    throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "Not an Ed25519 public key", {
      origin: body.origin,
    });
  if (hash(pem) !== body.fingerprint)
    throw comparisonError(
      "COMPARISON_PEER_KEY_INVALID",
      400,
      "Fingerprint does not match the key",
      {
        origin: body.origin,
      }
    );
  return pem;
}

/**
 * Pins a server that is not pinned yet, and ONLY then: the insert is `skipDuplicates`, so an admin
 * who pinned, replaced or suspended the same origin in the meantime is never overwritten. If the
 * row is there, it must be the same key and enabled, or the caller gets the named refusal.
 */
export async function pinNewPeer(body: PinInput): Promise<void> {
  const pem = await validatedKey(body);
  const created = await prisma.comparisonPeer.createMany({
    data: [{ origin: body.origin, publicKey: pem, enabled: body.enabled }],
    skipDuplicates: true,
  });
  if (created.count === 1) return;
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: body.origin } });
  if (peer?.publicKey !== pem)
    throw admissionError(
      "FEDERATION_ADMISSION_KEY_MISMATCH",
      409,
      "That server is pinned with a different key",
      { origin: body.origin }
    );
  if (!peer.enabled)
    throw admissionError("FEDERATION_ADMISSION_SUSPENDED", 409, "That server is suspended", {
      origin: body.origin,
    });
}

/** Validates and stores the pin; returns the SPKI PEM that was stored. */
export async function pinPeer(body: PinInput): Promise<string> {
  const pem = await validatedKey(body);
  const previous = await prisma.comparisonPeer.findUnique({ where: { origin: body.origin } });
  if (previous && previous.publicKey !== pem) {
    // A replaced key ends every E2E friendship through it, exactly as before the move.
    // Leaderboard friendships (LeaderboardRemote) deliberately survive (controller ruling):
    // they are addressed by origin + channel, not by the key, and nothing flows over them
    // until the admin re-verifies the new pin (verifiedAt is reset below).
    await prisma.comparisonLink.updateMany({
      where: { origin: body.origin },
      data: { revoked: true },
    });
  }
  await prisma.comparisonPeer.upsert({
    where: { origin: body.origin },
    create: { origin: body.origin, publicKey: pem, enabled: body.enabled },
    update: { publicKey: pem, enabled: body.enabled, verifiedAt: null, leaderboardVersions: [] },
  });
  // Trips shared across servers through it pause until each person confirms them again
  // (spec 2026-10-20 O9): a new key is a new party until someone says otherwise.
  if (previous && previous.publicKey !== pem) {
    await holdPeerMemberships(body.origin, "repinned");
    await holdConnectionsOfOrigin(body.origin);
  } else if (previous && !body.enabled) await holdPeerMemberships(body.origin, "peer-blocked");
  return pem;
}
