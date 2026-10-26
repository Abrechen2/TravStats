/**
 * Whether this server takes part in trip sharing across servers (spec 2026-10-20 F8, §10).
 * Three conditions, all of them: the instance's beta switch (the feature is behind the beta key
 * `federatedTripSharing`), the admin's own switch (default off), and a server identity that
 * loads. Off is absent (G5): the peer route answers 404 and the user endpoints refuse with
 * `SHARE_REMOTE_DISABLED`, so nothing half-works.
 */
import { prisma } from "../../../db";
import { loadIdentity, type Identity } from "../../federation/identity";
import { PeerRefusal } from "../../federation/refusal";

export type TripFederationOffReason = "beta-off" | "switch-off" | "no-identity";
export type TripFederationAvailability =
  { available: true; identity: Identity } | { available: false; reason: TripFederationOffReason };

export async function tripFederationAvailability(): Promise<TripFederationAvailability> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { betaFeaturesEnabled: true, tripFederationEnabled: true },
  });
  if (!row?.betaFeaturesEnabled) return { available: false, reason: "beta-off" };
  if (!row.tripFederationEnabled) return { available: false, reason: "switch-off" };
  try {
    return { available: true, identity: await loadIdentity() };
  } catch (error) {
    if (error instanceof PeerRefusal) return { available: false, reason: "no-identity" };
    throw error;
  }
}

/**
 * Whether any server is admitted: pinned, not suspended, and reached by a ping (spec §10). Not a
 * gate — a code can be issued without one — but the setup checklist's third step, and the reason
 * "Teilen" names when nobody on another server could redeem a code.
 */
export async function hasAdmittedPeer(): Promise<boolean> {
  const admitted = await prisma.comparisonPeer.count({
    where: { enabled: true, verifiedAt: { not: null } },
  });
  return admitted > 0;
}
