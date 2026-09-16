import { useEffect, useState } from "react";
import type { JSX } from "react";
import { getLodgingStats } from "../../lib/api/lodging";
import type { LodgingStats } from "../../types/lodging";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { LodgingStatStrip } from "../Dashboard/tabs/lodging/LodgingStatStrip";
import { LodgingCurrencyBreakdown } from "../Dashboard/tabs/lodging/LodgingCurrencyBreakdown";
import LodgingMoneySection from "./lodging/LodgingMoneySection";
import LodgingQualitySection from "./lodging/LodgingQualitySection";
import LodgingGeoSection from "./lodging/LodgingGeoSection";
import LodgingRhythmSection from "./lodging/LodgingRhythmSection";
import LodgingLoyaltySection from "./lodging/LodgingLoyaltySection";
import LodgingRecordsSection from "./lodging/LodgingRecordsSection";
import PeriodComparisonStrip from "./PeriodComparisonStrip";
import { dimWhile, sameScope, type PeriodScope } from "./useStatsPeriod";
import type { SectionVisibility } from "../../hooks/useSectionVisibility";

/**
 * The lodging numbers, on the statistics page where numbers belong.
 *
 * They used to float over the dashboard map: how many hotels, how many nights,
 * what was spent and in which currencies. None of that describes what the map
 * is showing — it is a summary of the whole collection — and it covered the
 * part of the world the user opened the map to look at.
 *
 * The two components are reused exactly as they were rather than rewritten, so
 * this is a move, not a second implementation that could drift from the first.
 *
 * Scoped to the page's period by the SERVER (`?year=`, by check-in), so every
 * block below answers for the same year without knowing there is one. A
 * comparison is a second request rather than a second shape (ADR 0001).
 */
export default function LodgingStatsSection({
  scope,
  visibility,
}: {
  scope: PeriodScope;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t } = useTranslation(["dashboard", "lodging", "stats", "common"]);
  const { year, compareYear } = scope;
  const [stats, setStats] = useState<LodgingStats | null>(null);
  const [previous, setPrevious] = useState<LodgingStats | null>(null);
  const [loadedFor, setLoadedFor] = useState<PeriodScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Earlier figures stay on screen while the next year loads; blanking
        // the tab on every pill click reads as "nothing there" for a moment.
        const [data, before] = await Promise.all([
          getLodgingStats(year === null ? undefined : { year }),
          compareYear === null ? Promise.resolve(null) : getLodgingStats({ year: compareYear }),
        ]);
        if (cancelled) return;
        setStats(data);
        setPrevious(before);
        setLoadedFor({ year, compareYear });
        setError(null);
      } catch (err) {
        logger.error("LodgingStatsSection: stats fetch failed", err);
        if (!cancelled) setError(t("lodging:list.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [t, year, compareYear]);

  if (loading) {
    return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  }
  if (error) {
    return <p className="text-sm text-(--text-muted)">{error}</p>;
  }

  // What is on screen was loaded for `shown`, which lags `scope` while the next
  // year is on its way. Every label below reads `shown`; see `sameScope`.
  const shown = loadedFor ?? scope;
  const refreshing = !sameScope(loadedFor, scope);

  const comparison =
    stats && previous && shown.year !== null && shown.compareYear !== null ? (
      <PeriodComparisonStrip
        year={shown.year}
        compareYear={shown.compareYear}
        rows={[
          {
            key: "stays",
            label: t("dashboard:lodgingTab.stats.stays"),
            current: stats.staysCount,
            previous: previous.staysCount,
          },
          {
            key: "nights",
            label: t("dashboard:lodgingTab.stats.nights"),
            current: stats.totalNights,
            previous: previous.totalNights,
          },
          {
            key: "houses",
            label: t("dashboard:lodgingTab.stats.hotels"),
            current: stats.lodgingsCount,
            previous: previous.lodgingsCount,
          },
          {
            key: "countries",
            label: t("stats:sections.countries"),
            current: stats.countriesCount,
            previous: previous.countriesCount,
          },
        ]}
      />
    ) : null;

  // Under a year the house list follows the stays, so "no stays" is the test —
  // and the sentence must name the year, not claim there are no stays at all.
  if (!stats || (shown.year === null ? stats.lodgingsCount === 0 : stats.staysCount === 0)) {
    return (
      <div className="flex flex-col gap-4" aria-busy={refreshing} style={dimWhile(refreshing)}>
        {comparison}
        <p className="text-sm text-(--text-muted)">
          {shown.year === null
            ? t("lodging:list.empty")
            : t("stats:period.emptyYear", { year: shown.year })}
        </p>
      </div>
    );
  }

  const show = visibility.isVisible;

  return (
    <div
      className="relative flex flex-col gap-4"
      aria-busy={refreshing}
      style={dimWhile(refreshing)}
    >
      {comparison}
      {/* Both of these were built to float over the Dashboard MAP, where a
          card sitting on top is the point. On a page that flows top to bottom
          they took themselves out of the flow and covered the tiles below —
          the currency card is translucent, so the hotel names showed through
          it. The list page always passed "inline"; this one passed nothing and
          got the overlay default. */}
      {show("kpis") && <LodgingStatStrip stats={stats} variant="inline" />}
      {show("money") && <LodgingCurrencyBreakdown stats={stats} variant="inline" />}
      {show("money") && <LodgingMoneySection stats={stats} />}
      {show("quality") && <LodgingQualitySection stats={stats} />}
      {show("geo") && <LodgingGeoSection stats={stats} />}
      {show("rhythm") && <LodgingRhythmSection stats={stats} />}
      {show("loyalty") && <LodgingLoyaltySection stats={stats} />}
      {show("records") && <LodgingRecordsSection stats={stats} />}
    </div>
  );
}
