import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { RailStationInput } from "../../schemas/rail";
import { getCountryResolver, type CountryResolver } from "../geo/countryFromCoordinates";
import { recomputeTripStatus } from "../tripStatusService";
import { readStoredLine } from "./railGeometry";
import { greatCircleKm, mergeRailJourney, withTracedDistance } from "./railJourneyWrite";
import { catalogueStationAt, resolveStationInput } from "./railStations";
import {
  CONVERTED_DEPARTURE_CLOCK,
  planRoadtripRailConversion,
  type RailJourneyDraft,
  type RailStationDraft,
  type RoadtripConversionPlan,
  type RoadtripSectionInput,
} from "./roadtripConversion";

/**
 * Converting a roadtrip section by rail into rail journeys — the WRITE
 * (owner decision 1 of the rail spec). The plan is `roadtripConversion.ts`;
 * this loads the section, writes each ride through the rail write rules
 * (station matching, zones, instants, distance, status) and removes the
 * section only when the caller says the user confirmed it.
 *
 * Idempotent: each ride carries `externalRef = roadtrip:<section>:<leg>`,
 * unique per user, so a second run writes nothing twice — whether the first
 * one kept the section or a double click sent the request twice.
 */

/** The section, owned by `userId` and of kind `roadtrip`, as the plan reads it. */
async function loadSection(userId: string, routeId: string): Promise<RoadtripSectionInput> {
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, userId, kind: "roadtrip" },
    select: {
      id: true,
      userId: true,
      tripId: true,
      name: true,
      notes: true,
      vehicle: true,
      vehicleName: true,
      stops: {
        orderBy: { routeOrderIdx: "asc" },
        select: {
          id: true,
          title: true,
          lat: true,
          lon: true,
          startDate: true,
          endDate: true,
          lodgingStay: { select: { checkIn: true, checkOut: true } },
        },
      },
      legs: {
        select: {
          id: true,
          fromStopId: true,
          toStopId: true,
          distanceKm: true,
          source: true,
          waypoints: true,
        },
      },
    },
  });
  // Another account's section answers exactly like a missing one.
  if (!route) throw new AppError("Roadtrip not found", 404);
  if (route.vehicle !== "rail") throw new AppError("This roadtrip is not by rail", 409);
  return {
    ...route,
    // A station's day is its own date, else its linked stay's — the same
    // fallback the roadtrip span uses.
    stops: route.stops.map(({ lodgingStay, ...stop }) => ({
      ...stop,
      startDate: stop.startDate ?? lodgingStay?.checkIn ?? null,
      endDate: stop.endDate ?? lodgingStay?.checkOut ?? null,
    })),
    legs: route.legs.map((leg) => ({ ...leg, waypoints: readStoredLine(leg.waypoints) })),
  };
}

async function convertedRefs(userId: string, plan: RoadtripConversionPlan) {
  const rows = await prisma.railJourney.findMany({
    where: { userId, externalRef: { in: plan.journeys.map((j) => j.externalRef) } },
    select: { id: true, externalRef: true },
  });
  return new Map(rows.map((r) => [r.externalRef as string, r.id]));
}

/** Removal is offered only when every leg became a ride and there was one. */
function removable(plan: RoadtripConversionPlan): boolean {
  return plan.skipped.length === 0 && plan.journeys.length > 0;
}

export interface ConversionPreview {
  routeId: string;
  name: string;
  rides: Array<{
    legId: string;
    departureStationName: string;
    arrivalStationName: string;
    departureDay: string;
    distanceKm: number;
    journeyId: string | null;
  }>;
  skipped: RoadtripConversionPlan["skipped"];
  canRemoveSection: boolean;
}

export async function previewRoadtripConversion(
  userId: string,
  routeId: string
): Promise<ConversionPreview> {
  const section = await loadSection(userId, routeId);
  const plan = planRoadtripRailConversion(section);
  const done = await convertedRefs(userId, plan);
  return {
    routeId: section.id,
    name: section.name,
    rides: plan.journeys.map((j) => ({
      legId: j.legId,
      departureStationName: j.departureStation.name,
      arrivalStationName: j.arrivalStation.name,
      departureDay: j.departureDay,
      distanceKm:
        j.tracedKm ??
        greatCircleKm({
          depLat: j.departureStation.lat,
          depLon: j.departureStation.lon,
          arrLat: j.arrivalStation.lat,
          arrLon: j.arrivalStation.lon,
        }),
      journeyId: done.get(j.externalRef) ?? null,
    })),
    skipped: plan.skipped,
    canRemoveSection: removable(plan),
  };
}

/**
 * A station as the rail write path takes it: the catalogue row within 300 m
 * when there is one (its code and country), else the stop's own position with
 * the country its coordinates lie in — or none, never a guess.
 */
async function stationInput(
  draft: RailStationDraft,
  countryAt: CountryResolver
): Promise<RailStationInput> {
  const hit = await catalogueStationAt(draft.lat, draft.lon);
  if (hit) return resolveStationInput({ ...draft, code: null, stationId: hit.id });
  return {
    ...draft,
    code: null,
    stationId: null,
    country: countryAt.countryAt(draft.lat, draft.lon),
  };
}

async function journeyData(
  userId: string,
  draft: RailJourneyDraft,
  countryAt: CountryResolver
): Promise<Prisma.RailJourneyUncheckedCreateInput> {
  const merged = mergeRailJourney(null, {
    departureStation: await stationInput(draft.departureStation, countryAt),
    arrivalStation: await stationInput(draft.arrivalStation, countryAt),
    departureLocal: `${draft.departureDay}T${CONVERTED_DEPARTURE_CLOCK}`,
  });
  return {
    ...withTracedDistance(merged, draft.tracedKm),
    userId,
    tripId: draft.tripId,
    operator: draft.operator,
    notes: draft.notes,
    externalRef: draft.externalRef,
    geometry:
      draft.geometry === null
        ? Prisma.DbNull
        : (draft.geometry as unknown as Prisma.InputJsonValue),
    geometrySource: draft.geometrySource,
  };
}

export interface ConversionResult {
  created: number;
  alreadyConverted: number;
  journeyIds: string[];
  skipped: RoadtripConversionPlan["skipped"];
  sectionRemoved: boolean;
}

export async function convertRoadtripToRail(
  userId: string,
  routeId: string,
  options: { removeSection: boolean }
): Promise<ConversionResult> {
  const section = await loadSection(userId, routeId);
  const plan = planRoadtripRailConversion(section);
  // Removing a section some of whose legs did not become rides would lose
  // them; the section stays until every leg converts.
  if (options.removeSection && !removable(plan)) {
    throw new AppError("Not every leg can be converted, so the roadtrip stays", 409);
  }
  const done = await convertedRefs(userId, plan);
  const fresh = plan.journeys.filter((j) => !done.has(j.externalRef));
  const countryAt = await getCountryResolver();
  const rows = await Promise.all(fresh.map((j) => journeyData(userId, j, countryAt)));

  const created = await prisma.$transaction(async (tx) => {
    // `skipDuplicates` on the per-user externalRef: a concurrent second
    // request writes nothing twice rather than failing.
    const { count } = await tx.railJourney.createMany({ data: rows, skipDuplicates: true });
    if (options.removeSection) {
      // As the tour delete does it: a stop borrowed from a trip's timeline
      // goes back to the trip, the section's own stops go with it.
      await tx.tripStop.updateMany({
        where: { routeId: section.id, tripId: { not: null } },
        data: { routeId: null, routeOrderIdx: null, lodgingStayId: null, overnight: false },
      });
      await tx.tripRoute.delete({ where: { id: section.id } });
    }
    return count;
  });

  if (section.tripId) await recomputeTripStatus(section.tripId);
  const ids = await convertedRefs(userId, plan);
  return {
    created,
    alreadyConverted: plan.journeys.length - created,
    journeyIds: plan.journeys.map((j) => ids.get(j.externalRef)).filter(Boolean) as string[],
    skipped: plan.skipped,
    sectionRemoved: options.removeSection,
  };
}
