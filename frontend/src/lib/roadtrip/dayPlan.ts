import { daysBetween } from "../../shared/time";
import { arrivalDay, dayNumber, departureDay, isStayCancelled } from "./roadtripView";
import type { RoadtripStation } from "../../types/roadtrip";
import type { LegMode, LegSource, TourLeg } from "../../types/tour";

/**
 * A roadtrip read day by day (forgejo#243): where the day began, where it
 * ended, what was passed on the way, where the night was — and what is KNOWN
 * about the road between, with where that knowledge comes from.
 *
 * What it does not do is invent. A driving time is a sum only when every
 * piece of the day's route carries one (a routed leg); a single straight line
 * makes the day's time unknown, never an estimate from the crow-flies
 * distance. There is no arrival time at all: nothing stored says when anyone
 * arrived, and a plan computed from straight lines would read as a fact.
 */

export interface DayLegFacts {
  /** Kilometres per source of the line: recorded, routed, hand-drawn, straight. */
  kmBySource: Partial<Record<LegSource, number>>;
  /** Kilometres per mode, for the ferry crossings. */
  kmByMode: Partial<Record<LegMode, number>>;
  totalKm: number;
  /** Null unless every piece of the day's route has a driving time. */
  drivingMinutes: number | null;
  /**
   * True when every piece came from the routing provider. A driving time can
   * also be TYPED on any leg, a straight one included (`PUT …/legs`), and must
   * then not be labelled "berechnet" (review M7).
   */
  drivingRouted: boolean;
  /** A pair of consecutive stations with no stored leg: the distance is incomplete. */
  missingLeg: boolean;
}

export interface DayPlan {
  /** `YYYY-MM-DD`, or null for the stations no date places. */
  day: string | null;
  /** Day N of the trip, or null without a start. */
  number: number | null;
  /** Where the day began: the station before it (the night's, or the trip's first). */
  start: RoadtripStation | null;
  /** Passed on the way, in order. */
  stops: RoadtripStation[];
  destination: RoadtripStation;
  overnight: {
    station: RoadtripStation;
    /** Nights spent there, or null when its departure is not known. */
    nights: number | null;
    cancelled: boolean;
  } | null;
  /** The route from `start` (or the first stop) to `destination`. */
  legs: DayLegFacts | null;
  /** Days spent at the overnight place before the next day of travel. */
  stayOnDays: number;
}

const isVia = (s: RoadtripStation): boolean => s.state === "via";

function factsBetween(
  raw: readonly RoadtripStation[],
  from: number,
  to: number,
  legs: readonly TourLeg[]
): DayLegFacts | null {
  if (to <= from) return null;
  const facts: DayLegFacts = {
    kmBySource: {},
    kmByMode: {},
    totalKm: 0,
    drivingMinutes: 0,
    drivingRouted: true,
    missingLeg: false,
  };
  for (let i = from; i < to; i += 1) {
    const leg = legs.find((l) => l.fromStopId === raw[i].id && l.toStopId === raw[i + 1].id);
    if (!leg) {
      facts.missingLeg = true;
      facts.drivingMinutes = null;
      continue;
    }
    facts.kmBySource[leg.source] = (facts.kmBySource[leg.source] ?? 0) + leg.distanceKm;
    facts.kmByMode[leg.mode] = (facts.kmByMode[leg.mode] ?? 0) + leg.distanceKm;
    facts.totalKm += leg.distanceKm;
    if (leg.source !== "routed") facts.drivingRouted = false;
    facts.drivingMinutes =
      facts.drivingMinutes === null || leg.drivingMinutes === null
        ? null
        : facts.drivingMinutes + leg.drivingMinutes;
  }
  return facts;
}

/**
 * Stations grouped into travel days. An undated station belongs to the day of
 * the next dated one — a pass-through happens on the way to where the day
 * ends; with no dated station after it, it joins the group of stations no date
 * places. Route corrections never show; their legs count into the day.
 */
export function dayPlan(
  stations: readonly RoadtripStation[],
  legs: readonly TourLeg[],
  startDate: string | null
): DayPlan[] {
  const visible = stations.filter((s) => !isVia(s));
  if (visible.length === 0) return [];

  const effective: Array<string | null> = visible.map(() => null);
  let next: string | null = null;
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    const own = arrivalDay(visible[i]);
    if (own !== null) next = own;
    effective[i] = own ?? next;
  }

  const groups: Array<{ day: string | null; members: RoadtripStation[] }> = [];
  visible.forEach((s, i) => {
    const last = groups[groups.length - 1];
    if (last && last.day === effective[i]) last.members.push(s);
    else groups.push({ day: effective[i], members: [s] });
  });

  const rawIndex = new Map(stations.map((s, i) => [s.id, i]));
  return groups.map((group, g) => {
    const previous = g > 0 ? groups[g - 1].members[groups[g - 1].members.length - 1] : null;
    const destination = group.members[group.members.length - 1];
    const sleeps = destination.state === "stay" || destination.state === "free";
    const arrival = arrivalDay(destination);
    const departure = departureDay(destination);
    const nights =
      sleeps && arrival && departure
        ? destination.state === "stay" && destination.stay?.nights != null
          ? destination.stay.nights
          : Math.max(0, daysBetween(arrival, departure))
        : null;
    const nextDay = groups[g + 1]?.day ?? null;
    // The first day begins at its own first station, when it has more than one.
    const start = previous ?? (group.members.length > 1 ? group.members[0] : null);
    const facts = start
      ? factsBetween(stations, rawIndex.get(start.id) ?? 0, rawIndex.get(destination.id) ?? 0, legs)
      : null;
    return {
      day: group.day,
      number: group.day ? dayNumber(startDate, group.day) : null,
      start,
      stops: group.members.filter((m) => m !== start && m !== destination),
      destination,
      overnight: sleeps
        ? { station: destination, nights, cancelled: isStayCancelled(destination) }
        : null,
      legs: facts,
      stayOnDays:
        group.day && nextDay && nextDay > group.day
          ? Math.max(0, daysBetween(group.day, nextDay) - 1)
          : 0,
    };
  });
}
