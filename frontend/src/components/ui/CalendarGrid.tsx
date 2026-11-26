import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, KeyboardEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { formatDayLabel } from "../../lib/format";
import { addDays, dayParts, dayString, daysInMonth, weekdayOf } from "../../shared/time/calendar";
import { monthCells, weekdayDays } from "./dateParts";
import YearPicker, { type YearOption } from "./YearPicker";

export interface CalendarGridProps {
  /** The day that is chosen (single mode) or the range's start (`rangeTo` set). */
  value: string;
  /** Range mode: the last day of the range; the days between are tinted. */
  rangeTo?: string;
  onPick: (day: string) => void;
  min?: string;
  max?: string;
  /** 1 = Monday first (DE), 0 = Sunday first (US date format). */
  weekStart: 0 | 1;
  language: string;
  /** The day shown when `value` is empty. */
  today: string;
}

const YEARS_BEFORE = 90;
const YEARS_AFTER = 20;

function yearOptions(center: number, min?: string, max?: string): YearOption[] {
  const lo = min ? dayParts(min).year : center - YEARS_BEFORE;
  const hi = max ? dayParts(max).year : center + YEARS_AFTER;
  const out: YearOption[] = [];
  for (let y = Math.max(1000, lo); y <= Math.min(9999, hi); y += 1) out.push({ year: y });
  return out;
}

/**
 * A month grid: ‹ › for months, the year through the app's `YearPicker`, days
 * as a roving-tabindex grid. Arrow keys move a day or a week, Page Up/Down a
 * month, Home/End the week's ends; Enter/Space chooses. Days outside min/max
 * are disabled, not hidden. The popover around it owns Escape.
 */
export default function CalendarGrid({
  value,
  rangeTo,
  onPick,
  min,
  max,
  weekStart,
  language,
  today,
}: CalendarGridProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const coarse = useCoarsePointer();
  const anchorDay = value || today;
  const [focusDay, setFocusDay] = useState<string>(anchorDay);
  const [view, setView] = useState(() => dayParts(anchorDay));
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef(false);

  const cells = useMemo(() => monthCells(view.year, view.month, weekStart), [view, weekStart]);
  const years = useMemo(() => yearOptions(view.year, min, max), [view.year, min, max]);
  const headers = useMemo(() => weekdayDays(weekStart), [weekStart]);
  const size = coarse ? 44 : 36;
  const outside = (day: string): boolean => (min ? day < min : false) || (max ? day > max : false);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    cellRefs.current.get(focusDay)?.focus();
  }, [focusDay, view]);

  const goTo = (day: string, moveFocus: boolean): void => {
    const clamped = min && day < min ? min : max && day > max ? max : day;
    focusNext.current = moveFocus;
    setFocusDay(clamped);
    const p = dayParts(clamped);
    if (p.year !== view.year || p.month !== view.month) setView(p);
  };

  const shiftMonth = (delta: number): void => {
    const total = view.year * 12 + (view.month - 1) + delta;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const day = Math.min(dayParts(focusDay).day, daysInMonth(year, month));
    goTo(dayString(year, month, day), false);
  };

  const setYear = (year: number): void => {
    const day = Math.min(dayParts(focusDay).day, daysInMonth(year, view.month));
    goTo(dayString(year, view.month, day), false);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in step) {
      e.preventDefault();
      goTo(addDays(focusDay, step[e.key]), true);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftMonth(e.key === "PageUp" ? -1 : 1);
      focusNext.current = true;
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const offset = (weekdayOf(focusDay) - weekStart + 7) % 7;
      goTo(addDays(focusDay, e.key === "Home" ? -offset : 6 - offset), true);
    }
  };

  const arrow: CSSProperties = {
    width: size,
    height: size,
    color: "var(--ts-text-bright)",
    borderRadius: 999,
  };
  const title = formatDayLabel(
    dayString(view.year, view.month, 1),
    { month: "long", year: "numeric" },
    language
  );
  const lo = rangeTo && value && rangeTo < value ? rangeTo : value;
  const hi = rangeTo && value && rangeTo < value ? value : rangeTo;

  return (
    <div role="group" aria-label={t("common:dateField.calendar")} style={{ minWidth: 7 * size }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t("common:dateField.prevMonth")}
          onClick={() => shiftMonth(-1)}
          style={arrow}
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold"
            aria-live="polite"
            style={{ color: "var(--ts-text-bright)" }}
          >
            {title.replace(/\s*\d{4}$/, "")}
          </span>
          <YearPicker
            years={years}
            value={view.year}
            onChange={(y) => y !== "all" && setYear(y)}
            allowAll={false}
            label={t("common:dateField.year")}
          />
        </div>
        <button
          type="button"
          aria-label={t("common:dateField.nextMonth")}
          onClick={() => shiftMonth(1)}
          style={arrow}
        >
          ›
        </button>
      </div>
      <div
        role="grid"
        aria-label={title}
        onKeyDown={onKey}
        className="grid"
        style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}
      >
        {headers.map((d) => (
          <span
            key={d}
            role="columnheader"
            className="text-center text-xs"
            style={{ color: "var(--ts-muted)" }}
          >
            {formatDayLabel(d, { weekday: "short" }, language).replace(/\.$/, "")}
          </span>
        ))}
        {cells.map(({ day, inMonth }) => {
          const chosen = day === value || day === rangeTo;
          const between = lo && hi && day > lo && day < hi;
          const disabled = outside(day);
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              ref={(el) => {
                if (el) cellRefs.current.set(day, el);
                else cellRefs.current.delete(day);
              }}
              tabIndex={day === focusDay ? 0 : -1}
              disabled={disabled}
              aria-selected={chosen}
              aria-current={day === today ? "date" : undefined}
              aria-label={formatDayLabel(
                day,
                { weekday: "long", day: "numeric", month: "long", year: "numeric" },
                language
              )}
              onClick={() => onPick(day)}
              className="rounded-lg text-sm tabular-nums"
              style={{
                minHeight: size,
                opacity: disabled ? 0.3 : inMonth ? 1 : 0.5,
                fontWeight: chosen ? 700 : 400,
                background: chosen
                  ? "var(--ts-accent)"
                  : between
                    ? "color-mix(in srgb, var(--ts-accent) 18%, transparent)"
                    : "transparent",
                color: chosen ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
                outline: day === today && !chosen ? "1px solid var(--ts-border)" : undefined,
              }}
            >
              {dayParts(day).day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
