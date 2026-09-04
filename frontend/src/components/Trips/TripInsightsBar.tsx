import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { computeTripInsights, type TripInsightWinner } from "../../lib/stats/tripInsights";
import { TRIP_GRID_CLASS } from "./tripGrid";

/**
 * Trip-level insights (#3): the standout trips across the whole logbook —
 * longest, most expensive, most countries. The trip is the cross-domain
 * bracket, but it was only ever shown as a per-trip sum; this answers "which
 * trip was the biggest" at a glance. Reuses the same cost model as the cards.
 *
 * Renders nothing until at least one metric has a winner, so a fresh or
 * single-trivial-trip account never shows an empty strip.
 */
export function TripInsightsBar({ trips }: { trips: Trip[] }): JSX.Element | null {
  const { t, i18n } = useTranslation(["trips"]);
  const navigate = useNavigate();
  const insights = computeTripInsights(trips, i18n.language ?? "de");

  const tiles: Array<{ key: string; label: string; win: TripInsightWinner | null }> = [
    { key: "longest", label: t("trips:insights.longest"), win: insights.longest },
    { key: "mostExpensive", label: t("trips:insights.mostExpensive"), win: insights.mostExpensive },
    { key: "mostCountries", label: t("trips:insights.mostCountries"), win: insights.mostCountries },
  ];

  if (tiles.every((tile) => tile.win === null)) return null;

  // The SAME grid as the trip cards below, not merely the same width budget:
  // identical breakpoints (1 → md:2 → lg:3) and identical gap, so the column
  // edges line up down the page at every size. With its own `sm:grid-cols-3
  // gap-3` the tiles were three-across while the cards below were still one,
  // and even at full width the right edge missed theirs by 3 px.
  //
  // The width budget itself is the other half of #271: without it these tiles
  // were the only thing on the page running to the browser edge.
  return (
    <div className="px-4">
      <div className={`max-w-7xl mx-auto ${TRIP_GRID_CLASS} mb-6`}>
        {tiles.map(({ key, label, win }) =>
          win ? (
            <button
              key={key}
              type="button"
              onClick={() => navigate(`/trips/${win.tripId}`)}
              className="cursor-pointer rounded-xl p-4 text-left transition-opacity hover:opacity-90"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <div
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
              </div>
              <div className="text-lg font-semibold mt-1" style={{ color: "var(--accent)" }}>
                {win.value}
              </div>
              <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                {win.name}
              </div>
            </button>
          ) : (
            <div
              key={key}
              className="rounded-xl p-4"
              style={{ background: "var(--bg-surface)", border: "1px dashed var(--color-border)" }}
            >
              <div
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
              </div>
              <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                —
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
