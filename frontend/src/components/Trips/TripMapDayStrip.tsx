// The day picker above the trip map: "Alle Tage" plus one chip per day the trip
// has entries on. Choosing a day dims everything that is not on it.

import Chip from "../ui/Chip";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
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
  if (days.length === 0) return null;
  const locale = i18n.language || "de";
  return (
    <div
      role="group"
      aria-label={t("trips:detail.map.days.label")}
      data-testid="trip-map-day-strip"
      className="mb-2 flex gap-2 overflow-x-auto pb-1"
    >
      <Chip size="sm" className="shrink-0" active={day === null} onClick={() => onChange(null)}>
        {t("trips:detail.map.days.all")}
      </Chip>
      {days.map((d, index) => (
        <Chip
          key={d}
          size="sm"
          className="shrink-0"
          active={day === d}
          onClick={() => onChange(day === d ? null : d)}
        >
          {t("trips:detail.map.days.dayN", { n: index + 1 })} ·{" "}
          {formatDayLong(d, locale, CHIP_DATE)}
        </Chip>
      ))}
    </div>
  );
}
