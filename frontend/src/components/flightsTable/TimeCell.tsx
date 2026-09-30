import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { dayShift } from "../../lib/dayShift";
import {
  flightActualArrival,
  flightActualDeparture,
  flightArrival,
  flightDeparture,
} from "../../lib/entityTimes";
import { clockOf, readsAsUtc, type TimeValue } from "../../shared/time";
import { useDisplayFormat } from "../../lib/displayFormat";

type DelayState = "late" | "early" | "onTime";

/** Minute-resolution comparison of two instants; seconds never appear on screen. */
const delayState = (scheduled: TimeValue, actual: TimeValue): DelayState => {
  const diff =
    Math.floor(Date.parse(actual.utc) / 60000) - Math.floor(Date.parse(scheduled.utc) / 60000);
  if (diff > 0) return "late";
  if (diff < 0) return "early";
  return "onTime";
};

const DELAY_COLOR: Record<DelayState, string> = {
  late: "var(--danger)",
  early: "var(--success)",
  onTime: "var(--text-muted)",
};

/**
 * One ab/an row pair: weekday + compact date + the airport's own clock, +N
 * overnight marker.
 *
 * Every figure comes from the flight's `times` (ADR 0002): the day and clock
 * the airport showed (`local`), in the user's format (Settings → Display) —
 * never the reader's zone. `utc` only decides "late or early". A value whose
 * airport has no known zone is the UTC reading and is labelled so.
 */
export default function TimeCell({ flight }: { flight: Flight }): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const format = useDisplayFormat();
  const departure = flightDeparture(flight);
  const arrival = flightArrival(flight);
  const shift =
    departure && arrival && clockOf(departure) && clockOf(arrival)
      ? dayShift(departure, arrival)
      : 0;

  const row = (
    label: string,
    value: TimeValue | null,
    actual: TimeValue | null,
    marker?: number
  ) => {
    const clock = value ? clockOf(value) : null;
    const actualClock = actual ? clockOf(actual) : null;
    return (
      // Monospace, not just tabular-nums: the weekday abbreviations ("Mi" vs
      // "Fr") differ in width in a proportional face, which shifted the row.
      // The values wrap as a group beside the label: planned + actual time plus
      // the UTC and +1 markers are wider than any sane column minimum
      // (CT106 design-6 R03).
      <div
        className="flex items-baseline gap-2 font-mono text-[12.5px]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <span className="w-4 shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        {value ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 whitespace-nowrap">
            <span style={{ color: "var(--text-primary)" }}>
              {format.timeValue(value, { dateOnly: true, weekday: true, shortYear: true })}
            </span>
            {clock && (
              <span style={{ color: "var(--text-muted)" }}>{format.localClock(clock)}</span>
            )}
            {/* The recorded time, beside the planned one rather than replacing
                it — the point is the difference between the two, both on the
                same airport's clock. */}
            {clock && actual && actualClock && (
              <span
                data-delay={delayState(value, actual)}
                className="font-semibold"
                style={{ color: DELAY_COLOR[delayState(value, actual)] }}
                title={t("flights:actualTimes.label")}
              >
                {format.localClock(actualClock)}
              </span>
            )}
            {/* Without an airport zone the clock above is UTC. Rendered bare it
                read as a confident local time. */}
            {clock && readsAsUtc(value) && (
              <span
                className="text-[9px] font-semibold tracking-wide"
                style={{ color: "var(--text-muted)", opacity: 0.8 }}
                title={t("flights:table.timeUtcFallback")}
              >
                UTC
              </span>
            )}
            {marker !== undefined && marker >= 1 && (
              <span className="text-[10px] font-semibold" style={{ color: "var(--accent)" }}>
                +{marker}
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-0.5">
      {row(t("flights:table.timeDep"), departure, flightActualDeparture(flight))}
      {row(t("flights:table.timeArr"), arrival, flightActualArrival(flight), shift)}
    </div>
  );
}
