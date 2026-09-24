import { countRoadtripNights, stationState, type RoadtripNights } from "../../shared/tour/roadtrip";
import { drivenKm, travelledKm } from "../tour/tourDistance";

/**
 * What a roadtrip page and list say about one roadtrip, derived from rows the
 * engine already holds. Nothing here is stored: a figure the stations and
 * legs can answer is never a column that could disagree with them.
 */

/** The stay fields a station needs to show and count its night. */
export const STATION_STAY_SELECT = {
  id: true,
  lodgingId: true,
  checkIn: true,
  checkOut: true,
  datePrecision: true,
  nights: true,
  status: true,
  lodging: { select: { id: true, name: true, type: true, city: true, country: true } },
} as const;

export const STATION_SELECT = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  startDate: true,
  endDate: true,
  notes: true,
  routeOrderIdx: true,
  overnight: true,
  lodgingStayId: true,
  lodgingStay: { select: STATION_STAY_SELECT },
} as const;

export interface StationRow {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  notes: string | null;
  routeOrderIdx: number | null;
  overnight: boolean;
  lodgingStayId: string | null;
  lodgingStay: {
    id: string;
    lodgingId: string;
    checkIn: Date | null;
    checkOut: Date | null;
    datePrecision: string;
    nights: number | null;
    status: string;
    lodging: {
      id: string;
      name: string;
      type: string;
      city: string | null;
      country: string | null;
    };
  } | null;
}

export function nightsOf(stations: readonly StationRow[]): RoadtripNights {
  return countRoadtripNights(
    stations.map((s) => ({
      lodgingStayId: s.lodgingStayId,
      overnight: s.overnight,
      startDate: s.startDate,
      endDate: s.endDate,
      stay: s.lodgingStay
        ? {
            checkIn: s.lodgingStay.checkIn,
            checkOut: s.lodgingStay.checkOut,
            datePrecision: s.lodgingStay.datePrecision,
            nights: s.lodgingStay.nights,
          }
        : null,
    }))
  );
}

/**
 * The span a roadtrip covers: earliest station start (or linked check-in)
 * to latest station end (or check-out). Null ends abstain.
 */
export function spanOf(stations: readonly StationRow[]): {
  startDate: string | null;
  endDate: string | null;
} {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const s of stations) {
    const from = s.startDate ?? s.lodgingStay?.checkIn ?? null;
    const to = s.endDate ?? s.lodgingStay?.checkOut ?? from;
    if (from && (!start || from < start)) start = from;
    if (to && (!end || to > end)) end = to;
  }
  return { startDate: start?.toISOString() ?? null, endDate: end?.toISOString() ?? null };
}

export function toStationDto(s: StationRow): Record<string, unknown> {
  const stay = s.lodgingStay;
  return {
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    startDate: s.startDate,
    endDate: s.endDate,
    notes: s.notes,
    order: s.routeOrderIdx,
    state: stationState(s),
    lodgingStayId: s.lodgingStayId,
    stay: stay
      ? {
          id: stay.id,
          lodgingId: stay.lodgingId,
          lodgingName: stay.lodging.name,
          lodgingType: stay.lodging.type,
          city: stay.lodging.city,
          country: stay.lodging.country,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          nights: stay.nights,
          status: stay.status,
        }
      : null,
  };
}

export interface RoadtripListRow {
  id: string;
  tripId: string | null;
  name: string;
  mode: string;
  color: string | null;
  vehicle: string | null;
  vehicleName: string | null;
  kindAssignedAutomatically: boolean;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  trip: { name: string } | null;
  legs: Array<{ mode: string; distanceKm: number }>;
  stops: StationRow[];
  _count: { tracks: number };
}

export function toRoadtripSummary(
  row: RoadtripListRow,
  tourCount: number
): Record<string, unknown> {
  const nights = nightsOf(row.stops);
  return {
    id: row.id,
    kind: "roadtrip",
    tripId: row.tripId,
    tripName: row.trip?.name ?? null,
    name: row.name,
    mode: row.mode,
    color: row.color,
    vehicle: row.vehicle,
    vehicleName: row.vehicleName,
    kindAssignedAutomatically: row.kindAssignedAutomatically,
    ...spanOf(row.stops),
    distanceKm: travelledKm(row.legs),
    drivenKm: drivenKm(row.legs),
    startOdometerKm: row.startOdometerKm,
    endOdometerKm: row.endOdometerKm,
    stationCount: row.stops.length,
    nights: nights.nights,
    stayNights: nights.stayNights,
    freeNights: nights.freeNights,
    nightsKnown: nights.nightsKnown,
    placesSlept: nights.placesSlept,
    trackCount: row._count.tracks,
    tourCount,
  };
}
