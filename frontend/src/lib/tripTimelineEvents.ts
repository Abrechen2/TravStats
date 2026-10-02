import { formatLocalDate, formatTimeValueShown } from "./displayFormat";
import {
  cruiseEnd,
  cruiseStart,
  flightArrival,
  flightDeparture,
  journalDay,
  railDeparture,
  stayCheckIn,
  stayCheckOut,
  tripStopStart,
  visitTime,
} from "./entityTimes";
import {
  compareTimelineEvents,
  dayAsTimeValue,
  hasExplicitTime,
  isSupersededByPlaceVisit,
} from "./tripTimeline";
import { readsAsUtc, timeValueAtZone, type TimeValue } from "../shared/time";
import type { Trip, TripJournalEntry, TripStop } from "../types";
import type { Place, PlaceVisit } from "../types/place";
import type { TripRailJourney } from "../types/rail";
import type { TripRental } from "../types/rental";

/**
 * The trip timeline's entries — every dated thing a trip holds, in one
 * chronology. Moved out of `pages/TripDetailPage.tsx`, which is over the
 * 800-line limit and frozen at its size, when rail journeys joined the
 * timeline (spec 2026-09-25-rail-domain, phase 2b).
 *
 * Every entry's `when` is a `TimeValue` from `lib/entityTimes.ts`: the
 * place's own clock to show and group by, the instant to order within a day
 * (ADR 0002). No entry is read in the viewer's zone.
 */
export type TimelineEvent =
  | {
      id: string;
      kind: "flight";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      title: string;
      subtitle: string | null;
      /** The row itself, so the entry can open in place. It is already on the
       *  trip payload -- see the note on `Trip["flights"]`. */
      flight: NonNullable<Trip["flights"]>[number];
    }
  | {
      id: string;
      kind: "cruise";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      title: string;
      subtitle: string | null;
      cruise: NonNullable<Trip["cruises"]>[number];
    }
  | {
      id: string;
      kind: "stop";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      stop: TripStop;
    }
  | {
      id: string;
      kind: "journal";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      entry: TripJournalEntry;
    }
  | {
      id: string;
      kind: "lodging-checkin" | "lodging-checkout";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      stay: NonNullable<Trip["lodgingStays"]>[number];
    }
  | {
      id: string;
      kind: "rail";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      journey: TripRailJourney;
    }
  | {
      id: string;
      kind: "rental-pickup" | "rental-return";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      rental: TripRental;
    }
  | {
      id: string;
      kind: "place-visit";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      place: Place;
      visit: PlaceVisit;
    };

/** Rentals as entries: the pickup and the return, each on its station's clock. */
function rentalEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const rental of trip.rentalBookings ?? []) {
    const ends = [
      ["rental-pickup", rental.pickupTime, rental.pickupTimezone, rental.pickupPrecision],
      ["rental-return", rental.returnTime, rental.returnTimezone, rental.returnPrecision],
    ] as const;
    for (const [kind, time, zone, precision] of ends) {
      const when = timeValueAtZone(time, zone, precision === "day" ? "day" : "minute");
      if (!when) continue;
      out.push({ id: `${kind}-${rental.id}`, kind, date: when.utc, when, rental });
    }
  }
  return out;
}

/** Rail journeys as entries: one per ride, at its departure. */
function railEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const journey of trip.railJourneys ?? []) {
    const when = railDeparture(journey);
    if (!when) continue;
    out.push({ id: `rail-${journey.id}`, kind: "rail", date: when.utc, when, journey });
  }
  return out;
}

/** One end of a flight as the subtitle shows it: on its airport's clock, "UTC" where no zone is known. */
function flightEndLabel(value: TimeValue): string {
  const shown = formatTimeValueShown(value);
  return readsAsUtc(value) && hasExplicitTime(value) ? `${shown} UTC` : shown;
}

function flightEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const f of trip.flights ?? []) {
    const when = flightDeparture(f);
    if (!when) continue;
    const arrival = flightArrival(f);
    out.push({
      id: `flight-${f.id}`,
      kind: "flight",
      date: when.utc,
      when,
      title: `${f.depIata ?? "???"} → ${f.arrIata ?? "???"}`,
      // Each end on its own airport's clock (the server's `local`), never the
      // viewer's: `toLocaleString()` once put a JFK arrival six hours off the
      // boarding pass here.
      subtitle: arrival
        ? `${flightEndLabel(when)} → ${flightEndLabel(arrival)}`
        : flightEndLabel(when),
      flight: f,
    });
  }
  return out;
}

function cruiseEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const c of trip.cruises ?? []) {
    const start = cruiseStart(c);
    if (!start) continue;
    const end = cruiseEnd(c);
    const when = dayAsTimeValue(start);
    out.push({
      id: `cruise-${c.id}`,
      kind: "cruise",
      date: when.utc,
      when,
      title: c.cruiseLine ?? "Kreuzfahrt",
      subtitle: end
        ? `${formatLocalDate(start.date)} → ${formatLocalDate(end.date)}`
        : formatLocalDate(start.date),
      cruise: c,
    });
  }
  return out;
}

function stopEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const s of trip.stops ?? []) {
    // A migrated POI stop is drawn as its PlaceVisit instead. Both rows
    // exist between the backfill and the delete release, so without this
    // every migrated POI would appear twice — see isSupersededByPlaceVisit.
    if (isSupersededByPlaceVisit(s)) continue;
    // A stop without a date sits on the day it was written down (UTC, the
    // only day a creation instant has), without a clock.
    const when = tripStopStart(s) ?? timeValueAtZone(s.createdAt, null, "day");
    if (!when) continue;
    out.push({ id: `stop-${s.id}`, kind: "stop", date: when.utc, when, stop: s });
  }
  return out;
}

function lodgingEvents(trip: Trip): TimelineEvent[] {
  // Each linked stay renders as TWO timeline entries — a check-in and a
  // check-out — so the hotel is visible in the trip's chronology. An undated
  // stay has no place on one; it still shows in the lodging list below.
  const out: TimelineEvent[] = [];
  for (const s of trip.lodgingStays ?? []) {
    const checkIn = stayCheckIn(s);
    const checkOut = stayCheckOut(s);
    const inWhen = s.times?.checkInAt ?? (checkIn ? dayAsTimeValue(checkIn) : null);
    const outWhen = s.times?.checkOutAt ?? (checkOut ? dayAsTimeValue(checkOut) : null);
    if (inWhen) {
      const id = `lodging-checkin-${s.id}`;
      out.push({ id, kind: "lodging-checkin", date: inWhen.utc, when: inWhen, stay: s });
    }
    if (outWhen) {
      const id = `lodging-checkout-${s.id}`;
      out.push({ id, kind: "lodging-checkout", date: outWhen.utc, when: outWhen, stay: s });
    }
  }
  return out;
}

export function buildTimelineEvents(
  trip: Trip,
  placeVisits: ReadonlyArray<{ place: Place; visit: PlaceVisit }>
): TimelineEvent[] {
  const out: TimelineEvent[] = [
    ...railEvents(trip),
    ...rentalEvents(trip),
    ...flightEvents(trip),
    ...cruiseEvents(trip),
    ...stopEvents(trip),
  ];
  for (const { place, visit } of placeVisits) {
    // An undated visit has no place on a chronology; it still shows on the
    // place itself. Same rule an undated lodging stay already follows.
    const when = visitTime(visit);
    if (!when) continue;
    out.push({
      id: `place-visit-${visit.id}`,
      kind: "place-visit",
      date: when.utc,
      when,
      place,
      visit,
    });
  }
  for (const e of trip.journalEntries ?? []) {
    const day = journalDay(e);
    if (!day) continue;
    const when = dayAsTimeValue(day);
    out.push({ id: `journal-${e.id}`, kind: "journal", date: when.utc, when, entry: e });
  }
  out.push(...lodgingEvents(trip));
  // #175: grouped by the place's day, ordered within it, a day's diary entry
  // last. See compareTimelineEvents — the rules and why they exist live there.
  return out.sort(compareTimelineEvents);
}
