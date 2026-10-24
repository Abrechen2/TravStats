/**
 * What the Companion should record for one account (TravTrack plan, task S4),
 * answered by `GET /location/capabilities`.
 *
 * Phase 1, by the sequencing rule: "Dawarich → the Companion records nothing"
 * takes effect only together with the reads that replace it (T5). Until then
 * a `dawarich` account keeps today's flight and trip recording, and only
 * `travtrack` — whose own segments will carry flights and trips — turns them
 * off. T5 changes the two lines below to `kind === "none" || kind === "travtrack"`.
 *
 * The recording routes (`POST /flights/:id/track`, `POST /trips/:id/recording`)
 * deliberately do NOT read this: a recording queued on the phone before a
 * switch keeps its target and is accepted. This answer steers what the phone
 * STARTS; it never refuses what the phone already holds.
 */
import { flightLiveTrackingEnabled } from "../settings/accountPrefs";
import { tripRecordingEnabled } from "../settings/suggestionSwitches";
import { getLocationProvider, travTrackAvailable } from "./provider";
import type { LocationProviderKind, ProviderStatus } from "./kinds";

export type CaptureMode = "off" | "trips" | "everyday";

export interface LocationCapabilities {
  version: 1;
  provider: { kind: LocationProviderKind; rev: number; status: ProviderStatus };
  capture: { flight: boolean; trip: boolean; everyday: boolean; modes: CaptureMode[] };
  travTrack: { offered: boolean; enabled: boolean };
}

export async function locationCapabilities(userId: string): Promise<LocationCapabilities> {
  const [provider, flightSwitch, tripSwitch, offered] = await Promise.all([
    getLocationProvider(userId),
    flightLiveTrackingEnabled(userId),
    tripRecordingEnabled(userId),
    travTrackAvailable(userId),
  ]);
  const travTrackOn = provider.kind === "travtrack" && provider.status === "ok";
  const ownCapture = provider.kind !== "travtrack";
  return {
    version: 1,
    provider,
    capture: {
      flight: ownCapture && flightSwitch,
      trip: ownCapture && tripSwitch,
      everyday: travTrackOn,
      modes: travTrackOn ? ["off", "trips", "everyday"] : [],
    },
    travTrack: { offered, enabled: travTrackOn },
  };
}
