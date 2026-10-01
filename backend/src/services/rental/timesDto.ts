import {
  TIME_PRECISIONS,
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
}

const precisionOf = (value: string): TimePrecision =>
  (TIME_PRECISIONS as readonly string[]).includes(value) ? (value as TimePrecision) : "minute";

const at = (time: Date | null, zone: string, precision: TimePrecision): TimeValue | null =>
  time ? serializeTime(time, zone, precision) : null;

export function rentalTimes(r: RentalTimeColumns): RentalTimes {
  return {
    pickup: at(r.pickupTime, r.pickupTimezone, precisionOf(r.pickupPrecision)),
    return: at(r.returnTime, r.returnTimezone, precisionOf(r.returnPrecision)),
    actualPickup: at(r.actualPickupTime, r.pickupTimezone, "minute"),
    actualReturn: at(r.actualReturnTime, r.returnTimezone, "minute"),
  };
}
