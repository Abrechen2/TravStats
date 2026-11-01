import { prisma } from "../../db";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { countableBusWhere } from "../../shared/busCounting";
import { countableFerryWhere } from "../../shared/ferryCounting";
import { countableRentalWhere } from "../../shared/rentalCounting";
import { COUNTABLE_RAIL_STATUSES } from "../../shared/railCounting";
import {
  busCo2,
  cruiseCo2,
  ferryCo2,
  railCo2,
  rentalCo2,
  type Co2Estimate,
  type Co2Mode,
} from "./transportCo2";

/**
 * The records each mode's CO2 figure stands on (forgejo#395), with their
 * estimate. The population is the mode's own counting rule — completed rides,
 * sailed cruises, finished rentals — so a tile, the evidence list under it and
 * a ride's own page cannot disagree about what counts. Rail takes EVERY transit
 * mode here (a tram or metro ride is not a train ride in the rail figures, but
 * it does emit), broken out by `factor` in the stats.
 *
 * `estimate` is null where the mode abstains (no distance, an electric car):
 * the record stays in the population so the stats can report the coverage.
 */
export interface Co2Item<R> {
  row: R;
  estimate: Co2Estimate | null;
}

/** Optional trip filter: the same population, cut to one trip. */
const tripScope = (tripId: string | undefined): { tripId?: string } =>
  tripId === undefined ? {} : { tripId };

const withEstimate = <R>(rows: R[], estimate: (row: R) => Co2Estimate | null): Co2Item<R>[] =>
  rows.map((row) => ({ row, estimate: estimate(row) }));

export async function loadRailCo2Items(userId: string, tripId?: string) {
  const rows = await prisma.railJourney.findMany({
    where: { userId, ...tripScope(tripId), status: { in: [...COUNTABLE_RAIL_STATUSES] } },
    select: {
      id: true,
      trainCategory: true,
      trainNumber: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      distanceKm: true,
      transitMode: true,
    },
  });
  return withEstimate(rows, railCo2);
}

export async function loadBusCo2Items(userId: string, tripId?: string) {
  const rows = await prisma.busJourney.findMany({
    where: { userId, ...tripScope(tripId), ...countableBusWhere() },
    select: {
      id: true,
      operator: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      distanceKm: true,
      rideKind: true,
    },
  });
  return withEstimate(rows, busCo2);
}

export async function loadFerryCo2Items(userId: string, tripId?: string) {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, ...tripScope(tripId), ...countableFerryWhere() },
    select: {
      id: true,
      operator: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      distanceKm: true,
      vehicleType: true,
      vehicleRegistration: true,
    },
  });
  return withEstimate(rows, ferryCo2);
}

export async function loadRentalCo2Items(userId: string, tripId?: string) {
  const rows = await prisma.rentalBooking.findMany({
    where: { userId, ...tripScope(tripId), ...countableRentalWhere() },
    select: {
      id: true,
      provider: true,
      pickupStationName: true,
      returnStationName: true,
      pickupTime: true,
      pickupTimezone: true,
      acrissCode: true,
      distanceKm: true,
      distanceSource: true,
      odometerOutKm: true,
      odometerInKm: true,
    },
  });
  return withEstimate(rows, rentalCo2);
}

export async function loadCruiseCo2Items(userId: string, tripId?: string) {
  const rows = await prisma.cruise.findMany({
    where: { userId, ...tripScope(tripId), ...countableCruiseWhere() },
    select: {
      id: true,
      routeName: true,
      shipNameOverride: true,
      cruiseLine: true,
      startDate: true,
      ship: { select: { name: true } },
      legs: { select: { distanceKm: true } },
    },
  });
  return withEstimate(rows, (c) => cruiseCo2(c.legs.map((l) => l.distanceKm))).map((item) => ({
    ...item,
    row: {
      id: item.row.id,
      startDate: item.row.startDate,
      label:
        item.row.routeName ??
        item.row.shipNameOverride ??
        item.row.ship?.name ??
        item.row.cruiseLine ??
        "—",
    },
  }));
}

export type RailCo2Item = Awaited<ReturnType<typeof loadRailCo2Items>>[number];
export type BusCo2Item = Awaited<ReturnType<typeof loadBusCo2Items>>[number];
export type FerryCo2Item = Awaited<ReturnType<typeof loadFerryCo2Items>>[number];
export type RentalCo2Item = Awaited<ReturnType<typeof loadRentalCo2Items>>[number];
export type CruiseCo2Item = Awaited<ReturnType<typeof loadCruiseCo2Items>>[number];

export type { Co2Mode };
