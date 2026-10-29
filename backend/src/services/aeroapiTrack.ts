/**
 * Real flight tracks from FlightAware AeroAPI (forgejo#409).
 *
 * `GET /flights/{fa_flight_id}/track` returns the positions FlightAware
 * received for a flight (ADS-B, including the owner's own receiver). They go
 * into the SAME row a phone recording or an uploaded file goes into
 * (`flight_tracks`, `source = "aeroapi"`), through the same pipeline
 * (`flightTrackColumns`: jitter, holes, distance, simplification).
 *
 * Three rules this file exists to keep:
 *   - A track already on the flight is never replaced. A phone recording or an
 *     uploaded file is the passenger's own and wins; this source only fills a
 *     gap. The create is the only write, and a concurrent winner (unique
 *     violation) is read as "has a track", not retried.
 *   - Once. Every flight looked at gets an `aeroapi_track_attempts` row; a
 *     terminal answer is never asked again, a transient one is retried up to
 *     `AEROAPI_TRACK_MAX_ATTEMPTS` times.
 *   - Every failure keeps its reason (auth, quota, budget, rate limit, …) in the
 *     attempt row and in the sweep summary the admin card shows.
 *
 * Response field names follow FlightAware's published v4 schema (altitude in
 * hundreds of feet, groundspeed in knots); the fixture is docs-derived until a
 * response is recorded with a real key.
 */

import axios from "axios";

import { Prisma, type Flight } from "../prisma";
import { prisma } from "../db";
import logger from "../utils/logger";
import { toProviderFlightNumber } from "../schemas/flight";
import type { FlightTrackPoint } from "../schemas/flightDevice";
import { getApiKey } from "./apiKeyResolver";
import { requestAeroapiCall, type AeroapiGate } from "./aeroapiBudget";
import { pickInstance, type AeroapiFlight } from "./aeroapiLookup";
import { flightTrackColumns } from "./flightDevice/flightTrackIngest";
import { classifyProviderError, type ProviderFailureKind } from "./flightLookup/providerOutcome";

const BASE_URL = "https://aeroapi.flightaware.com/aeroapi";
const REQUEST_TIMEOUT_MS = 15_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** AeroAPI serves 10 days back; kept off the edge so clock skew cannot earn a 400. */
const WINDOW_MS = 10 * DAY_MS - HOUR_MS;
/** A flight is fetched this long after its scheduled arrival: late arrivals are in by then. */
const ARRIVAL_SETTLE_MS = HOUR_MS;
/** A sweep waits at most this long for a rate slot (the limit is per minute). */
const SWEEP_RATE_WAIT_MS = 65_000;
const SWEEP_BATCH = 20;
export const AEROAPI_TRACK_MAX_ATTEMPTS = 3;

const FEET_TO_METRES = 0.3048;
const KNOTS_TO_MS = 0.514444;

export const TERMINAL_OUTCOMES = ["stored", "no_match", "no_track", "has_track"] as const;
export const TRANSIENT_OUTCOMES = ["budget", "rate_limit", "error", "not_arrived"] as const;
export type TrackAttemptOutcome =
  (typeof TERMINAL_OUTCOMES)[number] | (typeof TRANSIENT_OUTCOMES)[number];

export interface AeroapiTrackPosition {
  timestamp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Hundreds of feet. */
  altitude?: number | null;
  /** Knots. */
  groundspeed?: number | null;
}

/** The positions as the track pipeline reads them; unusable ones are dropped, time-ordered. */
export function positionsToPoints(positions: readonly AeroapiTrackPosition[]): FlightTrackPoint[] {
  const points: FlightTrackPoint[] = [];
  for (const p of positions) {
    const t = p.timestamp ? Date.parse(p.timestamp) : NaN;
    const { latitude: lat, longitude: lon } = p;
    if (Number.isNaN(t) || typeof lat !== "number" || typeof lon !== "number") continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const point: FlightTrackPoint = { t, lat, lon };
    if (typeof p.altitude === "number") {
      const metres = p.altitude * 100 * FEET_TO_METRES;
      if (metres >= -1000 && metres <= 30_000) point.alt = metres;
    }
    if (typeof p.groundspeed === "number" && p.groundspeed >= 0) {
      point.speed = Math.min(p.groundspeed * KNOTS_TO_MS, 1000);
    }
    points.push(point);
  }
  return points.sort((a, b) => a.t - b.t);
}

type SweepFlight = Pick<
  Flight,
  | "id"
  | "flightNumber"
  | "depIata"
  | "depIcao"
  | "arrIata"
  | "arrIcao"
  | "departureTime"
  | "arrivalTime"
  | "depTimeSemantics"
  | "arrTimeSemantics"
  | "status"
>;

const PLACEHOLDER_SEMANTICS = new Set(["DATE_ONLY", "UNKNOWN"]);

/**
 * Is this flight inside what AeroAPI can serve and past its arrival? Both
 * clocks must be real times: noon on a known day is a placeholder, and a
 * query window built on it would miss the flight and still cost a result set.
 */
export function isTrackCandidate(flight: SweepFlight, now: Date): boolean {
  if (!flight.flightNumber || !flight.departureTime || !flight.arrivalTime) return false;
  if (flight.status === "cancelled") return false;
  if (
    PLACEHOLDER_SEMANTICS.has(flight.depTimeSemantics ?? "") ||
    PLACEHOLDER_SEMANTICS.has(flight.arrTimeSemantics ?? "")
  ) {
    return false;
  }
  const nowMs = now.getTime();
  if (flight.arrivalTime.getTime() > nowMs - ARRIVAL_SETTLE_MS) return false;
  return flight.departureTime.getTime() >= nowMs - WINDOW_MS;
}

class StepFailure extends Error {
  constructor(
    readonly outcome: TrackAttemptOutcome,
    readonly kind?: ProviderFailureKind | "budget" | "rate_limit"
  ) {
    super(outcome);
  }
}

/** Runs one gated AeroAPI GET. An HTTP error answer was not billed and gives the cost back. */
async function gatedGet<T>(
  apiKey: string,
  kind: "flights" | "track",
  url: string,
  params?: Record<string, string>
): Promise<T> {
  const gate: AeroapiGate = await requestAeroapiCall(kind, { maxWaitMs: SWEEP_RATE_WAIT_MS });
  if (!gate.ok) {
    throw new StepFailure(gate.reason === "budget" ? "budget" : "rate_limit", gate.reason);
  }
  try {
    const response = await axios.get<T>(`${BASE_URL}${url}`, {
      headers: { "x-apikey": apiKey, Accept: "application/json" },
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status !== undefined) await gate.release().catch(() => undefined);
    // The message only: an axios error carries the request config and the key.
    logger.warn(
      {
        api: "aeroapi",
        status,
        error: error instanceof Error ? error.message : "unknown",
        operation: "aeroapi_track_call_failed",
      },
      "AeroAPI track call failed"
    );
    throw new StepFailure("error", classifyProviderError(error));
  }
}

/** Unknown on either side is no evidence against; a known pair that differs is. */
function sameAirport(
  ref: AeroapiFlight["origin"],
  iata: string | null,
  icao: string | null
): boolean {
  const theirs = [ref?.code_iata, ref?.code_icao, ref?.code]
    .filter((c): c is string => !!c)
    .map((c) => c.toUpperCase());
  const ours = [iata, icao].filter((c): c is string => !!c).map((c) => c.toUpperCase());
  if (theirs.length === 0 || ours.length === 0) return true;
  return ours.some((c) => theirs.includes(c));
}

async function findInstance(apiKey: string, flight: SweepFlight): Promise<AeroapiFlight | null> {
  const departure = flight.departureTime!.getTime();
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const ident = toProviderFlightNumber(flight.flightNumber) ?? flight.flightNumber!;
  const data = await gatedGet<{ flights?: AeroapiFlight[] }>(
    apiKey,
    "flights",
    `/flights/${encodeURIComponent(ident)}`,
    {
      ident_type: "designator",
      start: iso(departure - 12 * HOUR_MS),
      end: iso(departure + 12 * HOUR_MS),
    }
  );
  if (!Array.isArray(data?.flights)) throw new StepFailure("error", "provider_error");
  // Stricter than the lookup, which prefers our airport but may fall back: a
  // stored track must be THIS flight's line, not a neighbouring rotation of
  // the same number, so a known airport that does not match rules the instance out.
  const near = data.flights.filter((f) => {
    const out = Date.parse(f.scheduled_out ?? "");
    return (
      (Number.isNaN(out) || Math.abs(out - departure) <= 6 * HOUR_MS) &&
      sameAirport(f.origin, flight.depIata, flight.depIcao) &&
      sameAirport(f.destination, flight.arrIata, flight.arrIcao)
    );
  });
  return pickInstance(near, departure) ?? null;
}

/** Fetch and convert one flight's AeroAPI track; throws `StepFailure` with the reason. */
async function fetchTrackFor(apiKey: string, flight: SweepFlight) {
  const instance = await findInstance(apiKey, flight);
  if (!instance?.fa_flight_id) throw new StepFailure("no_match");
  if (instance.cancelled || instance.diverted) throw new StepFailure("no_track");
  if (!instance.actual_in && !instance.actual_on) throw new StepFailure("not_arrived");

  const data = await gatedGet<{ positions?: AeroapiTrackPosition[] }>(
    apiKey,
    "track",
    `/flights/${encodeURIComponent(instance.fa_flight_id)}/track`
  );
  if (!Array.isArray(data?.positions)) throw new StepFailure("error", "provider_error");
  const columns = flightTrackColumns(positionsToPoints(data.positions));
  if (!columns) throw new StepFailure("no_track");
  return { faFlightId: instance.fa_flight_id, columns };
}

const COUNTED_OUTCOMES: ReadonlySet<TrackAttemptOutcome> = new Set(["error", "not_arrived"]);

async function recordAttempt(flightId: string, outcome: TrackAttemptOutcome): Promise<void> {
  await prisma.aeroapiTrackAttempt.upsert({
    where: { flightId },
    create: { flightId, outcome },
    update: {
      outcome,
      // A refusal before any request (budget, rate limit) is not an attempt:
      // counting it would shut a flight out for good after three empty hours.
      attempts: COUNTED_OUTCOMES.has(outcome) ? { increment: 1 } : undefined,
      attemptedAt: new Date(),
    },
  });
}

/**
 * The only write: creates the track when the flight has none. Returns false
 * when one is there (also when it arrived between the check and the create).
 */
export async function storeAeroapiTrack(
  flightId: string,
  faFlightId: string,
  columns: NonNullable<ReturnType<typeof flightTrackColumns>>
): Promise<boolean> {
  if (await prisma.flightTrack.findUnique({ where: { flightId }, select: { id: true } })) {
    return false;
  }
  try {
    await prisma.flightTrack.create({
      data: { ...columns, flightId, source: "aeroapi", uploadId: `aeroapi:${faFlightId}` },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

export type SweepStatus =
  | "disabled"
  | "no_key"
  | "nothing_to_do"
  | "done"
  | "stopped_budget"
  | "stopped_rate_limit"
  | "stopped_auth"
  | "already_running";

export interface SweepSummary {
  at: string;
  status: SweepStatus;
  counts: Partial<Record<TrackAttemptOutcome, number>>;
}

let lastSweep: SweepSummary | null = null;
let running = false;

export function getLastTrackSweep(): SweepSummary | null {
  return lastSweep;
}

function finish(
  status: SweepStatus,
  counts: SweepSummary["counts"] = {},
  now: Date = new Date()
): SweepSummary {
  lastSweep = { at: now.toISOString(), status, counts };
  return lastSweep;
}

/**
 * One pass: for each flight past its arrival and inside AeroAPI's window that
 * has no track and has not had a final answer, fetch and store the track.
 * Off unless the admin switched `aeroapiTracksEnabled` on.
 */
export async function sweepAeroapiTracks(now: Date = new Date()): Promise<SweepSummary> {
  if (running) return { at: now.toISOString(), status: "already_running", counts: {} };
  running = true;
  try {
    const settings = await prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: { aeroapiTracksEnabled: true },
    });
    if (!settings?.aeroapiTracksEnabled) return finish("disabled", {}, now);

    const apiKey = await getApiKey("aeroapi");
    if (!apiKey) {
      logger.warn(
        { operation: "aeroapi_tracks_no_key" },
        "AeroAPI tracks are on but no instance key is set"
      );
      return finish("no_key", {}, now);
    }

    const candidates = (
      await prisma.flight.findMany({
        where: {
          track: { is: null },
          status: { not: "cancelled" },
          flightNumber: { not: null },
          // In SQL, not only in `isTrackCandidate`: the batch is bounded, and
          // flights that can never qualify must not fill it.
          depTimeSemantics: { notIn: [...PLACEHOLDER_SEMANTICS] },
          arrTimeSemantics: { notIn: [...PLACEHOLDER_SEMANTICS] },
          arrivalTime: { lte: new Date(now.getTime() - ARRIVAL_SETTLE_MS) },
          departureTime: { gte: new Date(now.getTime() - WINDOW_MS) },
          OR: [
            { aeroapiTrackAttempt: { is: null } },
            {
              aeroapiTrackAttempt: {
                is: {
                  outcome: { in: [...TRANSIENT_OUTCOMES] },
                  attempts: { lt: AEROAPI_TRACK_MAX_ATTEMPTS },
                },
              },
            },
          ],
        },
        orderBy: { arrivalTime: "asc" },
        take: SWEEP_BATCH * 3,
      })
    )
      .filter((f) => isTrackCandidate(f, now))
      .slice(0, SWEEP_BATCH);
    if (candidates.length === 0) return finish("nothing_to_do", {}, now);

    const counts: SweepSummary["counts"] = {};
    let stop: SweepStatus | null = null;
    for (const flight of candidates) {
      let outcome: TrackAttemptOutcome;
      try {
        const { faFlightId, columns } = await fetchTrackFor(apiKey, flight);
        outcome = (await storeAeroapiTrack(flight.id, faFlightId, columns))
          ? "stored"
          : "has_track";
      } catch (error) {
        if (!(error instanceof StepFailure)) throw error;
        outcome = error.outcome;
        if (error.kind === "budget") stop = "stopped_budget";
        else if (error.kind === "rate_limit" || error.kind === "quota") stop = "stopped_rate_limit";
        else if (error.kind === "auth") stop = "stopped_auth";
      }
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      await recordAttempt(flight.id, outcome);
      if (stop) break;
    }
    return finish(stop ?? "done", counts, now);
  } finally {
    running = false;
  }
}

/** Test helper. */
export function __resetTrackSweepForTests(): void {
  lastSweep = null;
  running = false;
}
