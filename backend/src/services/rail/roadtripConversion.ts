/**
 * Converting a roadtrip section "by rail" into rail journeys — the PLAN
 * (spec 2026-09-25-rail-domain, owner decision 1). Pure: no database, no
 * route. `roadtripConversionWrite.ts` loads the section, writes the plan
 * through the rail write rules and, only when the user confirms it, removes
 * the section.
 *
 * `rail` left `ROADTRIP_VEHICLES` when this branch merged main, so no new
 * section can be "by rail"; this converts the ones stored before.
 *
 * The rules, each an instance of the project's abstention rule:
 *
 *  - One LEG becomes one journey: the leg's from-stop is the boarding station,
 *    its to-stop the one left. A section is a route, a journey is a ticket
 *    (owner decision 2), so a three-stop section is two rides, not one.
 *  - A ride needs a departure day and positions for both stations. A leg
 *    whose stops lack either is reported as skipped, with the reason — never
 *    given an invented day or a (0, 0) station.
 *  - A stop's dates are DAYS (the roadtrip stores dates, not clock times), so
 *    a converted ride leaves at noon on its boarding station's clock and its
 *    notes say so; the user corrects the time from the ticket. The arrival is
 *    left unknown: a day-only arrival would put the length of the ride at
 *    zero or at whole days, and either would feed the hours-on-board figure
 *    with a number nobody measured.
 *  - The leg's line and distance carry over only where the leg was routed or
 *    drawn; a straight leg becomes a straight ride with a great-circle figure,
 *    exactly what a ride logged by hand without a traced line has.
 *  - Every ride carries `externalRef = roadtrip:<section>:<leg>`, unique per
 *    user, so converting the same section twice writes each ride once.
 */

import type { TripRouteLeg, TripStop } from "../../prisma";

/** A stop as the conversion reads it; the dates are its effective DAYS. */
export type RoadtripStopInput = Pick<TripStop, "id" | "title" | "lat" | "lon"> & {
  startDate: Date | null;
  endDate: Date | null;
};

/** A leg as the conversion reads it; `waypoints` is the stored line, parsed. */
export type RoadtripLegInput = Pick<
  TripRouteLeg,
  "id" | "fromStopId" | "toStopId" | "distanceKm" | "source"
> & {
  /** `[[lon, lat], …]`, null for a straight leg. */
  waypoints: [number, number][] | null;
};

/** A `TripRoute` of kind `roadtrip` with its stops (in route order) and legs. */
export interface RoadtripSectionInput {
  id: string;
  userId: string;
  tripId: string | null;
  name: string;
  notes: string | null;
  vehicle: string | null;
  vehicleName: string | null;
  stops: RoadtripStopInput[];
  legs: RoadtripLegInput[];
}

export interface RailStationDraft {
  name: string;
  lat: number;
  lon: number;
}

/** One ride as the plan proposes it — what the write turns into a `RailJourney`. */
export interface RailJourneyDraft {
  /** The import key: `roadtrip:<routeId>:<legId>`. */
  externalRef: string;
  legId: string;
  tripId: string | null;
  operator: string | null;
  departureStation: RailStationDraft;
  arrivalStation: RailStationDraft;
  /** `YYYY-MM-DD`; the ride leaves at noon of it on the boarding station's clock. */
  departureDay: string;
  /** The leg's own length, carried only for a routed or drawn leg. */
  tracedKm: number | null;
  geometry: [number, number][] | null;
  geometrySource: "straight" | "manual";
  notes: string;
}

export type SkipReason = "notRail" | "stopMissing" | "noPosition" | "noDate";

export interface RoadtripConversionPlan {
  journeys: RailJourneyDraft[];
  skipped: Array<{ legId: string; fromStopId: string; toStopId: string; reason: SkipReason }>;
}

/** The wall-clock time a converted ride leaves at: noon, the middle of any day. */
export const CONVERTED_DEPARTURE_CLOCK = "12:00";

export function conversionRef(routeId: string, legId: string): string {
  return `roadtrip:${routeId}:${legId}`;
}

function hasPosition(
  stop: RoadtripStopInput
): stop is RoadtripStopInput & { lat: number; lon: number } {
  return stop.lat !== null && stop.lon !== null;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Plan the conversion of one section. A section that is not "by rail" yields
 * nothing and one `notRail` entry per leg, so a caller that passes the wrong
 * section cannot convert it by accident.
 */
export function planRoadtripRailConversion(section: RoadtripSectionInput): RoadtripConversionPlan {
  const plan: RoadtripConversionPlan = { journeys: [], skipped: [] };
  const byId = new Map(section.stops.map((s) => [s.id, s]));
  const order = new Map(section.stops.map((s, i) => [s.id, i]));
  // Legs in route order, so the rides come out in the order they were taken.
  const legs = [...section.legs].sort(
    (a, b) => (order.get(a.fromStopId) ?? 0) - (order.get(b.fromStopId) ?? 0)
  );
  for (const leg of legs) {
    const skip = (reason: SkipReason): void => {
      plan.skipped.push({
        legId: leg.id,
        fromStopId: leg.fromStopId,
        toStopId: leg.toStopId,
        reason,
      });
    };
    if (section.vehicle !== "rail") {
      skip("notRail");
      continue;
    }
    const from = byId.get(leg.fromStopId);
    const to = byId.get(leg.toStopId);
    if (!from || !to) {
      skip("stopMissing");
      continue;
    }
    if (!hasPosition(from) || !hasPosition(to)) {
      skip("noPosition");
      continue;
    }
    const departureDay = from.endDate ?? from.startDate;
    if (!departureDay) {
      skip("noDate");
      continue;
    }
    const traced = leg.source !== "straight" && leg.waypoints !== null;
    plan.journeys.push({
      externalRef: conversionRef(section.id, leg.id),
      legId: leg.id,
      tripId: section.tripId,
      operator: section.vehicleName?.trim() || null,
      departureStation: { name: from.title, lat: from.lat, lon: from.lon },
      arrivalStation: { name: to.title, lat: to.lat, lon: to.lon },
      departureDay: dayOf(departureDay),
      tracedKm: traced ? leg.distanceKm : null,
      geometry: traced ? leg.waypoints : null,
      geometrySource: traced ? "manual" : "straight",
      notes: [
        `Converted from the roadtrip section "${section.name}". The departure is a placeholder at noon on the station's clock and the arrival is not known — correct both from the ticket.`,
        section.notes,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  }
  return plan;
}
