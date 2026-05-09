/**
 * Diagnostics bundle — user-data snapshot for bug reports.
 *
 * Issue #105. Distinct from `diagnosticExport.ts`, which returns server
 * log tails for crash investigation: this endpoint returns the user's
 * own *data state* (selected flights + trips) so a maintainer reading a
 * GitHub issue can see exactly what rows triggered the bug.
 *
 * PII philosophy: a `redacted` array on every response advertises which
 * fields were stripped. We ship the version + schema fields outside the
 * redaction list so the maintainer can reproduce against the right code.
 */

import { prisma } from '../db';
import { appVersion } from '../utils/version';

/**
 * Field names whose values are redacted before the bundle leaves the
 * server. The list is also returned in the response so consumers can
 * verify what was stripped without reading the source.
 */
export const REDACTED_FIELDS = [
  'bookingReference',
  'ticketNumber',
  'frequentFlyerNumber',
  'price',
  'taxes',
  'fees',
  'currency',
  'receiptUrl',
  'coPassengers',
  'companions',
  'userId',
  'notes',
] as const;

const REDACTED_SET = new Set<string>(REDACTED_FIELDS);

interface BundleFilters {
  flightIds?: string[];
  tripIds?: string[];
  airline?: string;
  since?: Date;
}

interface DiagnosticsBundle {
  generatedAt: string;
  travstatsVersion: string;
  schemaVersion: string;
  redacted: readonly string[];
  flights: Array<Record<string, unknown>>;
  trips: Array<Record<string, unknown>>;
  recentErrors: never[];      // reserved for v1.5.x — see issue #105
  filters: BundleFilters;
  counts: { flights: number; trips: number };
}

/**
 * Strip listed fields from a row. Replaces them with `null` so consumers
 * can still see the field exists (vs. inferring from absence).
 */
function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = REDACTED_SET.has(k) ? null : v;
  }
  return out;
}

/**
 * Collect the diagnostics bundle for a user with optional filters.
 * All queries are user-scoped — no cross-user data ever surfaces.
 */
export async function buildDiagnosticsBundle(
  userId: string,
  filters: BundleFilters,
): Promise<DiagnosticsBundle> {
  // Build flight WHERE — empty filters means "give me everything"; we
  // still cap the response below to avoid runaway dumps.
  const flightWhere: Record<string, unknown> = { userId };
  if (filters.flightIds?.length) flightWhere.id = { in: filters.flightIds };
  if (filters.airline) flightWhere.airline = filters.airline;
  if (filters.since) flightWhere.updatedAt = { gte: filters.since };

  const tripWhere: Record<string, unknown> = { userId };
  if (filters.tripIds?.length) tripWhere.id = { in: filters.tripIds };
  if (filters.since) tripWhere.updatedAt = { gte: filters.since };

  // Cap: bug reports never need 500+ rows. If the user filtered nothing,
  // we still want to surface SOME data so the bundle isn't empty —
  // 100/50 is enough for any realistic round-trip / multi-week trip.
  const FLIGHT_CAP = filters.flightIds?.length ? filters.flightIds.length : 100;
  const TRIP_CAP   = filters.tripIds?.length   ? filters.tripIds.length   : 50;

  const [rawFlights, rawTrips] = await Promise.all([
    prisma.flight.findMany({
      where: flightWhere,
      orderBy: { departureTime: 'desc' },
      take: FLIGHT_CAP,
    }),
    prisma.trip.findMany({
      where: tripWhere,
      orderBy: { updatedAt: 'desc' },
      take: TRIP_CAP,
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    travstatsVersion: appVersion,
    schemaVersion: '1',
    redacted: REDACTED_FIELDS,
    flights: rawFlights.map((f) => redactRow(f as unknown as Record<string, unknown>)),
    trips:   rawTrips.map((t)   => redactRow(t as unknown as Record<string, unknown>)),
    recentErrors: [],
    filters,
    counts: { flights: rawFlights.length, trips: rawTrips.length },
  };
}
