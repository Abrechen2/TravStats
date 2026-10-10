import type { TFunction } from "i18next";
import {
  formatDayLong,
  formatTimeValue,
  type LocalDateValue,
  type TimeValue,
} from "../shared/time";

/**
 * Booking deadlines on the read side (forgejo#285): the members a stay's,
 * a rental's and a booking's `times` carry, and the flight's check-in opening.
 *
 * A cancellation deadline is EITHER an instant on a place's clock OR a day
 * ("until 1 May") — never both. The day is shown as "until the end of" that
 * day in words only; no time of day is ever made up for it.
 */
export interface DeadlineTimes {
  freeCancellationUntil?: TimeValue | null;
  freeCancellationOn?: LocalDateValue | null;
  paymentDue?: LocalDateValue | null;
}

export interface DeadlineFact {
  label: string;
  value: string | null;
}

const moment = (value: TimeValue, locale: string): string =>
  `${formatTimeValue(value, locale)}${value.zone ? ` (${value.zone})` : ""}`;

/** The cancellation deadline in words, or null when none is recorded. */
export function cancellationText(
  times: DeadlineTimes | null | undefined,
  t: TFunction,
  locale: string
): string | null {
  if (times?.freeCancellationUntil) {
    return t("common:deadlines.untilMoment", {
      moment: moment(times.freeCancellationUntil, locale),
    });
  }
  if (times?.freeCancellationOn) {
    return t("common:deadlines.untilEndOfDay", {
      day: formatDayLong(times.freeCancellationOn.date, locale),
    });
  }
  return null;
}

/** The facts a detail section lists; a null value hides the line, like every other unknown. */
export function deadlineFacts(
  times: DeadlineTimes | null | undefined,
  t: TFunction,
  locale: string
): DeadlineFact[] {
  return [
    { label: t("common:deadlines.freeCancellation"), value: cancellationText(times, t, locale) },
    {
      label: t("common:deadlines.paymentDue"),
      value: times?.paymentDue ? formatDayLong(times.paymentDue.date, locale) : null,
    },
  ];
}

export function onlineCheckInFact(
  value: TimeValue | null | undefined,
  t: TFunction,
  locale: string
): DeadlineFact {
  return {
    label: t("common:deadlines.onlineCheckIn"),
    value: value ? moment(value, locale) : null,
  };
}

/** True when any deadline is recorded — a section with none is not drawn. */
export function hasDeadlines(times: DeadlineTimes | null | undefined): boolean {
  return Boolean(times?.freeCancellationUntil || times?.freeCancellationOn || times?.paymentDue);
}
