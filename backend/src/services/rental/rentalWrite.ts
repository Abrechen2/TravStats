import { AppError } from "../../middleware/errorHandler";
import type { UpdateRentalInput } from "../../schemas/rental";
import { deriveRentalStatus } from "../../shared/statusDerivation";
import { LocalTimeNonexistentError } from "../../shared/time/errors";
import { toInstant, toLocal, type Fold } from "../../shared/time/instant";
import { now as clockNow } from "../../shared/time/clock";
import type { TimePrecision } from "../../shared/time/wire";
import {
  pickupColumns,
  returnColumns,
  storedStation,
  type ResolvedStation,
} from "./rentalStations";

/**
 * The write rules of a rental, in one place for create and update (spec
 * 2026-10-01-rental-domain-design §2, §3.1). Derived here and never taken from
 * the client: the station zones (rentalStations.ts), the UTC instants (the
 * station's wall clock read in that zone, ADR 0002) and the status.
 */

/** The row as far as these rules read it. */
export interface RentalState {
  pickupStationName: string;
  pickupAddress: string | null;
  pickupAirportId: number | null;
  pickupLat: number;
  pickupLon: number;
  pickupCountry: string | null;
  pickupTimezone: string;
  returnStationName: string;
  returnAddress: string | null;
  returnAirportId: number | null;
  returnLat: number;
  returnLon: number;
  returnCountry: string | null;
  returnTimezone: string;
  pickupTime: Date;
  returnTime: Date;
  pickupPrecision: string;
  returnPrecision: string;
  actualPickupTime: Date | null;
  actualReturnTime: Date | null;
  status: string;
}

export type TimeField = "pickupLocal" | "returnLocal" | "actualPickupLocal" | "actualReturnLocal";

/**
 * A wall clock the USER sent, as an instant and its precision — refused when
 * that clock never showed it (the spring-forward hour, 422
 * LOCAL_TIME_NONEXISTENT naming the field). A bare day is the day's start at
 * the station with precision `day` (ADR 0002: the day is known, the hour is
 * not), read as a machine reading so a zone whose midnight is skipped still
 * names its day.
 */
export function sentWallClock(
  wall: string,
  zone: string,
  field: TimeField,
  fold: Fold | null | undefined
): { utc: Date; precision: TimePrecision } {
  if (wall.length === 10) {
    return { utc: toInstant(`${wall}T00:00`, zone, { origin: "machine" }).utc, precision: "day" };
  }
  try {
    return {
      utc: toInstant(wall, zone, { origin: "typed", fold: fold ?? "earlier" }).utc,
      precision: "minute",
    };
  } catch (error) {
    if (!(error instanceof LocalTimeNonexistentError)) throw error;
    throw new LocalTimeNonexistentError(wall, zone, field);
  }
}

export interface ResolvedStations {
  pickup?: ResolvedStation;
  /** `null` = "returned where it was picked up". */
  return?: ResolvedStation | null;
}

/**
 * Merge an update (or a create, with `existing = null`) into the final row
 * state. A side whose clock AND station were not sent keeps its stored
 * instant; a moved station with no new clock keeps the TICKET's wall clock and
 * moves the instant with the zone — the booking, not the UTC value, is what
 * the user entered.
 */
export function mergeRental(
  existing: RentalState | null,
  input: UpdateRentalInput,
  stations: ResolvedStations,
  now: Date = clockNow()
): RentalState {
  const pickup = stations.pickup ?? (existing && storedStation(existing, "pickup"));
  if (!pickup)
    throw new AppError("pickupStation is required", 400, "RENTAL_INVALID_INPUT", "pickupStation");
  // On create an absent return station is the pickup; on update an absent one
  // stays what it was, and an explicit null re-ties it to the pickup.
  const ret =
    stations.return === null
      ? pickup
      : (stations.return ?? (existing ? storedStation(existing, "return") : pickup));

  const pickupAt = timeOf(existing, input, "pickup", pickup, ret);
  const returnAt = timeOf(existing, input, "return", pickup, ret);
  if (returnAt.utc.getTime() < pickupAt.utc.getTime()) {
    throw new AppError(
      "the return must not precede the pickup",
      400,
      "RENTAL_RETURN_BEFORE_PICKUP",
      "returnLocal"
    );
  }

  const actualPickupTime = actualOf(
    existing?.actualPickupTime ?? null,
    input.actualPickupLocal,
    pickup,
    "actualPickupLocal"
  );
  const actualReturnTime = actualOf(
    existing?.actualReturnTime ?? null,
    input.actualReturnLocal,
    ret,
    "actualReturnLocal"
  );

  const requested = input.status ?? existing?.status ?? "scheduled";
  const status = deriveRentalStatus({
    pickupTime: pickupAt.utc,
    returnTime: returnAt.utc,
    current: requested,
    now,
  });

  return {
    ...pickupColumns(pickup),
    ...returnColumns(ret),
    pickupTime: pickupAt.utc,
    returnTime: returnAt.utc,
    pickupPrecision: pickupAt.precision,
    returnPrecision: returnAt.precision,
    actualPickupTime,
    actualReturnTime,
    status,
  };
}

function timeOf(
  existing: RentalState | null,
  input: UpdateRentalInput,
  end: "pickup" | "return",
  pickup: ResolvedStation,
  ret: ResolvedStation
): { utc: Date; precision: string } {
  const station = end === "pickup" ? pickup : ret;
  const sent = end === "pickup" ? input.pickupLocal : input.returnLocal;
  const fold = end === "pickup" ? input.pickupFold : input.returnFold;
  const field: TimeField = end === "pickup" ? "pickupLocal" : "returnLocal";
  if (sent) return sentWallClock(sent, station.timezone, field, fold);
  if (!existing) throw new AppError(`${field} is required`, 400, "RENTAL_INVALID_INPUT", field);
  const storedTime = end === "pickup" ? existing.pickupTime : existing.returnTime;
  const storedZone = end === "pickup" ? existing.pickupTimezone : existing.returnTimezone;
  const storedPrecision = end === "pickup" ? existing.pickupPrecision : existing.returnPrecision;
  if (storedZone === station.timezone) return { utc: storedTime, precision: storedPrecision };
  // The station moved into another zone: the booking's wall clock stays.
  const wall = toLocal(storedTime, storedZone).local.slice(0, 16);
  return {
    utc: toInstant(
      storedPrecision === "day" ? `${wall.slice(0, 10)}T00:00` : wall,
      station.timezone,
      {
        origin: "machine",
      }
    ).utc,
    precision: storedPrecision,
  };
}

function actualOf(
  stored: Date | null,
  sent: string | null | undefined,
  station: ResolvedStation,
  field: TimeField
): Date | null {
  if (sent === undefined) return stored;
  if (sent === null) return null;
  return sentWallClock(sent, station.timezone, field, null).utc;
}

/** One-way: the stations differ — by airport when both are airports, else by more than 1 km (§3.1). */
export function isOneWay(row: {
  pickupAirportId: number | null;
  returnAirportId: number | null;
  pickupLat: number;
  pickupLon: number;
  returnLat: number;
  returnLon: number;
}): boolean {
  if (row.pickupAirportId !== null && row.returnAirportId !== null) {
    return row.pickupAirportId !== row.returnAirportId;
  }
  return haversineKm(row.pickupLat, row.pickupLon, row.returnLat, row.returnLon) > 1;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Refuse a write that leaves the return odometer BELOW the pick-up one
 * (forgejo#206) — 400 `RENTAL_ODOMETER_REVERSED` on `odometerInKm`. Checked on
 * the merged row, so a PATCH of one reading is held against the stored other;
 * a write that touches neither reading never trips over a stored pair.
 */
export function assertOdometerOrder(
  existing: { odometerOutKm: number | null; odometerInKm: number | null } | null,
  input: Pick<UpdateRentalInput, "odometerOutKm" | "odometerInKm">
): void {
  if (input.odometerOutKm === undefined && input.odometerInKm === undefined) return;
  const out =
    input.odometerOutKm !== undefined ? input.odometerOutKm : (existing?.odometerOutKm ?? null);
  const back =
    input.odometerInKm !== undefined ? input.odometerInKm : (existing?.odometerInKm ?? null);
  if (out !== null && back !== null && back < out) {
    throw new AppError(
      "the odometer at return must not be below the one at pick-up",
      400,
      "RENTAL_ODOMETER_REVERSED",
      "odometerInKm"
    );
  }
}

/**
 * The km a write leaves on the row. A person's figure is a labelled
 * correction (`user`); null clears the figure and its source; absent leaves
 * whatever the invoice (or an earlier correction) put there.
 */
export function distanceColumns(
  input: UpdateRentalInput
): { distanceKm: number | null; distanceSource: string | null } | Record<string, never> {
  if (input.distanceKm === undefined) return {};
  return input.distanceKm === null
    ? { distanceKm: null, distanceSource: null }
    : { distanceKm: input.distanceKm, distanceSource: "user" };
}
