/**
 * What the Companion should record for one account (TravTrack plan, task S4),
 * answered by `GET /location/capabilities`.
 *
 * Since T5 (Codex's sequencing rule): "Dawarich → the Companion records
 * nothing" — flights and trips are recorded only under `none` (into the entry
 * routes, `sink: "entries"`) and under a working `travtrack` (into TravTrack,
 * `sink: "travtrack"`). It took effect in the same change that shows Dawarich
 * tracks on the flight and trip pages (`entryTrack.ts`), so a Dawarich user
 * stops recording exactly when the replacement appears. A phase-1 Companion
 * ignores `sink` and keeps recording through the entry routes under
 * `travtrack` — accepted (review focus 12): the server is still the record.
 *
 * The recording routes (`POST /flights/:id/track`, `POST /trips/:id/recording`)
 * deliberately do NOT read this: a recording queued on the phone before a
 * switch keeps its target and is accepted. This answer steers what the phone
 * STARTS; it never refuses what the phone already holds.
 *
 * `travTrack` (phase 2, T1) splits starting from sending: `capture` says
 * "record into TravTrack" (the provider is TravTrack and it works), `upload`
 * says "this server takes `/travtrack/points`" (the instance is on), whatever
 * the provider. Points queued for TravTrack therefore still leave the phone
 * after a switch to `none` or `dawarich` (review focus 7). `enabled` is kept
 * for the phase-1 Companion and equals `capture`.
 */
import { flightLiveTrackingEnabled } from "../settings/accountPrefs";
import { tripRecordingEnabled } from "../settings/suggestionSwitches";
import { travTrackInstanceOn } from "../travtrack/availability";
import { getLocationProvider, travTrackAvailable } from "./provider";
import type { LocationProviderKind, ProviderStatus } from "./kinds";

export type CaptureMode = "off" | "trips" | "everyday";
export type CaptureSink = "entries" | "travtrack";

export interface LocationCapabilities {
  version: 1;
  provider: { kind: LocationProviderKind; rev: number; status: ProviderStatus };
  capture: {
    flight: boolean;
    trip: boolean;
    everyday: boolean;
    modes: CaptureMode[];
    /** Where the phone sends what it records: the entry routes, TravTrack, or nowhere. */
    sink: CaptureSink | null;
  };
  travTrack: { offered: boolean; enabled: boolean; capture: boolean; upload: boolean };
}

export async function locationCapabilities(userId: string): Promise<LocationCapabilities> {
  const [provider, flightSwitch, tripSwitch, offered, upload] = await Promise.all([
    getLocationProvider(userId),
    flightLiveTrackingEnabled(userId),
    tripRecordingEnabled(userId),
    travTrackAvailable(userId),
    travTrackInstanceOn(),
  ]);
  const travTrackOn = provider.kind === "travtrack" && provider.status === "ok";
  const sink: CaptureSink | null =
    provider.kind === "none" ? "entries" : travTrackOn ? "travtrack" : null;
  const flight = sink !== null && flightSwitch;
  const trip = sink !== null && tripSwitch;
  return {
    version: 1,
    provider,
    capture: {
      flight,
      trip,
      everyday: travTrackOn,
      modes: travTrackOn ? ["off", "trips", "everyday"] : [],
      sink: flight || trip || travTrackOn ? sink : null,
    },
    travTrack: { offered, enabled: travTrackOn, capture: travTrackOn, upload },
  };
}
