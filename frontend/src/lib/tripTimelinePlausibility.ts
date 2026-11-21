import { readsAsUtc, type TimeValue } from "../shared/time";
import { hasExplicitTime } from "./tripTimeline";
import { calculateDistance } from "./geo";
import type { TimelineEvent } from "./tripTimelineEvents";

/**
 * Plausibility of a trip's timeline (forgejo#426). It MARKS sequences that
 * cannot have happened — it never reorders and never edits a value. One home,
 * on the web: the timeline is assembled here (`buildTimelineEvents`), so a
 * server twin would be a second copy of the chronology to drift.
 *
 * Abstention is a result. A finding needs both values to be comparable:
 *  - both zones known  -> compare the instants;
 *  - a zone is missing -> the wall clocks are compared only where the two
 *    values are at the SAME place (one place, one clock) or both are read as
 *    UTC; otherwise the pair is skipped;
 *  - a date-only value only supports day-level rules.
 * Lodging times are the booking's nominal 11:00/15:00 (rc.39), so lodging is
 * judged by day, never by clock.
 *
 * The traveller is one person: two legs at once, or a second rental before the
 * first one is back, cannot both be true.
 */

export type PlausibilityCode =
  | "legBeforeArrival"
  | "rentalReturnAfterDeparture"
  | "rentalPickupBeforeArrival"
  | "rentalReturnBeforePickup"
  | "rentalsOverlap"
  | "stayOverlap"
  | "checkOutBeforeCheckIn"
  | "checkInBeforeArrival"
  | "checkOutAfterDeparture"
  | "visitDuringLeg";

export interface TimelineFinding {
  code: PlausibilityCode;
  /** The timeline entry that carries the warning. */
  eventId: string;
  /** The entry it contradicts. */
  otherEventId: string;
}

/** A rental station and a leg's end are "the same place" within this. */
const SAME_PLACE_KM = 5;
/** A hotel is "at" a leg's end within this. */
const HOTEL_NEAR_KM = 25;

interface Place {
  iata?: string | null;
  lat?: number | null;
  lon?: number | null;
}

const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

function near(a: Place, b: Place, km: number): boolean {
  if (a.iata && b.iata && a.iata.toUpperCase() === b.iata.toUpperCase()) return true;
  if (!finite(a.lat) || !finite(a.lon) || !finite(b.lat) || !finite(b.lon)) return false;
  return calculateDistance(a.lat, a.lon, b.lat, b.lon) <= km;
}

type Order = "before" | "same" | "after";

/** `a` against `b` at the minute, or null where the pair cannot be compared (see header). */
function compareClock(a: TimeValue, b: TimeValue, samePlace: boolean): Order | null {
  if (!hasExplicitTime(a) || !hasExplicitTime(b)) return null;
  const known = !readsAsUtc(a) && !readsAsUtc(b);
  const bothUtc = readsAsUtc(a) && readsAsUtc(b);
  let x: string;
  let y: string;
  if (known || bothUtc) {
    x = a.utc;
    y = b.utc;
  } else if (samePlace) {
    x = a.local;
    y = b.local;
  } else return null;
  return x < y ? "before" : x > y ? "after" : "same";
}

const dayOfValue = (v: TimeValue): string => v.local.slice(0, 10);

function compareDays(a: TimeValue, b: TimeValue): Order {
  const x = dayOfValue(a);
  const y = dayOfValue(b);
  return x < y ? "before" : x > y ? "after" : "same";
}

/** By the minute where both carry a clock, else by the day — and "same day" then abstains. */
function strictlyBefore(a: TimeValue, b: TimeValue, samePlace: boolean): boolean {
  if (hasExplicitTime(a) && hasExplicitTime(b)) return compareClock(a, b, samePlace) === "before";
  return compareDays(a, b) === "before";
}

/** `end` falls after `when`: by the instant where both carry a clock, else by the day. */
function endsAfter(end: TimeValue, when: TimeValue): boolean {
  if (hasExplicitTime(end) && hasExplicitTime(when)) {
    const order = compareClock(end, when, true);
    if (order !== null) return order === "after";
  }
  return compareDays(end, when) === "after";
}

const isCancelled = (row: unknown): boolean =>
  (row as { status?: string } | null)?.status === "cancelled";

interface Leg {
  ev: TimelineEvent;
  start: TimeValue;
  end: TimeValue;
  dep: Place;
  arr: Place;
}

function legOf(ev: TimelineEvent): Leg | null {
  if (!ev.end) return null;
  if (ev.kind === "flight") {
    const f = ev.flight;
    if (isCancelled(f)) return null;
    return {
      ev,
      start: ev.when,
      end: ev.end,
      dep: { iata: f.depIata, lat: f.depLat, lon: f.depLon },
      arr: { iata: f.arrIata, lat: f.arrLat, lon: f.arrLon },
    };
  }
  if (ev.kind === "rail" || ev.kind === "bus" || ev.kind === "ferry") {
    const j = ev.kind === "rail" ? ev.journey : ev.ride;
    if (isCancelled(j)) return null;
    return {
      ev,
      start: ev.when,
      end: ev.end,
      dep: { lat: j.depLat, lon: j.depLon },
      arr: { lat: j.arrLat, lon: j.arrLon },
    };
  }
  return null;
}

function add(
  out: TimelineFinding[],
  code: PlausibilityCode,
  ev: TimelineEvent,
  other: TimelineEvent
) {
  out.push({ code, eventId: ev.id, otherEventId: other.id });
}

/** A leg that leaves before the previous one has arrived — two legs at once. */
function legFindings(legs: Leg[], out: TimelineFinding[]): void {
  for (let i = 0; i < legs.length; i++) {
    for (let j = 0; j < legs.length; j++) {
      if (i === j) continue;
      const a = legs[i];
      const b = legs[j];
      // `a` is the earlier leg; equal starts count once, in list order.
      const order = compareClock(a.start, b.start, near(a.dep, b.dep, SAME_PLACE_KM));
      if (order === null || order === "after" || (order === "same" && i > j)) continue;
      const overlaps = compareClock(b.start, a.end, near(a.arr, b.dep, SAME_PLACE_KM)) === "before";
      if (overlaps) add(out, "legBeforeArrival", b.ev, a.ev);
    }
  }
}

function rentalFindings(events: TimelineEvent[], legs: Leg[], out: TimelineFinding[]): void {
  type Rental = Extract<TimelineEvent, { kind: "rental-pickup" | "rental-return" }>;
  const rentals = events.filter(
    (e): e is Rental =>
      (e.kind === "rental-pickup" || e.kind === "rental-return") && !isCancelled(e.rental)
  );
  const pickupOf = (id: string) =>
    rentals.find((e) => e.kind === "rental-pickup" && e.rental.id === id);
  const returnOf = (id: string) =>
    rentals.find((e) => e.kind === "rental-return" && e.rental.id === id);
  const place = (e: Rental): Place =>
    e.kind === "rental-pickup"
      ? { iata: e.rental.pickupIata, lat: e.rental.pickupLat, lon: e.rental.pickupLon }
      : { iata: e.rental.returnIata, lat: e.rental.returnLat, lon: e.rental.returnLon };

  for (const e of rentals) {
    if (e.kind === "rental-return") {
      const pickup = pickupOf(e.rental.id);
      if (pickup && strictlyBefore(e.when, pickup.when, false)) {
        add(out, "rentalReturnBeforePickup", e, pickup);
      }
      // The car is back only after the traveller left from the station's town.
      for (const leg of legs) {
        if (!near(place(e), leg.dep, SAME_PLACE_KM)) continue;
        const afterPickup = !pickup || !strictlyBefore(leg.start, pickup.when, false);
        const sameDay = compareDays(leg.start, e.when) === "same";
        if (!afterPickup && !sameDay) continue;
        // A side trip that came back to the station's town before the return is fine.
        const cameBack = legs.some(
          (l) =>
            l !== leg &&
            near(place(e), l.arr, SAME_PLACE_KM) &&
            l.start.utc > leg.start.utc &&
            !endsAfter(l.end, e.when)
        );
        if (!cameBack && strictlyBefore(leg.start, e.when, true)) {
          add(out, "rentalReturnAfterDeparture", e, leg.ev);
          break;
        }
      }
    } else {
      // Collected before the traveller arrived — same day, the only day it is certain.
      // Only the arrival that brought the traveller to the station counts: the
      // first one INTO the town. A later one is the way back from a side trip.
      const brought = legs
        .filter(
          (l) => near(place(e), l.arr, SAME_PLACE_KM) && !near(place(e), l.dep, SAME_PLACE_KM)
        )
        .sort((a, b) => a.end.utc.localeCompare(b.end.utc))[0];
      if (
        brought &&
        compareDays(brought.end, e.when) === "same" &&
        compareClock(e.when, brought.end, true) === "before"
      ) {
        add(out, "rentalPickupBeforeArrival", e, brought.ev);
      }
    }
  }
  // One car at a time: a pickup while the previous rental is still out.
  for (const x of rentals) {
    if (x.kind !== "rental-pickup") continue;
    for (const y of rentals) {
      if (y.kind !== "rental-pickup" || y.rental.id === x.rental.id) continue;
      const ret = returnOf(y.rental.id);
      if (!ret) continue;
      const order =
        hasExplicitTime(x.when) && hasExplicitTime(y.when)
          ? compareClock(y.when, x.when, false)
          : compareDays(y.when, x.when);
      const yFirst = order === "before" || (order === "same" && y.id < x.id);
      // y was collected first; x collected before y came back.
      if (yFirst && strictlyBefore(x.when, ret.when, false)) {
        add(out, "rentalsOverlap", x, y);
      }
    }
  }
}

function lodgingFindings(events: TimelineEvent[], legs: Leg[], out: TimelineFinding[]): void {
  type Check = Extract<TimelineEvent, { kind: "lodging-checkin" | "lodging-checkout" }>;
  const checks = events.filter(
    (e): e is Check =>
      (e.kind === "lodging-checkin" || e.kind === "lodging-checkout") && !isCancelled(e.stay)
  );
  const outOf = (id: string) =>
    checks.find((e) => e.kind === "lodging-checkout" && e.stay.id === id);
  const stays = checks.filter((e) => e.kind === "lodging-checkin");

  for (const cin of stays) {
    const cout = outOf(cin.stay.id);
    if (cout && compareDays(cout.when, cin.when) === "before") {
      add(out, "checkOutBeforeCheckIn", cout, cin);
    }
  }
  for (const x of stays) {
    for (const y of stays) {
      if (x.stay.id === y.stay.id || x.stay.lodgingId === y.stay.lodgingId) continue;
      const xo = outOf(x.stay.id);
      const yo = outOf(y.stay.id);
      if (!xo || !yo) continue;
      // Nights [in, out): a same-day hand-over is not an overlap; y is the later one.
      const sane =
        compareDays(x.when, xo.when) === "before" && compareDays(y.when, yo.when) === "before";
      const overlap =
        compareDays(y.when, xo.when) === "before" && compareDays(x.when, yo.when) === "before";
      if (
        sane &&
        overlap &&
        (compareDays(x.when, y.when) === "before" ||
          (compareDays(x.when, y.when) === "same" && x.id < y.id))
      ) {
        add(out, "stayOverlap", y, x);
      }
    }
  }
  // Against the legs, by day and by coordinates; a hotel with no position abstains.
  for (const cin of stays) {
    const at: Place = { lat: cin.stay.lodging?.lat, lon: cin.stay.lodging?.lon };
    const cout = outOf(cin.stay.id);
    const arrivals = legs.filter((l) => near(at, l.arr, HOTEL_NEAR_KM));
    const departures = legs.filter((l) => near(at, l.dep, HOTEL_NEAR_KM));
    // Nothing reaches the hotel's town by its check-in day, yet something does later.
    if (!arrivals.some((l) => compareDays(l.end, cin.when) !== "after")) {
      // Only an arrival INTO the town counts, and only when nothing left the
      // town before it: a night at home before the trip is followed by the
      // way back, which proves nothing about the night.
      const later = arrivals
        .filter(
          (l) =>
            compareDays(l.end, cin.when) === "after" &&
            !near(at, l.dep, HOTEL_NEAR_KM) &&
            !departures.some((d) => d.start.utc < l.start.utc)
        )
        .sort((a, b) => a.end.utc.localeCompare(b.end.utc))[0];
      if (later) add(out, "checkInBeforeArrival", cin, later.ev);
    }
    if (!cout) continue;
    // The traveller left the town during the stay and nothing brought them back by the check-out day.
    if (departures.some((l) => compareDays(l.start, cout.when) === "same")) continue;
    const last = departures
      .filter(
        (l) =>
          compareDays(l.start, cin.when) !== "before" &&
          compareDays(l.start, cout.when) === "before"
      )
      .sort((a, b) => b.start.utc.localeCompare(a.start.utc))[0];
    const cameBack =
      last &&
      arrivals.some(
        (l) => l.start.utc > last.start.utc && compareDays(l.end, cout.when) !== "after"
      );
    if (last && !cameBack) add(out, "checkOutAfterDeparture", cout, last.ev);
  }
}

/**
 * A place visit WITH a time of day that falls strictly between a leg's
 * departure and arrival: the traveller is in the air (or on the train). A visit
 * with only a date says nothing about the minute and abstains (forgejo#432).
 */
function visitFindings(events: TimelineEvent[], legs: Leg[], out: TimelineFinding[]): void {
  for (const ev of events) {
    if (ev.kind !== "place-visit" || !hasExplicitTime(ev.when)) continue;
    for (const leg of legs) {
      if (
        compareClock(leg.start, ev.when, false) === "before" &&
        compareClock(ev.when, leg.end, false) === "before"
      ) {
        add(out, "visitDuringLeg", ev, leg.ev);
      }
    }
  }
}

/**
 * Every finding for one trip's timeline entries. Pure; the entries keep their
 * order. An entry can carry several findings.
 */
export function findTimelineInconsistencies(events: readonly TimelineEvent[]): TimelineFinding[] {
  const list = [...events];
  const legs = list.map(legOf).filter((l): l is Leg => l !== null);
  const out: TimelineFinding[] = [];
  legFindings(legs, out);
  rentalFindings(list, legs, out);
  lodgingFindings(list, legs, out);
  visitFindings(list, legs, out);
  return out;
}

/** The findings grouped by the entry that carries them. */
export function findingsByEvent(
  findings: readonly TimelineFinding[]
): Map<string, TimelineFinding[]> {
  const map = new Map<string, TimelineFinding[]>();
  for (const f of findings) map.set(f.eventId, [...(map.get(f.eventId) ?? []), f]);
  return map;
}
