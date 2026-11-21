import { formatTimeValueShown } from "./displayFormat";
import { clockOf, dayOf, type LocalDateValue, type TimeValue } from "../shared/time";

/**
 * Date + time handling for the trip timeline (#175), on the time model of
 * ADR 0002.
 *
 * Every entry carries its time as a `TimeValue` (see `lib/entityTimes.ts`):
 * `local` is the wall clock at the place — "we were at the Louvre at 14:00"
 * means 14:00 in Paris — and `utc` is the instant. The timeline SHOWS `local`
 * and GROUPS by the day in `local`; it uses `utc` only to order entries that
 * share a day. Grouping by the UTC day was the bug this replaced: a flight
 * leaving Haneda at 01:00 on 1 August sat under 31 July, because it was still
 * the 31st in UTC. No reader's zone takes part anywhere — a browser in
 * Kiritimati and one in Honolulu show the same page.
 *
 * A value of precision `day` (a stay, a journal day, a stop without a time)
 * has no clock; `hasExplicitTime` is how the ordering tells.
 */

/** A day-only value (a stay night, a journal day) as a `TimeValue` of precision `day`. */
export function dayAsTimeValue(day: LocalDateValue): TimeValue {
  return {
    utc: `${day.date}T00:00:00.000Z`,
    zone: day.zone,
    offset: "",
    local: `${day.date}T00:00:00`,
    precision: "day",
  };
}

/**
 * The two form inputs (`YYYY-MM-DD`, `HH:mm`) for a stored value, on the
 * place's clock. An absent time of day is an empty field, not "00:00".
 */
export function splitTimeValue(value: TimeValue | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  return { date: dayOf(value), time: clockOf(value) ?? "" };
}

/** True when the value carries a time of day. */
export function hasExplicitTime(value: TimeValue): boolean {
  return clockOf(value) !== null;
}

/**
 * "01.05.2026" or "01.05.2026 14:30" in the user's format, on the place's
 * clock — the value's own `local`, never the reader's zone.
 */
export function formatTimelineDate(value: TimeValue): string {
  return formatTimeValueShown(value);
}

/** The kinds the timeline sorts, as far as ordering cares. */
export interface SortableEvent {
  when: TimeValue;
  kind: string;
  /** Where the entry ends, for a leg that arrives somewhere (flight, rail, bus, ferry). */
  end?: TimeValue | null;
  /** The stay a check-in/out belongs to, so a stay's two ends keep their order. */
  stay?: { id: string };
}

/** Entries that LEAVE a place at `when`: a lodging check-out comes before them. */
const DEPARTURE_KINDS = new Set(["flight", "rail", "bus", "ferry", "rental-pickup", "cruise"]);

/** The instants a day's travel starts and ends, per place-local day. */
interface DayTravel {
  firstDeparture: Map<string, number>;
  lastArrival: Map<string, number>;
}

function instantOf(value: TimeValue): number {
  return Date.parse(value.utc);
}

/**
 * What a day's check-outs and check-ins have to respect (forgejo, owner
 * 2026-11-21: "Hotel vor Hinflug"). A stay's check-in/out TIME is almost
 * always the booking's nominal 11:00/15:00, not when the traveller really left
 * or arrived — measured on a real account, 11 check-outs at 11:00 sat below a
 * flight that left at 10:35. Travel is the hard evidence of the day, so a
 * nominal lodging time yields to it.
 */
function dayTravel(events: ReadonlyArray<SortableEvent>): DayTravel {
  const firstDeparture = new Map<string, number>();
  const lastArrival = new Map<string, number>();
  const note = (map: Map<string, number>, day: string, t: number, pick: typeof Math.min) => {
    if (Number.isNaN(t)) return;
    const seen = map.get(day);
    map.set(day, seen === undefined ? t : pick(seen, t));
  };
  for (const ev of events) {
    // A departure without a clock says nothing about WHEN — it must not drag a
    // known hotel time or a timed entry around.
    if (DEPARTURE_KINDS.has(ev.kind) && hasExplicitTime(ev.when)) {
      note(firstDeparture, dayOf(ev.when), instantOf(ev.when), Math.min);
    }
    // A rental return is an arrival at its own moment; a leg arrives at its end.
    const arrival = ev.kind === "rental-return" ? ev.when : ev.end;
    if (arrival && hasExplicitTime(arrival)) {
      note(lastArrival, dayOf(arrival), instantOf(arrival), Math.max);
    }
  }
  return { firstDeparture, lastArrival };
}

interface SortKey {
  day: string;
  cls: number;
  instant: number;
  sub: number;
}

/**
 * Where an event sits within its day when it carries NO time of day.
 *
 * A day-only value would otherwise sort as 00:00, the EARLIEST moment of the
 * day. That put a hotel check-in above the flight that landed at 07:45 and
 * brought the traveller there, on the owner's Madagascar trip. Every lodging
 * stay is day-only, so the misordering was general, not one bad row.
 *
 * A day without recorded times still has a shape: you leave the hotel, you
 * travel, you arrive somewhere and check in, and you write the day up at its
 * end. That shape is what these ranks encode — and only for events whose time
 * is genuinely unknown. A time that IS known keeps its place in the clock
 * order; the rank is a fallback for missing information.
 */
function dayRank(ev: SortableEvent): number {
  if (ev.kind === "journal") return 3; // always the day's last word — #175
  if (hasExplicitTime(ev.when)) return 1;
  // A note dated to the day only is written about the day, like a diary entry.
  if (ev.kind === "note") return 3;
  if (ev.kind === "lodging-checkout") return 0; // you leave before you travel
  if (ev.kind === "lodging-checkin") return 2; // you arrive before you settle
  return 1;
}

/** Tie order at one instant: leave, then everything else, then settle in. */
function subRank(ev: SortableEvent): number {
  if (ev.kind === "lodging-checkout") return 0;
  if (ev.kind === "lodging-checkin") return 2;
  return 1;
}

function keyOf(ev: SortableEvent, travel?: DayTravel): SortKey {
  const day = dayOf(ev.when);
  let instant = instantOf(ev.when);
  if (Number.isNaN(instant)) instant = 0;
  // A TIMED lodging time is still only nominal against travel the same day:
  // the check-out cannot be later than the first departure, the check-in not
  // earlier than the last arrival (an overnight leg counts on its arrival day).
  if (travel && hasExplicitTime(ev.when)) {
    if (ev.kind === "lodging-checkout") {
      instant = Math.min(instant, travel.firstDeparture.get(day) ?? instant);
    } else if (ev.kind === "lodging-checkin") {
      instant = Math.max(instant, travel.lastArrival.get(day) ?? instant);
    }
  }
  return { day, cls: dayRank(ev), instant, sub: subRank(ev) };
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.cls !== b.cls) return a.cls - b.cls;
  if (a.instant !== b.instant) return a.instant - b.instant;
  return a.sub - b.sub;
}

/**
 * Chronological order: by the day AT THE PLACE first, then within a day by
 * deliberate tie-breaks.
 *
 * 1. A DIARY entry sorts after everything else on the same day — Alex's
 *    request (#175): "Diary entries should always be the last entry of a day".
 * 2. A time-less check-in or check-out is placed by `dayRank` rather than by
 *    a made-up midnight — see there for why.
 * 3. Otherwise the instants decide (`utc` is the one thing that orders two
 *    clocks in different zones), and ties keep their original relative order
 *    (the comparator returns 0 and Array.prototype.sort is stable), so two
 *    stops entered for the same time stay in the order the backend returned.
 *    At the very same instant a check-out comes first and a check-in last.
 *
 * Across days the place's day decides, so a check-in on the 1st can never be
 * dragged past anything on the 2nd, and a flight that leaves on the 1st is on
 * the 1st.
 *
 * This pairwise form cannot know the day's travel; `sortTimelineEvents` is the
 * one that lets a nominal lodging time yield to it.
 */
export function compareTimelineEvents(a: SortableEvent, b: SortableEvent): number {
  return compareKeys(keyOf(a), keyOf(b));
}

/**
 * The timeline's order: `compareTimelineEvents`, plus — on one place-local day
 * — a timed lodging check-out sorts before every departure of that day and a
 * timed check-in after every arrival, whatever nominal time the booking says.
 * Keys are computed once, so the order stays a total order.
 */
export function sortTimelineEvents<T extends SortableEvent>(events: ReadonlyArray<T>): T[] {
  const travel = dayTravel(events);
  const keyed = events.map((ev) => ({ ev, key: keyOf(ev, travel), own: keyOf(ev) }));
  // A day-room (check-in and check-out on one day) clamped by travel at both
  // ends could turn inside out; such a stay keeps its own nominal times.
  const byStay = new Map<string, typeof keyed>();
  for (const k of keyed) {
    if (!k.ev.stay) continue;
    byStay.set(k.ev.stay.id, [...(byStay.get(k.ev.stay.id) ?? []), k]);
  }
  for (const ends of byStay.values()) {
    const inn = ends.find((k) => k.ev.kind === "lodging-checkin");
    const out = ends.find((k) => k.ev.kind === "lodging-checkout");
    if (inn && out && inn.key.day === out.key.day && out.key.instant < inn.key.instant) {
      inn.key = inn.own;
      out.key = out.own;
    }
  }
  return keyed.sort((x, y) => compareKeys(x.key, y.key)).map((x) => x.ev);
}
/**
 * Whether a `TripStop` has already been replaced by a `PlaceVisit` and must
 * therefore NOT be drawn — otherwise the migrated POI appears twice.
 *
 * The POI backfill (`20260823150500_poi_backfill_from_trip_stops`) is the
 * EXPAND half of an expand/contract pair: it copies every qualifying
 * `domain='poi'` stop into Place + PlaceVisit and deliberately leaves the
 * original rows in place, so a bad backfill stays recoverable. The DELETE
 * ships a release later. Between those two releases both rows exist, and
 * something has to decide which one the timeline shows.
 *
 * The rule mirrors the migration's own WHERE clause exactly, which is what
 * makes it correct rather than approximate: a POI stop was migrated **if and
 * only if** it had both coordinates. Coordinate-less POI stops were neither
 * migrated nor deleted — `places.lat/lon` is NOT NULL and deleting the user's
 * text to satisfy a schema was not acceptable — so those keep rendering as
 * ordinary stops, which is exactly what this returns.
 *
 * Once the contract migration has run this becomes a no-op rather than a lie:
 * there will be no `domain='poi'` stops left with coordinates. Delete it then,
 * together with the audit table.
 */
export function isSupersededByPlaceVisit(stop: {
  domain?: string | null;
  lat?: number | null;
  lon?: number | null;
}): boolean {
  return (
    stop.domain === "poi" &&
    stop.lat !== null &&
    stop.lat !== undefined &&
    stop.lon !== null &&
    stop.lon !== undefined
  );
}
