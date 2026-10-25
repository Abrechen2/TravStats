/**
 * Whether TravStats may derive from, or act on, an account's TravTrack history
 * now (TravTrack plan E6, owner rule of 2026-10-25): the instance's TravTrack
 * is on AND the account's location provider is `travtrack` and working — the
 * same rule that runs Dawarich's automatic jobs only for provider `dawarich`.
 * An account that switched away keeps its derived rows untouched; they are
 * neither recomputed nor deleted.
 *
 * Asked at entry and again between days, between pages and inside a
 * publication's transaction, so a switch takes effect within the work.
 */
import { AppError } from "../../middleware/errorHandler";
import { getLocationProvider } from "../locationProvider/provider";
import { travTrackInstanceOn } from "../travtrack/availability";

export type DerivationAllowance = "ok" | "disabled" | "providerOff";

export async function travTrackDerivationAllowed(userId: string): Promise<DerivationAllowance> {
  if (!(await travTrackInstanceOn())) return "disabled";
  const provider = await getLocationProvider(userId);
  return provider.kind === "travtrack" && provider.status === "ok" ? "ok" : "providerOff";
}

/** Throws the allowance as the error a client reads: 403 switched off, 409 not the provider. */
export async function assertTravTrackDerivationAllowed(userId: string): Promise<void> {
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance === "disabled") {
    throw new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
  }
  if (allowance === "providerOff") {
    throw new AppError(
      "TravTrack is not this account's location source",
      409,
      "TRAVTRACK_UNAVAILABLE"
    );
  }
}
