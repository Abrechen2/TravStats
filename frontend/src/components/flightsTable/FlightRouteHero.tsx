import type { JSX } from "react";
import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightDuration } from "../../lib/flightDuration";
import { formatDurationWithEstimate } from "../../lib/formatters";
import { Icon } from "../ui/Icon";

/** HH:MM on the airport's clock. */
function clock(iso: string | null | undefined, tz: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz || "UTC",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function End({
  code,
  name,
  planned,
  actual,
  align,
}: {
  code: string;
  name?: string;
  planned: string | null;
  actual: string | null;
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
        planned={clock(flight.departureTime, flight.depTimezone)}
        actual={clock(flight.actualDeparture, flight.depTimezone)}
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
        planned={clock(flight.arrivalTime, flight.arrTimezone)}
        actual={clock(flight.actualArrival, flight.arrTimezone)}
        align="end"
      />
    </div>
  );
}
