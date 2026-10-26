/**
 * What a trip question stores, and the part the owner's inbox sees (TravTrack
 * plan L4).
 *
 * Stored (`location_suggestions.evidence`, server-side): the run's span and
 * away days, the zone they are named in, the countries of its away fixes, how
 * far it took the user from home, the trip it would widen (`trip.extend`) and
 * whether it waits in the aggregate entry. No position, no line, no digest:
 * the question is pinless, so E5 finds it by its days (`removalDays`).
 *
 * Shown (`publicTrip`): the same, plus the widened trip's name. Days,
 * countries, km — no map (plan L4 privacy).
 */
import { z } from "../../../schemas/zod";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const tripEvidence = z.object({
  source: z.literal("travtrack"),
  fromDay: DAY,
  toDay: DAY,
  zone: z.string(),
  awayDays: z.array(DAY).min(1),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)),
  km: z.number(),
  /** The trip a `trip.extend` question widens; null for a new trip. */
  tripId: z.string().nullable(),
  /** Beyond the per-run cap: shown inside "Weitere N Zeiträume unterwegs", not as a card. */
  aggregated: z.boolean(),
  readCoverage: z.enum(["complete", "truncated", "unreachable"]),
});

export type TripEvidence = z.infer<typeof tripEvidence>;

/** A stored trip question's evidence, or null when it is not one this build reads. */
export function parseTripEvidence(value: unknown): TripEvidence | null {
  const parsed = tripEvidence.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What an accepted question keeps once its history went (E5): its span only. */
const tripSummary = z.object({ fromDay: DAY, toDay: DAY, zone: z.string().optional() });

export type PublicTrip = {
  fromDay: string;
  toDay: string;
  zone: string | null;
  /** Days of the span, both ends included. */
  days: number;
  countries: string[];
  /** Null once the history behind an accepted question was deleted. */
  km: number | null;
  tripId: string | null;
  tripName: string | null;
  aggregated: boolean;
};

const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** The owner's view of a stored trip question; null when it cannot be read at all. */
export function publicTrip(value: unknown, names: ReadonlyMap<string, string>): PublicTrip | null {
  const full = parseTripEvidence(value);
  if (full) {
    return {
      fromDay: full.fromDay,
      toDay: full.toDay,
      zone: full.zone,
      days: spanDays(full.fromDay, full.toDay),
      countries: full.countries,
      km: full.km,
      tripId: full.tripId,
      tripName: full.tripId ? (names.get(full.tripId) ?? null) : null,
      aggregated: full.aggregated,
    };
  }
  const summary = tripSummary.safeParse(value);
  if (!summary.success) return null;
  return {
    fromDay: summary.data.fromDay,
    toDay: summary.data.toDay,
    zone: summary.data.zone ?? null,
    days: spanDays(summary.data.fromDay, summary.data.toDay),
    countries: [],
    km: null,
    tripId: null,
    tripName: null,
    aggregated: false,
  };
}

/** The trip a stored question would widen, for the name lookup. */
export function tripIdOf(value: unknown): string | null {
  return parseTripEvidence(value)?.tripId ?? null;
}
