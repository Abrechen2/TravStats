import { formatDateTimeInTimezone } from "./dateUtils";
import { formatDate } from "./displayFormat";
import { compareTimelineEvents, isSupersededByPlaceVisit } from "./tripTimeline";
import type { Trip, TripJournalEntry, TripStop } from "../types";
import type { Place, PlaceVisit } from "../types/place";
import type { TripRailJourney } from "../types/rail";

/**
 * The trip timeline's entries — every dated thing a trip holds, in one
 * chronology. Moved out of `pages/TripDetailPage.tsx`, which is over the
 * 800-line limit and frozen at its size, when rail journeys joined the
 * timeline (spec 2026-09-25-rail-domain, phase 2b).
 */
export type TimelineEvent =
  | {
      id: string;
      kind: "flight";
      date: string;
      title: string;
      subtitle: string | null;
      /** The row itself, so the entry can open in place. It is already on the
       *  trip payload -- see the note on `Trip["flights"]`. */
      flight: NonNullable<Trip["flights"]>[number];
    }
  | {
      id: string;
      kind: "cruise";
      date: string;
      title: string;
      subtitle: string | null;
      cruise: NonNullable<Trip["cruises"]>[number];
    }
  | {
      id: string;
      kind: "stop";
      date: string;
      stop: TripStop;
    }
  | {
      id: string;
      kind: "journal";
      date: string;
      entry: TripJournalEntry;
    }
  | {
      id: string;
      kind: "lodging-checkin" | "lodging-checkout";
      date: string;
      stay: NonNullable<Trip["lodgingStays"]>[number];
    }
  | {
      id: string;
      kind: "rail";
      date: string;
      journey: TripRailJourney;
    }
  | {
      id: string;
      kind: "place-visit";
      date: string;
      place: Place;
      visit: PlaceVisit;
    };

/** Rail journeys as entries: one per ride, at its departure instant. */
function railEvents(trip: Trip): TimelineEvent[] {
  return (trip.railJourneys ?? []).map((journey) => ({
    id: `rail-${journey.id}`,
    kind: "rail" as const,
    date: journey.departureTime,
    journey,
  }));
}

export function buildTimelineEvents(
  trip: Trip,
  placeVisits: ReadonlyArray<{ place: Place; visit: PlaceVisit }>,
  userTz: string
): TimelineEvent[] {
  const out: TimelineEvent[] = [...railEvents(trip)];
  for (const f of trip.flights ?? []) {
    if (!f.departureTime) continue;
    out.push({
      id: `flight-${f.id}`,
      kind: "flight",
      date: f.departureTime,
      title: `${f.depIata ?? "???"} → ${f.arrIata ?? "???"}`,
      // Airport-local, not the viewer's clock. `toLocaleString()` rendered a
      // JFK arrival in Europe/Berlin, so the same flight read 13:45 in the
      // flights table and 19:45 here — six hours apart from the boarding
      // pass. Each end is formatted against its own airport's zone, with the
      // stored time semantics so a DATE_ONLY historical row keeps its date.
      subtitle: f.arrivalTime
        ? `${formatDateTimeInTimezone(f.departureTime, f.depTimezone || userTz, f.depTimeSemantics)} → ${formatDateTimeInTimezone(f.arrivalTime, f.arrTimezone || userTz, f.arrTimeSemantics)}`
        : formatDateTimeInTimezone(f.departureTime, f.depTimezone || userTz, f.depTimeSemantics),
      flight: f,
    });
  }
  for (const c of trip.cruises ?? []) {
    if (!c.startDate) continue;
    out.push({
      id: `cruise-${c.id}`,
      kind: "cruise",
      date: c.startDate,
      title: c.cruiseLine ?? "Kreuzfahrt",
      subtitle: c.endDate
        ? `${formatDate(c.startDate)} → ${formatDate(c.endDate)}`
        : formatDate(c.startDate),
      cruise: c,
    });
  }
  for (const s of trip.stops ?? []) {
    // A migrated POI stop is drawn as its PlaceVisit instead. Both rows
    // exist between the backfill and the delete release, so without this
    // every migrated POI would appear twice — see isSupersededByPlaceVisit.
    if (isSupersededByPlaceVisit(s)) continue;
    out.push({
      id: `stop-${s.id}`,
      kind: "stop",
      date: s.startDate ?? s.createdAt,
      stop: s,
    });
  }
  for (const { place, visit } of placeVisits) {
    // An undated visit has no place on a chronology; it still shows on the
    // place itself. Same rule an undated lodging stay already follows.
    if (!visit.visitedAt) continue;
    out.push({
      id: `place-visit-${visit.id}`,
      kind: "place-visit",
      date: visit.visitedAt,
      place,
      visit,
    });
  }
  for (const e of trip.journalEntries ?? []) {
    out.push({
      id: `journal-${e.id}`,
      kind: "journal",
      date: e.date,
      entry: e,
    });
  }
  // Each linked stay renders as TWO timeline entries — a check-in and a
  // check-out — mirroring how TripStop entries already work, so the
  // hotel is actually visible in the trip's chronology instead of
  // disappearing once it's assigned (the spec gap this closes).
  for (const s of trip.lodgingStays ?? []) {
    // A timeline is ordered by date, so an undated stay has no place on one.
    // It is still shown on the trip — in the lodging list below, which needs
    // no chronology — rather than being dropped from the page.
    if (s.checkIn !== null) {
      out.push({
        id: `lodging-checkin-${s.id}`,
        kind: "lodging-checkin",
        date: s.checkIn,
        stay: s,
      });
    }
    if (s.checkOut !== null) {
      out.push({
        id: `lodging-checkout-${s.id}`,
        kind: "lodging-checkout",
        date: s.checkOut,
        stay: s,
      });
    }
  }
  // #175: ordered by time of day, with a day's diary entry last. See
  // compareTimelineEvents — the tie-break rules and the reason they exist
  // live there, not here.
  return out.sort(compareTimelineEvents);
}
