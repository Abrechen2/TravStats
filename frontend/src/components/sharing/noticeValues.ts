import { formatDayLong, formatTimeValue, timeValueFromWallClock } from "../../shared/time";
import type { ShareDisplayValue } from "../../types/sharing";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One side of a changed fact, in the reader's language. Times go through the
 * app's own time helpers (ADR 0002): a `time` value shows its `local` reading
 * at the place, a `day` its calendar day — the browser's zone moves neither.
 */
export function formatShareValue(value: ShareDisplayValue, locale: string, t: Translate): string {
  switch (value.kind) {
    case "time":
      return formatTimeValue(value.value, locale);
    case "day":
      return formatDayLong(value.value.date, locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    case "wallClock": {
      const reading = timeValueFromWallClock(value.value);
      return reading ? formatTimeValue(reading, locale) : value.value;
    }
    case "text":
      return value.value;
    case "number":
      return new Intl.NumberFormat(locale).format(value.value);
    case "boolean":
      return t(value.value ? "sharing:values.yes" : "sharing:values.no");
    case "list":
      return t("sharing:values.list", { count: value.count });
    case "empty":
      return "—";
    case "other":
      return t("sharing:values.other");
  }
}

/** The label of a fact: `sharing:fields.<name>`, the name itself if unlisted. */
export function shareFieldLabel(field: string, t: Translate): string {
  return t(`sharing:fields.${field}`, { defaultValue: field });
}
