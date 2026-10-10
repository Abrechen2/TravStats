import type { RecordCheckDomain } from "../../../schemas/dataQualityRecordChecks";
import { daysBetween } from "../../../shared/time/localDate";
import type { RecordSnapshot } from "../recordGather";
import type { DataQualityFinding } from "../types";

/**
 * A trip whose own dates do not hold its story (forgejo#282). Two questions:
 *
 * **`trip_end_missing`** — a start, no end, and the start is long past: the
 * trip is `completed`, or it began more than {@link OPEN_TRIP_GRACE_DAYS} days
 * ago. A trip that is still running legitimately has no end yet, and a trip
 * with no dates at all is a plan or a wish, not an incomplete record. The
 * last day any linked entry reaches travels as a suggestion — it is shown,
 * never written.
 *
 * **`trip_entries_outside`** — a trip with both days set, and linked entries
 * (flights, trains, buses, cruises, stays) whose days fall outside them.
 * Each entry's days are read on its own clock (ADR 0002: a flight on its
 * airports' calendars, a stay on its own calendar dates). **Tolerance: one
 * day at each edge** — an overnight leg home that lands the morning after the
 * last day, a departure the evening before the first, or a day read off a
 * legacy value with no zone are all within it. Undated and cancelled entries
 * are not judged.
 *
 * "Today" is the run's own `now`, read as a UTC calendar day; with a 30-day
 * grace the zone cannot change the answer.
 */
export const OPEN_TRIP_GRACE_DAYS = 30;
export const TRIP_EDGE_TOLERANCE_DAYS = 1;

interface TripEntry {
  entityType: RecordCheckDomain;
  entityId: string;
  label: string;
  parentId: string | null;
  firstDay: string;
  lastDay: string;
}

type Snapshot = Pick<
  RecordSnapshot,
  "trips" | "flights" | "railJourneys" | "busJourneys" | "cruises" | "stays"
>;

/** Every dated, live entry that names a trip, indexed by that trip — one pass. */
function entriesByTrip(snapshot: Snapshot): Map<string, TripEntry[]> {
  const byTrip = new Map<string, TripEntry[]>();
  const add = (
    entityType: RecordCheckDomain,
    rows: ReadonlyArray<{
      id: string;
      label: string;
      status: string;
      tripId: string | null;
      firstDay: string | null;
      lastDay: string | null;
      lodgingId?: string;
    }>
  ): void => {
    for (const row of rows) {
      if (!row.tripId || !row.firstDay || row.status === "cancelled") continue;
      const entry: TripEntry = {
        entityType,
        entityId: row.id,
        label: row.label,
        parentId: row.lodgingId ?? null,
        firstDay: row.firstDay,
        lastDay: row.lastDay ?? row.firstDay,
      };
      byTrip.set(row.tripId, [...(byTrip.get(row.tripId) ?? []), entry]);
    }
  };
  add("flight", snapshot.flights);
  add("rail_journey", snapshot.railJourneys);
  add("bus_journey", snapshot.busJourneys);
  add("cruise", snapshot.cruises);
  add("lodging_stay", snapshot.stays);
  return byTrip;
}

const byDayThenId = (a: TripEntry, b: TripEntry): number =>
  a.firstDay < b.firstDay
    ? -1
    : a.firstDay > b.firstDay
      ? 1
      : `${a.entityType}${a.entityId}` < `${b.entityType}${b.entityId}`
        ? -1
        : 1;

export function findIncompleteTrips(snapshot: Snapshot, now: Date): DataQualityFinding[] {
  const today = now.toISOString().slice(0, 10);
  const byTrip = entriesByTrip(snapshot);
  const findings: DataQualityFinding[] = [];

  for (const trip of snapshot.trips) {
    const entries = byTrip.get(trip.id) ?? [];

    if (trip.startDay && !trip.endDay) {
      const longPast = daysBetween(trip.startDay, today) > OPEN_TRIP_GRACE_DAYS;
      if (trip.status === "completed" || longPast) {
        const lastEntryDay = entries.reduce<string | null>(
          (latest, e) => (latest === null || e.lastDay > latest ? e.lastDay : latest),
          null
        );
        findings.push({
          entityType: "trip",
          entityId: trip.id,
          kind: "trip_end_missing",
          details: { startDay: trip.startDay, lastEntryDay },
        });
      }
      continue;
    }

    if (!trip.startDay || !trip.endDay || trip.startDay > trip.endDay) continue;
    const { startDay, endDay } = trip;
    const outside = entries
      .filter(
        (e) =>
          daysBetween(e.firstDay, startDay) > TRIP_EDGE_TOLERANCE_DAYS ||
          daysBetween(endDay, e.lastDay) > TRIP_EDGE_TOLERANCE_DAYS
      )
      .sort(byDayThenId);
    if (outside.length === 0) continue;
    findings.push({
      entityType: "trip",
      entityId: trip.id,
      kind: "trip_entries_outside",
      details: { startDay, endDay, entries: outside },
    });
  }
  return findings;
}
