import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { computeTripInsights, type TripInsightWinner } from "../../lib/stats/tripInsights";

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

  // Same width budget as its two neighbours on the page — the heading above
  // (max-w-7xl mx-auto px-4) and the trip list below (px-4 > max-w-7xl
  // mx-auto). Without it these three tiles were the only thing on the page
  // running to the browser edge, which on a wide screen reads as a different
  // page (#271, reported against 2.6.0-rc.11).
  return (
    <div className="px-4">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
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
