/**
 * Converting a roadtrip section "by rail" into rail journeys — the CONTRACT
 * (spec 2026-09-25-rail-domain, owner decision 1; phase 2b item 7).
 *
 * The roadtrip code (`TripRoute.kind = 'roadtrip'`, `vehicle`, its stops and
 * legs) lives on main and is NOT on this branch, which has not merged main
 * yet. So this file states what the conversion takes and gives, and maps it —
 * purely, no database, no route — against STRUCTURAL input types that mirror
 * main's `TripRoute` / `TripStop` / `TripRouteLeg` columns by name. When this
 * branch merges main:
 *
 *  1. `rail` leaves `ROADTRIP_VEHICLES` (`shared/tour/roadtrip.ts`), so no new
 *     section can be "by rail";
 *  2. the input types below are replaced by the Prisma ones (the names match);
 *  3. an endpoint offers the conversion for each existing `vehicle = 'rail'`
 *     section, writes the drafts through the rail router's own write path
 *     (`mergeRailJourney`, station matching, FX, status), and deletes the
 *     section only after every journey was written — one transaction, one way.
 *
 * The rules, each an instance of the project's abstention rule:
 *
 *  - One LEG becomes one journey: the leg's from-stop is the boarding station,
 *    its to-stop the one left. A section is a route, a journey is a ticket
 *    (owner decision 2), so a three-stop section is two rides, not one.
 *  - A ride needs a departure instant and positions for both stations. A leg
 *    whose stops lack either is reported as skipped, with the reason — never
 *    given an invented time or a (0, 0) station.
 *  - A stop's dates are DAYS (the roadtrip stores dates, not clock times), so
 *    a converted ride starts at noon UTC of that day and says so in its notes;
 *    the user corrects the time from the ticket. Arrival is left null unless
 *    the to-stop names a day, because a guessed length would feed the hours
 *    statistic.
 *  - The leg's line and distance carry over only where the leg was routed or
 *    drawn; a straight leg becomes a straight ride with a great-circle figure,
 *    exactly what a ride logged by hand without a traced line has.
 */

/** Mirrors main's `TripStop` columns the conversion reads. */
export interface RoadtripStopInput {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  /** A DAY: main stores roadtrip dates without a clock time. */
  startDate: Date | null;
  endDate: Date | null;
}

/** Mirrors main's `TripRouteLeg` columns the conversion reads. */
export interface RoadtripLegInput {
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  /** straight | drawn | routed | track */
  source: string;
  /** `[[lon, lat], …]`, null for a straight leg. */
  waypoints: [number, number][] | null;
}

/** Mirrors main's `TripRoute` (kind `roadtrip`) with its stops and legs. */
export interface RoadtripSectionInput {
  id: string;
  userId: string;
  tripId: string | null;
  name: string;
  notes: string | null;
  vehicle: string | null;
  vehicleName: string | null;
  /** In route order. */
  stops: RoadtripStopInput[];
  legs: RoadtripLegInput[];
}

/** The fields a converted journey is written with — a subset of `RailJourney`. */
export interface RailJourneyDraft {
  userId: string;
  tripId: string | null;
  operator: string | null;
  depStationName: string;
  depLat: number;
  depLon: number;
  arrStationName: string;
  arrLat: number;
  arrLon: number;
  departureTime: Date;
  arrivalTime: Date | null;
  distanceKm: number | null;
  distanceSource: "great_circle" | "route" | null;
  geometry: [number, number][] | null;
  geometrySource: "straight" | "manual";
  notes: string;
  tags: string[];
}

export type SkipReason = "notRail" | "stopMissing" | "noPosition" | "noDate";

export interface RoadtripConversionPlan {
  journeys: RailJourneyDraft[];
  skipped: Array<{ fromStopId: string; toStopId: string; reason: SkipReason }>;
}

/** Noon UTC of a stored day: the middle of the day on every European clock. */
function noonOf(day: Date): Date {
  return new Date(`${day.toISOString().slice(0, 10)}T12:00:00.000Z`);
}

function hasPosition(
  stop: RoadtripStopInput
): stop is RoadtripStopInput & { lat: number; lon: number } {
  return stop.lat !== null && stop.lon !== null;
}

/**
 * Plan the conversion of one section. Pure: the caller writes the drafts.
 * A section that is not "by rail" yields nothing and one `notRail` entry per
 * leg, so a caller that passes the wrong section cannot convert it by accident.
 */
export function planRoadtripRailConversion(section: RoadtripSectionInput): RoadtripConversionPlan {
  const plan: RoadtripConversionPlan = { journeys: [], skipped: [] };
  const byId = new Map(section.stops.map((s) => [s.id, s]));
  for (const leg of section.legs) {
    const skip = (reason: SkipReason): void => {
      plan.skipped.push({ fromStopId: leg.fromStopId, toStopId: leg.toStopId, reason });
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
      userId: section.userId,
      tripId: section.tripId,
      operator: section.vehicleName?.trim() || null,
      depStationName: from.title,
      depLat: from.lat,
      depLon: from.lon,
      arrStationName: to.title,
      arrLat: to.lat,
      arrLon: to.lon,
      departureTime: noonOf(departureDay),
      arrivalTime: to.startDate ? noonOf(to.startDate) : null,
      distanceKm: leg.distanceKm,
      distanceSource: traced ? "route" : "great_circle",
      geometry: traced ? leg.waypoints : null,
      geometrySource: traced ? "manual" : "straight",
      notes: [
        `Converted from the roadtrip section "${section.name}". Times are placeholders at noon UTC of the day — correct them from the ticket.`,
        section.notes,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tags: [],
    });
  }
  return plan;
}
