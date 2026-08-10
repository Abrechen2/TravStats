import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { flightsApi, type NextFlight } from "../../lib/api/flights";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The soonest upcoming flight, pinned bottom-left of the dashboard map (#1).
 *
 * The upcoming trip is the most emotional datum in a travel logbook and was
 * previously invisible — the data existed (scheduled flights) but nothing
 * surfaced it. Self-fetching and self-hiding: renders nothing when there is
 * no flight ahead, so it never competes with the empty state.
 */
export function NextFlightCard(): JSX.Element | null {
  const { t, i18n } = useTranslation(["dashboard", "flights"]);
  const navigate = useNavigate();
  const [flight, setFlight] = useState<NextFlight | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    flightsApi
      .getNext()
      .then((f) => {
        if (!cancelled) {
          setFlight(f);
          setLoaded(true);
        }
      })
      .catch((err) => {
        logger.error("Failed to load next flight", err);
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !flight || !flight.departureTime) return null;

  const dep = new Date(flight.departureTime);
  const now = new Date();
  const msAhead = dep.getTime() - now.getTime();
  const daysAhead = Math.floor(msAhead / 86_400_000);
  const hoursAhead = Math.floor(msAhead / 3_600_000);

  // Glanceable countdown: days when far out, hours on the last day, "today"
  // inside it. Not minute-precise on purpose — the block is a heads-up, and
  // being exact would demand the airport's timezone the card does not resolve.
  const countdown =
    daysAhead >= 1
      ? t("dashboard:nextFlight.inDays", { count: daysAhead })
      : hoursAhead >= 1
        ? t("dashboard:nextFlight.inHours", { count: hoursAhead })
        : t("dashboard:nextFlight.today");

  const dateLabel = dep.toLocaleDateString(i18n.language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const endLabel = (iata: string | null, city: string | null): string =>
    city ? `${city} (${iata ?? "—"})` : (iata ?? "—");

  const carrier = [flight.airlineIata ?? flight.airline, flight.flightNumber]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={() => navigate(flight.tripId ? `/trips/${flight.tripId}` : "/flights")}
      className="absolute bottom-4 left-4 z-20 max-w-xs cursor-pointer rounded-xl p-4 text-left transition-opacity hover:opacity-95"
      style={{
        background: "rgba(28, 33, 40, 0.92)",
        border: "1px solid var(--color-border)",
        borderLeft: "3px solid var(--accent)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: "var(--accent)" }}
      >
        {t("dashboard:nextFlight.label")} · {countdown}
      </div>
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {endLabel(flight.depIata, flight.departure.city)} →{" "}
        {endLabel(flight.arrIata, flight.arrival.city)}
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {dateLabel}
        {carrier ? ` · ${carrier}` : ""}
      </div>
    </button>
  );
}
