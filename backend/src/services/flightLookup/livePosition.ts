/**
 * A flight's LIVE position while it is in the air (forgejo#408 phase 2).
 *
 * Asks the enabled ADS-B community providers (`adsbV2.ts`) by ICAO24 hex, else
 * registration, else callsign. The answer is either a position or ONE stable
 * reason — "unavailable" is a normal poll result, never an error status.
 * Politeness (≤ 1 request/s per provider, 60 s cache) lives in `lookupAdsbV2`.
 */

import { toIcaoCallsign } from "./adsbChain";
import { lookupAdsbV2, resolveAdsbEndpoints, type AdsbQuery } from "./adsbV2";
import type { ProviderFailure } from "./providerOutcome";
import { scheduledInstants, type FlightWindowColumns } from "../flightDevice/flightWindow";

export const LIVE_UNAVAILABLE_REASONS = [
  "not_live_window",
  "no_schedule",
  "no_provider",
  "no_identifier",
  "no_hit",
  "no_position",
  "provider_error",
] as const;
export type LiveUnavailableReason = (typeof LIVE_UNAVAILABLE_REASONS)[number];

export interface LivePosition {
  lat: number;
  lon: number;
  /** Barometric altitude, feet; null on the ground / unknown. */
  altBaro: number | null;
  onGround: boolean;
  groundSpeed: number | null;
  track: number | null;
  seenSeconds: number | null;
}

export type LivePositionAnswer =
  | {
      status: "ok";
      position: LivePosition;
      source: string;
      fetchedAt: string;
      icao24: string | null;
      registration: string | null;
    }
  | {
      status: "unavailable";
      reason: LiveUnavailableReason;
      /** Per provider, why it could not answer (only with `provider_error`). */
      failures?: ProviderFailure[];
    };

const BEFORE_DEPARTURE_MS = 60 * 60_000;
const AFTER_ARRIVAL_MS = 3 * 60 * 60_000;
const HEX = /^[0-9a-f]{6}$/i;

export interface LiveFlight extends FlightWindowColumns {
  status: string;
  flightNumber: string | null;
  aircraftModeS: string | null;
  aircraftRegistration: string | null;
}

function queriesFor(flight: LiveFlight): AdsbQuery[] {
  const queries: AdsbQuery[] = [];
  const hex = flight.aircraftModeS?.trim();
  if (hex && HEX.test(hex)) queries.push({ kind: "hex", value: hex.toLowerCase() });
  const reg = flight.aircraftRegistration?.trim();
  if (reg) queries.push({ kind: "reg", value: reg });
  const callsign = flight.flightNumber ? toIcaoCallsign(flight.flightNumber) : null;
  if (callsign) queries.push({ kind: "callsign", value: callsign });
  return queries;
}

export async function liveFlightPosition(
  flight: LiveFlight,
  userId: string,
  now: Date = new Date()
): Promise<LivePositionAnswer> {
  if (flight.status === "cancelled") return { status: "unavailable", reason: "not_live_window" };
  const { departure, arrival } = await scheduledInstants(flight);
  const from = departure ?? arrival;
  const to = arrival ?? departure;
  if (!from || !to) return { status: "unavailable", reason: "no_schedule" };
  const t = now.getTime();
  if (t < from.getTime() - BEFORE_DEPARTURE_MS || t > to.getTime() + AFTER_ARRIVAL_MS) {
    return { status: "unavailable", reason: "not_live_window" };
  }
  const endpoints = await resolveAdsbEndpoints(userId);
  if (endpoints.length === 0) return { status: "unavailable", reason: "no_provider" };
  const queries = queriesFor(flight);
  if (queries.length === 0) return { status: "unavailable", reason: "no_identifier" };

  const failures = new Map<string, ProviderFailure>();
  let sawHitWithoutPosition = false;
  for (const endpoint of endpoints) {
    for (const query of queries) {
      const answer = await lookupAdsbV2(endpoint, query);
      if (answer.status === "failed") {
        failures.set(answer.provider, { provider: answer.provider, outcome: answer.reason });
        break; // the provider is down for this poll; its other identifiers will not differ
      }
      if (answer.status !== "ok") continue;
      const { position: p, icao24, registration } = answer.aircraft;
      if (p.lat === null || p.lon === null) {
        sawHitWithoutPosition = true;
        continue;
      }
      return {
        status: "ok",
        position: {
          lat: p.lat,
          lon: p.lon,
          altBaro: p.altitudeFt,
          onGround: p.onGround,
          groundSpeed: p.groundSpeedKt,
          track: p.trackDeg,
          seenSeconds: p.seenSeconds,
        },
        source: answer.provider,
        fetchedAt: answer.fetchedAt,
        icao24,
        registration,
      };
    }
  }
  if (failures.size > 0) {
    return { status: "unavailable", reason: "provider_error", failures: [...failures.values()] };
  }
  return { status: "unavailable", reason: sawHitWithoutPosition ? "no_position" : "no_hit" };
}
