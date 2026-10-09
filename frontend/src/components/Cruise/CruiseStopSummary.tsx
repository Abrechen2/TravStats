import type { JSX } from "react";
import type { CruiseStopInput } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { formatLocalClock, formatLocalDate } from "../../lib/displayFormat";

/** The port's wall clock of a stop time (`YYYY-MM-DDTHH:mm…`), or null. */
function clock(value: string | null | undefined): string | null {
  return value ? formatLocalClock(value.slice(0, 16)) || null : null;
}

/** What a day IS, in words: its port, a sea day, an unresolved name, or the gap. */
export function stopTitle(stop: CruiseStopInput, t: (key: string) => string): string {
  if (stop.isAtSea) return t("stops.at_sea");
  if (stop.port) return stop.port.name;
  if (stop.unresolvedPortName) return stop.unresolvedPortName;
  return t("stops.noPort");
}

/**
 * One closed day of the stops editor (forgejo#221): day of the cruise, date,
 * port and times on one line, so a long itinerary reads like the printed
 * day-by-day plan it was copied from. Times are the PORT's wall clock, shown
 * as typed (ADR 0002) — a missing time stays "–", never a guess.
 */
export function CruiseStopSummary({
  stop,
  open,
}: {
  stop: CruiseStopInput;
  open: boolean;
}): JSX.Element {
  const { t } = useTranslation("cruise");
  const date = stop.date ? formatLocalDate(stop.date.slice(0, 10)) : null;
  const arrive = clock(stop.arrivalTime);
  const depart = clock(stop.departureTime);
  const unresolved = !stop.isAtSea && stop.portId == null && Boolean(stop.unresolvedPortName);
  const missing = !stop.isAtSea && stop.portId == null && !stop.unresolvedPortName;
  return (
    <>
      <span aria-hidden="true" className="text-(--text-muted)">
        {open ? "▾" : "▸"}
      </span>
      <span className="w-14 shrink-0 font-mono text-xs text-(--text-muted)">
        {t("stops.day")} {stop.dayNumber}
      </span>
      {date && <span className="shrink-0 text-xs text-(--text-muted)">{date}</span>}
      <span
        className={`min-w-0 flex-1 truncate font-medium ${
          missing
            ? "text-(--danger)"
            : stop.isAtSea
              ? "text-(--text-muted)"
              : "text-(--text-primary)"
        }`}
      >
        {unresolved && <span aria-hidden="true">🔶 </span>}
        {stopTitle(stop, t)}
        {unresolved && <span className="sr-only"> ({t("stops.unresolved")})</span>}
      </span>
      {(arrive || depart) && (
        <span className="shrink-0 font-mono text-xs text-(--text-muted)">
          {arrive ?? "–"}–{depart ?? "–"}
        </span>
      )}
      {stop.excursionNote?.trim() ? (
        <span className="shrink-0 text-xs text-(--text-muted)">· {t("stops.hasExcursion")}</span>
      ) : null}
    </>
  );
}
