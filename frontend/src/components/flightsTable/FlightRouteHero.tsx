import type { JSX } from "react";
import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightDuration } from "../../lib/flightDuration";
import { formatDurationWithEstimate } from "../../lib/formatters";
import { Icon } from "../ui/Icon";
import YourTimeHint from "../time/YourTimeHint";
import {
  flightActualArrival,
  flightActualDeparture,
  flightArrival,
  flightDeparture,
} from "../../lib/entityTimes";
import { formatLocalClock } from "../../lib/displayFormat";
import { clockOf, readsAsUtc, type TimeValue } from "../../shared/time";

/** HH:MM on the airport's clock — the server's `local` — "UTC" where it has no zone. */
function clock(value: TimeValue | null): string | null {
  const hhmm = value ? clockOf(value) : null;
  if (!value || !hhmm) return null;
  return `${formatLocalClock(hhmm)}${readsAsUtc(value) ? " UTC" : ""}`;
}

function End({
  code,
  name,
  planned,
  actual,
  hintFor,
  align,
}: {
  code: string;
  name?: string;
  planned: string | null;
  actual: string | null;
  /** The value the "your time" hint reads (Q2). */
  hintFor: TimeValue | null;
  align: "start" | "end";
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const shown = actual ?? planned;
  return (
    <div
      className="flex min-w-0 flex-col"
      style={{ gap: 2, alignItems: align === "end" ? "flex-end" : "flex-start" }}
    >
      <span
        style={{
          fontFamily: "var(--ts-font-mono)",
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1,
          color: "var(--ts-text-bright)",
        }}
      >
        {code}
      </span>
      {name ? (
        <span className="max-w-full truncate" style={{ fontSize: 13, fontWeight: 600 }}>
          {name}
        </span>
      ) : null}
      {shown ? (
        <span style={{ fontFamily: "var(--ts-font-mono)", fontSize: 14, marginTop: 6 }}>
          {shown}
          {/* The plan only when the recorded time differs from it. */}
          {actual && planned && actual !== planned ? (
            <span className="t-caption" style={{ marginLeft: 6 }}>
              {t("flights:detail.planned")} {planned}
            </span>
          ) : null}
        </span>
      ) : null}
      <YourTimeHint value={hintFor} />
    </div>
  );
}

/**
 * The flight at a glance, inside the detail head: where from, where to, when,
 * and between them how long and how far — round 4's "Flug Detail".
 *
 * Every figure is one the flight already carries; a missing one is left out
 * rather than drawn as a zero or a dash between the two codes.
 */
export default function FlightRouteHero({
  flight,
  distance,
}: {
  flight: Flight;
  /** Already converted and labelled in the reader's unit. */
  distance: string | null;
}): JSX.Element {
  const duration = getFlightDuration(flight);
  const middle = [
    duration ? formatDurationWithEstimate(duration.minutes, duration.estimated) : null,
    distance,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: "var(--ts-space-lg)" }}
    >
      <End
        code={flight.depIata || flight.depIcao || "—"}
        name={flight.depName}
        planned={clock(flightDeparture(flight))}
        actual={clock(flightActualDeparture(flight))}
        hintFor={flightActualDeparture(flight) ?? flightDeparture(flight)}
        align="start"
      />
      <div className="flex flex-col items-center" style={{ gap: 6, color: "var(--ts-accent)" }}>
        {middle ? (
          <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
            {middle}
          </span>
        ) : null}
        <span className="flex items-center" style={{ gap: 8 }} aria-hidden="true">
          <span style={{ width: 40, height: 2, background: "var(--ts-accent)" }} />
          <Icon name="plane" size={16} />
          <span style={{ width: 40, height: 2, background: "var(--ts-accent)" }} />
        </span>
      </div>
      <End
        code={flight.arrIata || flight.arrIcao || "—"}
        name={flight.arrName}
        planned={clock(flightArrival(flight))}
        actual={clock(flightActualArrival(flight))}
        hintFor={flightActualArrival(flight) ?? flightArrival(flight)}
        align="end"
      />
    </div>
  );
}
