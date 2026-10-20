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
