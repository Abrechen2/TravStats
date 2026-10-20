/** Ferry crossings (dennis/TravStats forgejo#293). */
import { AppError } from "../../middleware/errorHandler";
import type { FerryStationInput, UpdateFerryJourneyInput } from "../../schemas/ferry";
import { deriveBusStatus as deriveFerryStatus } from "../../shared/statusDerivation";
import { rideEndsAt } from "../../shared/railClock";
import { zoneOf } from "../../shared/time/zoneOf";
import { assertArrivalNotBefore, resolveDistance, resolveEnd } from "../rides/rideEnds";
import { readSeaGeometry, sameFerryEnds } from "./ferryGeometry";
import { polylineLengthKm } from "../../shared/geo/haversine";

export interface FerryJourneyState {
  depStationName: string;
  depAddress: string | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrAddress: string | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision?: string | null;
  arrPrecision?: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  geometry?: unknown;
  geometrySource?: string;
  status: string;
  delayMinutes?: number | null;
}

type TerminalColumns<P extends "dep" | "arr"> = {
  [
    K in `${P}StationName` | `${P}Address` | `${P}Lat` | `${P}Lon` | `${P}Country` | `${P}Timezone`
  ]: K extends `${P}Lat` | `${P}Lon`
    ? number
    : K extends `${P}StationName`
      ? string
      : string | null;
};

export function terminalColumns<P extends "dep" | "arr">(
  prefix: P,
  station: FerryStationInput
): TerminalColumns<P> {
  return {
    [`${prefix}StationName`]: station.name,
    [`${prefix}Address`]: station.address ?? null,
    [`${prefix}Lat`]: station.lat,
    [`${prefix}Lon`]: station.lon,
    [`${prefix}Country`]: station.country ?? null,
    [`${prefix}Timezone`]: zoneOf({ catalogueZone: null, lat: station.lat, lon: station.lon }),
  } as TerminalColumns<P>;
}

function pickTerminal<P extends "dep" | "arr">(
  row: FerryJourneyState,
  prefix: P
): TerminalColumns<P> {
  const read = (suffix: string): unknown =>
    (row as unknown as Record<string, unknown>)[`${prefix}${suffix}`];
  return {
    [`${prefix}StationName`]: read("StationName"),
    [`${prefix}Address`]: read("Address") ?? null,
    [`${prefix}Lat`]: read("Lat"),
    [`${prefix}Lon`]: read("Lon"),
    [`${prefix}Country`]: read("Country"),
    [`${prefix}Timezone`]: read("Timezone"),
  } as TerminalColumns<P>;
}

export function mergeFerryJourney(
  existing: FerryJourneyState | null,
  input: UpdateFerryJourneyInput,
  now: Date = new Date()
): Omit<FerryJourneyState, "geometry" | "geometrySource"> {
  const dep = input.departureStation
    ? terminalColumns("dep", input.departureStation)
    : existing && pickTerminal(existing, "dep");
  const arr = input.arrivalStation
    ? terminalColumns("arr", input.arrivalStation)
    : existing && pickTerminal(existing, "arr");
  if (!dep || !arr) throw new AppError("Both terminals are required", 400, "FERRY_INVALID_INPUT");

  const departure = resolveEnd({
    sent: input.departureLocal,
    fold: input.departureFold,
    zone: dep.depTimezone,
    stopMoved: Boolean(input.departureStation),
    stored: existing && {
      time: existing.departureTime,
      zone: existing.depTimezone,
      precision: existing.depPrecision ?? null,
    },
    field: "departureLocal",
  });
  if (!departure)
    throw new AppError("departureLocal is required", 400, "FERRY_INVALID_INPUT", "departureLocal");
  const arrival = resolveEnd({
    sent: input.arrivalLocal,
    fold: input.arrivalFold,
    zone: arr.arrTimezone,
    stopMoved: Boolean(input.arrivalStation),
    stored:
      existing?.arrivalTime != null
        ? {
            time: existing.arrivalTime,
            zone: existing.arrTimezone,
            precision: existing.arrPrecision ?? null,
          }
        : null,
    field: "arrivalLocal",
  });
  assertArrivalNotBefore(
    departure,
    dep.depTimezone,
    arrival,
    arr.arrTimezone,
    "FERRY_ARRIVAL_BEFORE_DEPARTURE"
  );

  const departureTime = departure.time;
  const arrivalTime = arrival?.time ?? null;
  const clockless = departure.precision === "day" || arrival?.precision === "day";
  if (clockless && input.delayMinutes !== undefined && input.delayMinutes !== null) {
    throw new AppError(
      "a delay needs the ride's times",
      400,
      "FERRY_INVALID_INPUT",
      "delayMinutes"
    );
  }

  let { distanceKm, distanceSource } = resolveDistance(existing, input, { ...dep, ...arr });
  const seaLine =
    existing?.geometrySource === "sea_route" && sameFerryEnds(existing, { ...dep, ...arr })
      ? readSeaGeometry(existing.geometry)
      : null;
  if (seaLine && distanceSource !== "user") {
    distanceKm =
      Math.round(polylineLengthKm(seaLine.map(([lon, lat]) => ({ lat, lon }))) * 10) / 10;
    distanceSource = "sea_route";
  }
  const depPrecision = departure.precision;
  const arrPrecision = arrival?.precision ?? null;
  const status = deriveFerryStatus({
    departureTime,
    arrivalTime,
    current: input.status ?? existing?.status ?? "scheduled",
    now,
    endsAt: rideEndsAt({
      departureTime,
      arrivalTime,
      depTimezone: dep.depTimezone,
      arrTimezone: arr.arrTimezone,
      depPrecision,
      arrPrecision,
    }),
  });

  return {
    ...dep,
    ...arr,
    departureTime,
    arrivalTime,
    depPrecision,
    arrPrecision,
    distanceKm,
    distanceSource,
    status,
    ...(clockless && { delayMinutes: null }),
  };
}
