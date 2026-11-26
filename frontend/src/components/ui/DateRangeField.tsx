import type { JSX } from "react";
import { useId } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { addDays, dayParts, dayString } from "../../shared/time/calendar";
import { todayIn } from "../../shared/time/clock";
import Chip from "./Chip";
import DateField from "./DateField";

export interface DateRange {
  from: string;
  to: string;
}

export type DateQuickPick = "today" | "last7" | "thisYear";

interface DateRangeFieldProps {
  from: string;
  to: string;
  onChange: (range: DateRange) => void;
  /** Visible labels. Omitted: the fields are named for a screen reader only. */
  fromLabel?: string;
  toLabel?: string;
  /** Earliest / latest selectable day (`YYYY-MM-DD`). */
  min?: string;
  max?: string;
  /** Which quick picks to offer; `[]` for none. Default: all three. */
  quickPicks?: readonly DateQuickPick[];
  disabled?: boolean;
}

const ALL_PICKS: readonly DateQuickPick[] = ["today", "last7", "thisYear"];

/** The range a quick pick stands for, on the profile's clock. */
export function quickPickRange(pick: DateQuickPick, today: string): DateRange {
  if (pick === "today") return { from: today, to: today };
  if (pick === "last7") return { from: addDays(today, -6), to: today };
  return { from: dayString(dayParts(today).year, 1, 1), to: today };
}

/**
 * A from/to pair of date fields with quick picks ("Heute", "7 Tage", "Dieses
 * Jahr"). "Today" is the PROFILE zone's day (ADR 0002), so a laptop still on
 * home time offers the same day every other device does. Picking a `from`
 * after `to` drags `to` along instead of leaving an inverted range.
 */
export default function DateRangeField({
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  min,
  max,
  quickPicks = ALL_PICKS,
  disabled = false,
}: DateRangeFieldProps): JSX.Element {
  const { t } = useTranslation("common");
  const zone = useTodayZone();
  const uid = useId();
  const today = todayIn(zone);
  const bound = (day: string): string => {
    if (!day) return day;
    if (max && day > max) return max;
    if (min && day < min) return min;
    return day;
  };
  const apply = (range: DateRange): void => {
    onChange({ from: bound(range.from), to: bound(range.to) });
  };
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-md)" }}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)", flex: "1 1 9rem" }}>
          {fromLabel ? (
            <label
              htmlFor={`${uid}-from`}
              className="t-caption"
              style={{ color: "var(--ts-muted)" }}
            >
              {fromLabel}
            </label>
          ) : null}
          <DateField
            id={`${uid}-from`}
            aria-label={fromLabel ? undefined : t("dateField.from")}
            value={from}
            min={min}
            max={to || max}
            disabled={disabled}
            onChange={(e) =>
              apply({ from: e.target.value, to: to && e.target.value > to ? e.target.value : to })
            }
          />
        </div>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)", flex: "1 1 9rem" }}>
          {toLabel ? (
            <label htmlFor={`${uid}-to`} className="t-caption" style={{ color: "var(--ts-muted)" }}>
              {toLabel}
            </label>
          ) : null}
          <DateField
            id={`${uid}-to`}
            aria-label={toLabel ? undefined : t("dateField.to")}
            value={to}
            min={from || min}
            max={max}
            disabled={disabled}
            onChange={(e) => apply({ from, to: e.target.value })}
          />
        </div>
      </div>
      {quickPicks.length > 0 ? (
        <div
          className="flex flex-wrap"
          role="group"
          aria-label={t("dateField.quickPicks")}
          style={{ gap: "var(--ts-space-sm)" }}
        >
          {quickPicks.map((pick) => (
            <Chip
              key={pick}
              onClick={() => {
                if (!disabled) apply(quickPickRange(pick, today));
              }}
            >
              {t(`dateField.${pick}`)}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
