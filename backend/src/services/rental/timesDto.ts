import { fromDbDate } from "../../shared/time/localDate";
import {
  TIME_PRECISIONS,
  serializeDay,
  serializeTime,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import type { RentalTimes } from "../../schemas/times";

/**
 * A rental's `times` (ADR 0002 D3). A rental stores real instants and the
 * zone of each station from its first write — there is no legacy row without
 * a zone — so every value goes out on its station's clock.
 */
export interface RentalTimeColumns {
  pickupTime: Date;
  returnTime: Date;
  actualPickupTime: Date | null;
  actualReturnTime: Date | null;
  pickupTimezone: string;
  returnTimezone: string;
  pickupPrecision: string;
  returnPrecision: string;
  actualPickupPrecision: string | null;
  actualReturnPrecision: string | null;
  depositPaidOn?: Date | null;
  depositReturnedOn?: Date | null;
}

/**
 * A deposit day as the card statement shows it: a calendar day with NO zone —
 * the bank's booking day belongs to no station clock (forgejo#238).
 */
const statementDay = (value: Date | null | undefined) =>
  value ? serializeDay(fromDbDate(value), null) : null;

const precisionOf = (value: string): TimePrecision =>
  (TIME_PRECISIONS as readonly string[]).includes(value) ? (value as TimePrecision) : "minute";

const at = (time: Date | null, zone: string, precision: TimePrecision): TimeValue | null =>
  time ? serializeTime(time, zone, precision) : null;

export function rentalTimes(r: RentalTimeColumns): RentalTimes {
  return {
    pickup: at(r.pickupTime, r.pickupTimezone, precisionOf(r.pickupPrecision)),
    return: at(r.returnTime, r.returnTimezone, precisionOf(r.returnPrecision)),
    // A row written before the precision columns has none: it was read to the minute.
    actualPickup: at(
      r.actualPickupTime,
      r.pickupTimezone,
      precisionOf(r.actualPickupPrecision ?? "minute")
    ),
    depositPaid: statementDay(r.depositPaidOn),
    depositReturned: statementDay(r.depositReturnedOn),
    actualReturn: at(
      r.actualReturnTime,
      r.returnTimezone,
      precisionOf(r.actualReturnPrecision ?? "minute")
    ),
  };
}
