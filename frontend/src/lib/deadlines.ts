import i18next from "i18next";
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
/** The translate function, as loose as the project wrapper hands it out. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

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
  t: Translate,
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
  t: Translate,
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
  t: Translate,
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

/**
 * The deadlines as one line, for a card with room for a single caption (the
 * trip timeline's stay entry); null when none is recorded. In the app's
 * current language — the timeline card is handed `t` only.
 */
export function deadlineSummary(
  times: DeadlineTimes | null | undefined,
  t: Translate
): string | null {
  const locale = (i18next.language ?? "de").startsWith("en") ? "en-GB" : "de-DE";
  const parts = deadlineFacts(times, t, locale).filter((fact) => fact.value !== null);
  return parts.length > 0 ? parts.map((fact) => `${fact.label}: ${fact.value}`).join(" · ") : null;
}
