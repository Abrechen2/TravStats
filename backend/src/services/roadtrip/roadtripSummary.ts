import {
  countRoadtripNights,
  isStation,
  stationState,
  type RoadtripNights,
} from "../../shared/tour/roadtrip";
import { drivenKm, travelledKm } from "../tour/tourDistance";
import type { CountryResolver } from "../geo/countryFromCoordinates";
import { toCountryCode } from "../../shared/countryEvidence";
import { stayTimes } from "../lodging/timesDto";
import { stationTimes } from "./timesDto";
import { NOT_A_COVER } from "../trips/photoStation";

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
  // What the stay's `times` are built from (ADR 0002 phase 4).
  checkInDate: true,
  checkOutDate: true,
  checkInAt: true,
  checkOutAt: true,
  stayZone: true,
  datePrecision: true,
  nights: true,
  status: true,
  lodging: {
    select: { id: true, name: true, type: true, city: true, country: true, isoCountryCode: true },
  },
} as const;

export const STATION_SELECT = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  startDate: true,
  endDate: true,
  startUtc: true,
  endUtc: true,
  stopZone: true,
  notes: true,
  routeOrderIdx: true,
  overnight: true,
  viaPoint: true,
  lodgingStayId: true,
  lodgingStay: { select: STATION_STAY_SELECT },
  placeId: true,
  place: { select: { id: true, name: true, localName: true, category: true } },
} as const;

/**
 * STATION_SELECT plus what only the station DTO needs: how many trip photos
 * are filed at each station (forgejo#139), so the station chain can show them
 * without a call per station. A separate select so the readers that only
 * count nights or countries do not pay for the count; `toStationDto` takes
 * `StationDtoRow`, so a DTO built from the narrower select fails `tsc` rather
 * than shipping a missing count.
 *
 * The cover's pseudo-photo row is left out, as every gallery read does.
 */
export const STATION_DTO_SELECT = {
  ...STATION_SELECT,
  _count: { select: { photos: { where: NOT_A_COVER } } },
} as const;

/**
 * The relation filter for readers that want STATIONS only — every count, the
 * phone's list, the statistics. A route correction (`viaPoint`) is a bend in
 * the line, not a place; the editor and the leg writer are the only readers
 * that must see it.
 */
export const STATIONS_ONLY = { viaPoint: false } as const;

export interface StationRow {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
  notes: string | null;
  routeOrderIdx: number | null;
  overnight: boolean;
  viaPoint: boolean;
  placeId: string | null;
  place: { id: string; name: string; category: string } | null;
  lodgingStayId: string | null;
  lodgingStay: {
    id: string;
    lodgingId: string;
    checkIn: Date | null;
    checkOut: Date | null;
    checkInDate: Date | null;
    checkOutDate: Date | null;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    stayZone: string | null;
    datePrecision: string;
    nights: number | null;
    status: string;
    lodging: {
      id: string;
      name: string;
      type: string;
      city: string | null;
      country: string | null;
      isoCountryCode: string | null;
    };
  } | null;
}

export interface StationDtoRow extends StationRow {
  _count: { photos: number };
}

export function nightsOf(stations: readonly StationRow[]): RoadtripNights {
  return countRoadtripNights(
    stations.map((s) => ({
      lodgingStayId: s.lodgingStayId,
      overnight: s.overnight,
      viaPoint: s.viaPoint,
      startDate: s.startDate,
      endDate: s.endDate,
      stay: s.lodgingStay
        ? {
            checkIn: s.lodgingStay.checkIn,
            checkOut: s.lodgingStay.checkOut,
            datePrecision: s.lodgingStay.datePrecision,
            nights: s.lodgingStay.nights,
            status: s.lodgingStay.status,
            lodgingType: s.lodgingStay.lodging.type,
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
  for (const s of stations.filter(isStation)) {
    const from = s.startDate ?? s.lodgingStay?.checkIn ?? null;
    const to = s.endDate ?? s.lodgingStay?.checkOut ?? from;
    if (from && (!start || from < start)) start = from;
    if (to && (!end || to > end)) end = to;
  }
  return { startDate: start?.toISOString() ?? null, endDate: end?.toISOString() ?? null };
}

export function toStationDto(s: StationDtoRow): Record<string, unknown> {
  const stay = s.lodgingStay;
  return {
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    startDate: s.startDate,
    endDate: s.endDate,
    times: stationTimes(s),
    notes: s.notes,
    order: s.routeOrderIdx,
    state: stationState(s),
    lodgingStayId: s.lodgingStayId,
    // The place a pass-through passed (tester 2026-09-26); null elsewhere.
    placeId: s.placeId,
    place: s.place,
    // Trip photos filed at this station; GET /trips/:tripId/photos?stopId=
    // lists them. Always 0 on a roadtrip filed on no trip — a trip photo
    // needs a trip to belong to.
    photoCount: s._count.photos,
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
          times: stayTimes(stay),
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

/**
 * The countries a roadtrip's stations stand in (ISO alpha-2). The land-only
 * boundary set answers null on the shore — measured at Hirtshals and
 * Stavanger, which is where campsites and ferry ports are — so a station's
 * linked stay speaks for its country there; with neither, it abstains. The
 * cross-domain overview asks the same question of the same rule.
 */
export function stationCountries(
  stations: ReadonlyArray<{
    lat: number | null;
    lon: number | null;
    viaPoint?: boolean;
    lodgingStay: { lodging: { isoCountryCode: string | null } } | null;
  }>,
  resolver: Pick<CountryResolver, "countryAt">
): string[] {
  const touched = new Set<string>();
  // A route correction's country is one driven through at most, never one
  // the traveller stopped in (tester 2026-09-26).
  for (const s of stations.filter(isStation)) {
    const fromPoint = s.lat !== null && s.lon !== null ? resolver.countryAt(s.lat, s.lon) : null;
    const code = fromPoint ?? toCountryCode(s.lodgingStay?.lodging.isoCountryCode ?? null);
    if (code) touched.add(code);
  }
  return [...touched].sort();
}

export function toRoadtripSummary(
  row: RoadtripListRow,
  tourCount: number,
  countries: string[]
): Record<string, unknown> {
  const nights = nightsOf(row.stops);
  const stations = row.stops.filter(isStation);
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
    stationCount: stations.length,
    // `[lon, lat]` in travel order, for the list's route sketch; a station
    // without a point has nothing to draw and is left out, and so is a route
    // correction — the sketch marks stations.
    points: stations.flatMap((s) => (s.lat !== null && s.lon !== null ? [[s.lon, s.lat]] : [])),
    // The stations themselves, for the dashboard map's markers (tester
    // 2026-09-26): placed ones only, never a route correction.
    stations: stations.flatMap((s) =>
      s.lat !== null && s.lon !== null
        ? [{ id: s.id, title: s.title, lat: s.lat, lon: s.lon, state: stationState(s) }]
        : []
    ),
    nights: nights.nights,
    stayNights: nights.stayNights,
    freeNights: nights.freeNights,
    nightsKnown: nights.nightsKnown,
    placesSlept: nights.placesSlept,
    trackCount: row._count.tracks,
    tourCount,
    countries,
  };
}
