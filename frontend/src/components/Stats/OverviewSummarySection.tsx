import { useEffect, useState } from "react";
import { statsApi, type CruiseStatsResponse } from "../../lib/api/stats";
import { achievementsApi } from "../../lib/api/achievements";
import type { AchievementSummary } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface OverviewSummarySectionProps {
  /** Flight count from the parent page (already loaded). */
  flightCount: number;
}

/**
 * Cross-domain summary cards for the "Gesamt" tab of the StatsPage.
 * Pulls cruise KPIs from /stats/cruise and achievement points from
 * /achievements, combines them with the flight data passed from the
 * parent, and renders four headline numbers that describe the user's
 * overall travel footprint — not a specific domain.
 *
 * Lightweight on purpose: no new backend endpoint yet. A dedicated
 * /stats/overview aggregator lands if/when we need server-side
 * filtering (year range, category scope).
 */
export default function OverviewSummarySection({
  flightCount,
}: OverviewSummarySectionProps): JSX.Element | null {
  const { t } = useTranslation(["stats", "common"]);
  const [cruise, setCruise] = useState<CruiseStatsResponse | null>(null);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [flightCountries, setFlightCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // True when ALL three fetches failed — partial failure still renders
  // the cards with whatever loaded, total failure swaps in a banner so
  // users don't mistake "auth expired" or "backend down" for "user has
  // zero travel data".
  const [totalFailure, setTotalFailure] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [c, a, fc] = await Promise.all([
          statsApi.getCruiseStats().catch((err) => {
            logger.warn("Cruise stats unavailable for overview:", err);
            return null;
          }),
          achievementsApi.getAll().catch((err) => {
            logger.warn("Achievement summary unavailable for overview:", err);
            return null;
          }),
          statsApi.getCountryStats().catch((err) => {
            logger.warn("Country stats unavailable for overview:", err);
            return null;
          }),
        ]);
        if (!cancelled) {
          setCruise(c);
          setSummary(a?.summary ?? null);
          setFlightCountries(fc?.countries.map((x) => x.country) ?? []);
          setTotalFailure(c === null && a === null && fc === null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  if (totalFailure) {
    return (
      <div
        className="rounded-lg p-4 mb-8 text-sm"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--danger)",
          color: "var(--danger)",
        }}
      >
        {t("stats:overview2.loadError")}
      </div>
    );
  }

  const cruiseCount = cruise?.cruisesCount ?? 0;
  const totalExperiences = flightCount + cruiseCount;
  const combinedCountries = new Set<string>(flightCountries);
  (cruise?.countries ?? []).forEach((c) => combinedCountries.add(c));
  const totalPoints = summary?.totalPoints ?? 0;
  const unlockedAchievements = summary?.unlockedAchievements ?? 0;

  const cards: Array<{ label: string; value: string | number; hint?: string }> = [
    {
      label: t("stats:overview2.experiences"),
      value: totalExperiences,
      hint: t("stats:overview2.experiencesHint", {
        flights: flightCount,
        cruises: cruiseCount,
      }),
    },
    {
      label: t("stats:overview2.countries"),
      value: combinedCountries.size,
    },
    {
      label: t("stats:overview2.points"),
      value: totalPoints,
      hint:
        unlockedAchievements > 0
          ? t("stats:overview2.pointsHint", { count: unlockedAchievements })
          : undefined,
    },
    {
      label: t("stats:overview2.cruiseSeaDays"),
      value: cruise?.seaDays ?? 0,
    },
  ];

  return (
    <div className="mb-8">
      <div
        className="flex items-baseline gap-3 mb-3 mt-2"
        style={{
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "8px",
        }}
      >
        <span
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          {t("stats:overview2.sectionLabel")}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("stats:overview2.sectionHint")}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg shadow p-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
              {card.label}
            </h3>
            <p
              className="text-3xl font-bold mt-2 font-mono"
              style={{ color: "var(--text-primary)" }}
            >
              {card.value}
            </p>
            {card.hint && (
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {card.hint}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
