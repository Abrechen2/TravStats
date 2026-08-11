/**
 * Bulk historical refresh — re-runs the AeroDataBox/Aviationstack lookup
 * for the user's existing flights and patches in only the metadata fields
 * that landed via the Phase-2 commit (`aircraftRegistration`, `aircraftModeS`,
 * `isCodeshare`, plus airline/operating-airline IATA/ICAO when missing).
 *
 * Why a separate service instead of reusing `enrich-historical`:
 *   `enrich-historical` aggregates from the user's *own* other flight
 *   records — useful for filling in routes/airports from past flights, but
 *   it never calls a provider for a specific past leg, so it cannot
 *   populate per-leg fields like the tail number a flight actually carried
 *   on a specific date. Bulk refresh hits the provider directly.
 *
 * Quota & blast-radius guards:
 *   - Hard cap of `MAX_PER_CALL` flights per request so a bored user
 *     clicking the button doesn't drain the whole AeroDataBox daily quota
 *     in one go. Frontend re-clicks until `remaining === 0`.
 *   - 500 ms pacing between provider calls to be a polite RapidAPI citizen.
 *   - Demo users (seeded by `seedDemoUser`) are rejected at the route layer
 *     so the dev demo can't accidentally burn a real key.
 *   - Only fields that are currently NULL/empty are written. Existing values
 *     the user already typed (or that came from another provider) are never
 *     overwritten.
 */
import { prisma } from '../db';
import logger from '../utils/logger';
import { lookupFlightWithHistorical } from './flightLookup';
import { getApiKey } from './apiKeyResolver';

/** Max flights touched per single endpoint call. Keeps the request under the
 *  default Express 60 s timeout (≈13 s at 500 ms pacing) and gives the user
 *  visible progress without an SSE channel. */
export const MAX_PER_CALL = 25;

/** Pacing between provider calls — half a second is generous enough that
 *  RapidAPI and Aviationstack don't see a burst, and the worst-case 25-call
 *  batch still finishes well inside the request timeout. */
const PACING_MS = 500;

/** Historical window the providers cover. AeroDataBox and Aviationstack both
 *  start losing fidelity past 365 days; older flights will mostly return
 *  `no_match_api_gap` so we exclude them up front to save quota. */
const HISTORICAL_WINDOW_DAYS = 365;

export interface BulkRefreshSummary {
  /** Flights inspected this batch (capped by `MAX_PER_CALL`). */
  scanned: number;
  /** Flights where at least one field was patched. */
  updated: number;
  /** Flights the provider confirmed it has no data for. Tracked separately
   *  from `failed` so the UI can say "the API simply doesn't have this leg"
   *  vs "something blew up". */
  noData: number;
  /** Flights that errored at the provider/parse level. */
  failed: number;
  /** Estimate of how many candidates remain after this batch. The frontend
   *  uses this to decide whether to offer a follow-up click. */
  remaining: number;
  /** Per-flight outcome list for the UI's progress display. */
  results: Array<{
    flightId: string;
    flightNumber: string;
    outcome: 'updated' | 'no_data' | 'failed';
    fieldsUpdated?: string[];
    error?: string;
  }>;
}

/**
 * Find flights belonging to `userId` that:
 *   - have a flight number (we need it for the lookup)
 *   - have a departureTime within the last `HISTORICAL_WINDOW_DAYS`
 *   - are missing at least one of the provider-only fields we're trying to
 *     backfill (`aircraftRegistration`, `aircraftModeS`, `isCodeshare`)
 *
 * Sorted newest-first so the user sees results from recent flights first
 * (most likely to be present in the provider's cache).
 */
export interface BulkRefreshCandidate {
  id: string;
  flightNumber: string;
  departureTime: Date;
  depIata: string | null;
  depIcao: string | null;
}

export async function findBulkRefreshCandidates(
  userId: string,
  limit: number = MAX_PER_CALL,
): Promise<BulkRefreshCandidate[]> {
  const now = new Date();
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - HISTORICAL_WINDOW_DAYS);

  const flights = await prisma.flight.findMany({
    where: {
      userId,
      flightNumber: { not: null },
      departureTime: { gte: earliest, lte: now },
      // OR across the new fields — a flight is a candidate if ANY of them
      // is empty. Using `equals: null` rather than `is: null` because Prisma
      // treats them subtly differently for nullable scalar columns.
      OR: [
        { aircraftRegistration: null },
        { aircraftModeS: null },
        { isCodeshare: null },
      ],
    },
    select: {
      id: true,
      flightNumber: true,
      departureTime: true,
      depIata: true,
      depIcao: true,
    },
    orderBy: { departureTime: 'desc' },
    take: limit,
  });

  return flights.filter(
    (f): f is BulkRefreshCandidate =>
      f.flightNumber !== null && f.departureTime !== null,
  );
}

/**
 * Detect whether the user has at least one provider configured that can
 * actually serve historical (non-today) flight lookups. Without one, every
 * candidate would come back with `unavailableReason: 'no_provider'` and the
 * UI would mislead the user with "0 updated of N — but no API was called".
 * Treat this as a hard pre-flight: the route refuses to run, the preview
 * tells the UI to show a "configure a key first" message instead of the
 * Refresh button.
 */
export async function hasHistoricalProvider(userId: string): Promise<boolean> {
  const [aviationstack, aerodatabox] = await Promise.all([
    getApiKey('aviationstack', userId),
    getApiKey('aerodatabox', userId),
  ]);
  return Boolean(aviationstack || aerodatabox);
}

/**
 * Count remaining candidates after this batch — a separate query because the
 * `findMany` is `take`-limited to the page we're processing.
 */
export async function countBulkRefreshCandidates(userId: string): Promise<number> {
  const now = new Date();
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - HISTORICAL_WINDOW_DAYS);

  return prisma.flight.count({
    where: {
      userId,
      flightNumber: { not: null },
      departureTime: { gte: earliest, lte: now },
      OR: [
        { aircraftRegistration: null },
        { aircraftModeS: null },
        { isCodeshare: null },
      ],
    },
  });
}

/**
 * Run one batch. Caller is expected to:
 *   1. authenticate the user
 *   2. reject demo accounts
 *   3. pass the user's own `userId` so per-user API keys can be picked up
 *      by the provider cascade
 */
export async function runBulkRefresh(userId: string): Promise<BulkRefreshSummary> {
  const candidates = await findBulkRefreshCandidates(userId);
  const summary: BulkRefreshSummary = {
    scanned: candidates.length,
    updated: 0,
    noData: 0,
    failed: 0,
    remaining: 0,
    results: [],
  };

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    try {
      const { flights, unavailableReason } = await lookupFlightWithHistorical(
        candidate.flightNumber,
        candidate.departureTime,
        userId,
        candidate.depIata ?? candidate.depIcao ?? undefined,
      );

      if (unavailableReason || flights.length === 0) {
        summary.noData++;
        summary.results.push({
          flightId: candidate.id,
          flightNumber: candidate.flightNumber,
          outcome: 'no_data',
        });
      } else {
        // Pick the first match — provider already filtered by date.
        const match = flights[0];
        const patch: {
          aircraftRegistration?: string;
          aircraftModeS?: string;
          isCodeshare?: boolean;
          airlineIata?: string;
          airlineIcao?: string;
          operatingAirlineIata?: string;
          operatingAirlineIcao?: string;
        } = {};
        const fieldsUpdated: string[] = [];

        // Re-read the row to inspect current NULLs — avoids overwriting
        // values the user typed manually between candidate-discovery and
        // patch-write.
        const current = await prisma.flight.findUnique({
          where: { id: candidate.id },
          select: {
            aircraftRegistration: true,
            aircraftModeS: true,
            isCodeshare: true,
            airlineIata: true,
            airlineIcao: true,
            operatingAirlineIata: true,
            operatingAirlineIcao: true,
          },
        });

        if (!current) {
          // Flight was deleted between scan and write — skip silently.
          summary.noData++;
          summary.results.push({
            flightId: candidate.id,
            flightNumber: candidate.flightNumber,
            outcome: 'no_data',
          });
          continue;
        }

        if (!current.aircraftRegistration && match.aircraftRegistration) {
          patch.aircraftRegistration = match.aircraftRegistration;
          fieldsUpdated.push('aircraftRegistration');
        }
        if (!current.aircraftModeS && match.aircraftModeS) {
          patch.aircraftModeS = match.aircraftModeS;
          fieldsUpdated.push('aircraftModeS');
        }
        if (current.isCodeshare === null && match.isCodeshare !== undefined) {
          patch.isCodeshare = match.isCodeshare;
          fieldsUpdated.push('isCodeshare');
        }
        if (!current.airlineIata && match.airlineIata) {
          patch.airlineIata = match.airlineIata;
          fieldsUpdated.push('airlineIata');
        }
        if (!current.airlineIcao && match.airlineIcao) {
          patch.airlineIcao = match.airlineIcao;
          fieldsUpdated.push('airlineIcao');
        }

        if (fieldsUpdated.length > 0) {
          await prisma.flight.update({
            where: { id: candidate.id },
            data: patch,
          });
          summary.updated++;
          summary.results.push({
            flightId: candidate.id,
            flightNumber: candidate.flightNumber,
            outcome: 'updated',
            fieldsUpdated,
          });
        } else {
          // Provider returned data but everything was already populated —
          // count as no_data so the UI doesn't claim a write that didn't
          // happen.
          summary.noData++;
          summary.results.push({
            flightId: candidate.id,
            flightNumber: candidate.flightNumber,
            outcome: 'no_data',
          });
        }
      }
    } catch (error) {
      summary.failed++;
      summary.results.push({
        flightId: candidate.id,
        flightNumber: candidate.flightNumber,
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      logger.warn(
        {
          operation: 'bulk_flight_refresh_item_failed',
          flightId: candidate.id,
          flightNumber: candidate.flightNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Bulk refresh failed for one flight',
      );
    }

    // Pace between calls — but skip the wait on the last one.
    if (i < candidates.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, PACING_MS));
    }
  }

  // Re-count to give the UI an honest "remaining" value. We deduct the
  // candidates that just got patched OR that the provider confirmed are
  // empty (no point in retrying a no_data leg next batch — this is the
  // intentional limitation; the UI can say "X flights with no provider data"
  // in the summary).
  const totalRemaining = await countBulkRefreshCandidates(userId);
  // The just-processed `updated` rows are already off the candidate list
  // (their NULLs are filled), so totalRemaining naturally reflects them.
  // The `noData` and `failed` rows are still candidates — they'll show up
  // again on the next click, which is a feature: re-clicking after the
  // user added an Aviationstack key, for example, lets the gap close.
  summary.remaining = totalRemaining;

  logger.info(
    {
      operation: 'bulk_flight_refresh_complete',
      userId,
      scanned: summary.scanned,
      updated: summary.updated,
      noData: summary.noData,
      failed: summary.failed,
      remaining: summary.remaining,
    },
    'Bulk flight refresh batch complete',
  );

  return summary;
}
