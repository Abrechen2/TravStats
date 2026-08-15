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
 */
export default function LodgingStatsSection(): JSX.Element {
  const { t } = useTranslation(["dashboard", "lodging", "common"]);
  const [stats, setStats] = useState<LodgingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getLodgingStats();
        if (!cancelled) setStats(data);
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
  }, [t]);

  if (loading) {
    return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  }
  if (error) {
    return <p className="text-sm text-(--text-muted)">{error}</p>;
  }
  if (!stats || stats.lodgingsCount === 0) {
    return <p className="text-sm text-(--text-muted)">{t("lodging:list.empty")}</p>;
  }

  return (
    <div className="relative flex flex-col gap-4">
      <LodgingStatStrip stats={stats} />
      <LodgingCurrencyBreakdown stats={stats} />
      <LodgingMoneySection stats={stats} />
      <LodgingQualitySection stats={stats} />
      <LodgingGeoSection stats={stats} />
      <LodgingRhythmSection stats={stats} />
    </div>
  );
}
