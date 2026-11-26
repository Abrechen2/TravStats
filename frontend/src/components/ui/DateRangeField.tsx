import type { JSX } from "react";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { addDays, dayParts, dayString } from "../../shared/time/calendar";
import { todayIn } from "../../shared/time/clock";
import CalendarGrid from "./CalendarGrid";
import CalendarPopover from "./CalendarPopover";
import Chip from "./Chip";
import DateTextBox, { useDisplayPrefs } from "./DateTextBox";

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
  /** Which quick picks to offer in the calendar; `[]` for none. Default: all three. */
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
 * A from/to pair: two typed days in the profile's format and ONE calendar
 * (▾) in which the range is chosen — the first click sets the start, the
 * second the end (an earlier second click swaps them) — with the quick picks
 * "Heute", "7 Tage", "Dieses Jahr" above it. "Today" is the PROFILE zone's day
 * (ADR 0002), so a laptop still on home time offers the same day every other
 * device does. Moving the start past the end drags the end along instead of
 * leaving an inverted range.
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
  const { t, i18n } = useTranslation(["common"]);
  const { dateFormat } = useDisplayPrefs();
  const zone = useTodayZone();
  const uid = useId();
  const today = todayIn(zone);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);

  const bound = (day: string): string => {
    if (!day) return day;
    if (max && day > max) return max;
    if (min && day < min) return min;
    return day;
  };
  const apply = (range: DateRange): void => {
    onChange({ from: bound(range.from), to: bound(range.to) });
  };

  const pickDay = (day: string): void => {
    if (anchor === null) {
      setAnchor(day);
      apply({ from: day, to: day });
      return;
    }
    apply(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
    close();
    buttonRef.current?.focus();
  };

  const label = (text: string | undefined, htmlFor: string): JSX.Element | null =>
    text ? (
      <label htmlFor={htmlFor} className="t-caption" style={{ color: "var(--ts-muted)" }}>
        {text}
      </label>
    ) : null;

  return (
    <div ref={rowRef} className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-md)" }}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)", flex: "1 1 9rem" }}>
          {label(fromLabel, `${uid}-from`)}
          <DateTextBox
            kind="day"
            id={`${uid}-from`}
            aria-label={fromLabel ? undefined : t("common:dateField.from")}
            value={from}
            disabled={disabled}
            onValue={(day) => apply({ from: day, to: to && day > to ? day : to })}
          />
        </div>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)", flex: "1 1 9rem" }}>
          {label(toLabel, `${uid}-to`)}
          <DateTextBox
            kind="day"
            id={`${uid}-to`}
            aria-label={toLabel ? undefined : t("common:dateField.to")}
            value={to}
            disabled={disabled}
            onValue={(day) => apply({ from, to: day })}
            trailing={
              <button
                type="button"
                ref={buttonRef}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t("common:dateField.open")}
                onClick={() => (open ? close() : setOpen(true))}
                className="rounded-lg border"
                style={{
                  minWidth: "var(--ts-size-touch-min)",
                  minHeight: "var(--ts-size-touch-min)",
                  borderColor: "var(--ts-border-input)",
                  background: "var(--ts-surface)",
                  color: "var(--ts-text-bright)",
                }}
              >
                ▾
              </button>
            }
          />
        </div>
      </div>
      {open ? (
        <CalendarPopover
          anchorRef={rowRef}
          onClose={close}
          returnFocusRef={buttonRef}
          label={t("common:dateField.calendar")}
        >
          {quickPicks.length > 0 ? (
            <div
              className="mb-3 flex flex-wrap"
              role="group"
              aria-label={t("common:dateField.quickPicks")}
              style={{ gap: "var(--ts-space-sm)" }}
            >
              {quickPicks.map((pick) => (
                <Chip
                  key={pick}
                  onClick={() => {
                    apply(quickPickRange(pick, today));
                    close();
                    buttonRef.current?.focus();
                  }}
                >
                  {t(`common:dateField.${pick}`)}
                </Chip>
              ))}
            </div>
          ) : null}
          <CalendarGrid
            value={from}
            rangeTo={to}
            today={today}
            min={min}
            max={max}
            weekStart={dateFormat === "MM/DD/YYYY" ? 0 : 1}
            language={i18n.language}
            onPick={pickDay}
          />
        </CalendarPopover>
      ) : null}
    </div>
  );
}
