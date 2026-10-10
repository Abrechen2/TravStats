import type { BookingTimes } from "../../schemas/times";
import { deadlineDayFields, deadlineTimes, type DeadlineColumns } from "./bookingDeadlines";

/**
 * A booking as its own routes hand it out (forgejo#285): the row, its DAY
 * deadline columns as `YYYY-MM-DD` (never a JS midnight a client could shift
 * by its own zone), and `times` with the deadlines as TimeValue /
 * LocalDateValue (ADR 0002 D3).
 */
export type BookingWithTimes<T> = Omit<T, "freeCancellationOn" | "paymentDueOn"> & {
  freeCancellationOn: string | null;
  paymentDueOn: string | null;
  times: BookingTimes;
};

export function bookingTimes(row: DeadlineColumns): BookingTimes {
  return deadlineTimes(row);
}

export function withBookingTimes<T extends DeadlineColumns>(row: T): BookingWithTimes<T> {
  return { ...row, ...deadlineDayFields(row), times: bookingTimes(row) };
}
