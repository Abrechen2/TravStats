// The day picker above the trip map: "Alle Tage" plus one chip per day the trip
// has entries on. Choosing a day dims everything that is not on it.

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { formatDayLong } from "../../shared/time/calendar";

const CHIP_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

interface Props {
  days: readonly string[];
  /** `YYYY-MM-DD`, or null for every day. */
  day: string | null;
  onChange: (day: string | null) => void;
}

export function TripMapDayStrip({ days, day, onChange }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["trips"]);
  const coarse = useCoarsePointer();
  if (days.length === 0) return null;
  const locale = i18n.language || "de";
  const chip = `shrink-0 rounded-full border px-3 text-xs font-medium whitespace-nowrap ${
    coarse ? "min-h-(--ts-size-touch-min)" : "py-1.5"
  }`;
  const style = (active: boolean): React.CSSProperties => ({
    borderColor: active ? "var(--accent)" : "var(--color-border)",
    color: active ? "var(--accent)" : "var(--text-muted)",
    background: active ? "var(--bg-surface)" : "transparent",
  });
  return (
    <div
      role="group"
      aria-label={t("trips:detail.map.days.label")}
      data-testid="trip-map-day-strip"
      className="mb-2 flex gap-2 overflow-x-auto pb-1"
    >
      <button
        type="button"
        className={chip}
        style={style(day === null)}
        aria-pressed={day === null}
        onClick={() => onChange(null)}
      >
        {t("trips:detail.map.days.all")}
      </button>
      {days.map((d, index) => (
        <button
          key={d}
          type="button"
          className={chip}
          style={style(day === d)}
          aria-pressed={day === d}
          onClick={() => onChange(day === d ? null : d)}
        >
          {t("trips:detail.map.days.dayN", { n: index + 1 })} ·{" "}
          {formatDayLong(d, locale, CHIP_DATE)}
        </button>
      ))}
    </div>
  );
}
