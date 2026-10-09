import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";
import type { UpdateRentalInput } from "../../schemas/rental";
import { deriveRentalStatus } from "../../shared/statusDerivation";
import { LocalTimeNonexistentError } from "../../shared/time/errors";
import { localDay, toInstant, toLocal, type Fold } from "../../shared/time/instant";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
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
  /** minute | day; null without an actual time (a legacy row reads as minute). */
  actualPickupPrecision: string | null;
  actualReturnPrecision: string | null;
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
  if (
    returnCertainlyBeforePickup(
      { ...pickupAt, zone: pickup.timezone },
      { ...returnAt, zone: ret.timezone }
    )
  ) {
    throw new AppError(
      "the return must not precede the pickup",
      400,
      "RENTAL_RETURN_BEFORE_PICKUP",
      "returnLocal"
    );
  }

  const actualPickup = actualOf(
    existing && { utc: existing.actualPickupTime, precision: existing.actualPickupPrecision },
    input.actualPickupLocal,
    input.actualPickupFold,
    pickup,
    "actualPickupLocal"
  );
  const actualReturn = actualOf(
    existing && { utc: existing.actualReturnTime, precision: existing.actualReturnPrecision },
    input.actualReturnLocal,
    input.actualReturnFold,
    ret,
    "actualReturnLocal"
  );
  // Only when this write MOVED an actual end (the odometer's rule): a stored
  // pair the write left as it was — absent, or re-sent unchanged as a form
  // does — never blocks an unrelated edit; legacy rows hold days stored as
  // midnight minutes. A moved station keeps the actual instants, so it
  // cannot change their order.
  const moved = {
    pickup: actualMoved(
      existing && { utc: existing.actualPickupTime, precision: existing.actualPickupPrecision },
      actualPickup
    ),
    return: actualMoved(
      existing && { utc: existing.actualReturnTime, precision: existing.actualReturnPrecision },
      actualReturn
    ),
  };
  if (moved.pickup || moved.return) {
    assertActualOrder(
      actualPickup && { ...actualPickup, zone: pickup.timezone },
      actualReturn && { ...actualReturn, zone: ret.timezone },
      moved
    );
  }

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
    actualPickupTime: actualPickup?.utc ?? null,
    actualReturnTime: actualReturn?.utc ?? null,
    actualPickupPrecision: actualPickup ? actualPickup.precision : null,
    actualReturnPrecision: actualReturn ? actualReturn.precision : null,
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

interface ActualEnd {
  utc: Date;
  precision: string;
}

/** Whether a write changed an actual end — its instant or its precision (a legacy null is a minute). */
export function actualMoved(
  stored: { utc: Date | null; precision: string | null } | null,
  next: ActualEnd | null
): boolean {
  const before = stored?.utc
    ? { at: stored.utc.getTime(), precision: stored.precision ?? "minute" }
    : null;
  const after = next ? { at: next.utc.getTime(), precision: next.precision } : null;
  if (before === null || after === null) return before !== after;
  return before.at !== after.at || before.precision !== after.precision;
}

/**
 * An actual hand-over after the write: absent keeps what is stored (with its
 * precision — a legacy row without one reads as minute), null clears it, a
 * wall clock is read on the station's clock with ITS fold — the same rule as
 * the booked ends, so 02:30 on the autumn night is the occurrence the user
 * chose and not silently the earlier one.
 */
function actualOf(
  stored: { utc: Date | null; precision: string | null } | null,
  sent: string | null | undefined,
  fold: Fold | null | undefined,
  station: ResolvedStation,
  field: TimeField
): ActualEnd | null {
  if (sent === undefined) {
    return stored?.utc ? { utc: stored.utc, precision: stored.precision ?? "minute" } : null;
  }
  if (sent === null) return null;
  return sentWallClock(sent, station.timezone, field, fold);
}

/** A recorded end on its station's clock: a minute is a point, a day its whole local day. */
interface TimedEnd {
  utc: Date;
  precision: string;
  zone: string;
}

/** The start of the day after a day-only end, at its station — the day's exclusive bound. */
function nextDayStart(end: TimedEnd): number {
  const next = fromDbDate(new Date(toDbDate(localDay(end.utc, end.zone)).getTime() + 86_400_000));
  return toInstant(`${next}T00:00`, end.zone, { origin: "machine" }).utc.getTime();
}

/**
 * Whether a return CERTAINLY lies before its pickup — the one order rule of
 * both the booked and the actual ends (the rail/bus rule as intervals). A
 * minute end is a point; a day-only end is its whole local day at its own
 * station, `[dayStart, nextDayStart)`, stored at its day start. So a day-only
 * return on the pickup's own day is valid, and is refused only when its day
 * ENDS at or before the pickup begins; two day-only ends are refused only
 * when the return day lies before the pickup day. Instants, never labels: a
 * one-way rental's two stations may keep different clocks.
 */
export function returnCertainlyBeforePickup(pickup: TimedEnd, ret: TimedEnd): boolean {
  const pickupStart = pickup.utc.getTime();
  return ret.precision === "day"
    ? nextDayStart(ret) <= pickupStart
    : ret.utc.getTime() < pickupStart;
}

/**
 * Refuse an actual return before the actual pickup — compared as INSTANTS,
 * since a one-way rental's two stations may keep different clocks. A day-only
 * end stands for its whole day at its station, so a return recorded only as
 * the pickup's own day is never refused. 400
 * `RENTAL_ACTUAL_RETURN_BEFORE_PICKUP`, `field` = the end this write moved
 * (the return when both moved — the end a reader fixes first).
 */
function assertActualOrder(
  pickup: TimedEnd | null,
  ret: TimedEnd | null,
  moved: { pickup: boolean; return: boolean }
): void {
  if (!pickup || !ret) return;
  if (!returnCertainlyBeforePickup(pickup, ret)) return;
  const field = moved.pickup && !moved.return ? "actualPickupLocal" : "actualReturnLocal";
  throw new AppError(
    "the actual return must not precede the actual pickup",
    400,
    "RENTAL_ACTUAL_RETURN_BEFORE_PICKUP",
    field
  );
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

type DepositInput = Pick<
  UpdateRentalInput,
  | "depositAmount"
  | "depositCurrency"
  | "depositPaidOn"
  | "depositReturnedOn"
  | "depositReturnedAmount"
>;

interface StoredDeposit {
  depositAmount: number | null;
  depositCurrency: string | null;
  depositPaidOn: Date | null;
  depositReturnedOn: Date | null;
  depositReturnedAmount: number | null;
}

/**
 * The deposit columns a write leaves (forgejo#238): days as `@db.Date`, the
 * rest as sent; absent keys are absent, so a client that never sends a
 * deposit (the Companion today) never clears one.
 */
export function depositColumns(input: DepositInput): Partial<StoredDeposit> {
  const day = (v: string | null | undefined): Date | null | undefined =>
    v === undefined ? undefined : v === null ? null : toDbDate(v);
  const columns: Partial<StoredDeposit> = {
    depositAmount: input.depositAmount,
    depositCurrency: input.depositCurrency,
    depositPaidOn: day(input.depositPaidOn),
    depositReturnedOn: day(input.depositReturnedOn),
    depositReturnedAmount: input.depositReturnedAmount,
  };
  return Object.fromEntries(
    Object.entries(columns).filter(([, v]) => v !== undefined)
  ) as Partial<StoredDeposit>;
}

/**
 * A deposit that cannot be true, refused on the MERGED row (as the odometer):
 * an amount without its currency (it would be read in some other one); more
 * back than was held; back before it was held. 400 with `field` on the value
 * to fix. A partial refund (less back than held) is valid and stays so.
 */
export function assertDepositConsistent(existing: StoredDeposit | null, input: DepositInput): void {
  const keys = Object.keys(depositColumns(input));
  if (keys.length === 0) return;
  const merged = { ...emptyDeposit(existing), ...depositColumns(input) };
  const refuse = (message: string, code: ApiErrorCode, field: string): never => {
    throw new AppError(message, 400, code, field);
  };
  const held = merged.depositAmount ?? null;
  const back = merged.depositReturnedAmount ?? null;
  if ((held !== null || back !== null) && !merged.depositCurrency) {
    refuse("a deposit amount needs its currency", "RENTAL_INVALID_INPUT", "depositCurrency");
  }
  if (held !== null && back !== null && back > held) {
    refuse(
      "more of the deposit came back than was held",
      "RENTAL_DEPOSIT_RETURN_EXCEEDS",
      "depositReturnedAmount"
    );
  }
  const paid = merged.depositPaidOn ?? null;
  const returned = merged.depositReturnedOn ?? null;
  if (paid !== null && returned !== null && returned.getTime() < paid.getTime()) {
    refuse(
      "the deposit came back before it was held",
      "RENTAL_DEPOSIT_RETURNED_BEFORE_PAID",
      "depositReturnedOn"
    );
  }
}

function emptyDeposit(existing: StoredDeposit | null): StoredDeposit {
  return {
    depositAmount: existing?.depositAmount ?? null,
    depositCurrency: existing?.depositCurrency ?? null,
    depositPaidOn: existing?.depositPaidOn ?? null,
    depositReturnedOn: existing?.depositReturnedOn ?? null,
    depositReturnedAmount: existing?.depositReturnedAmount ?? null,
  };
}
