import { useState, useEffect } from "react";
import { statsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import type { AirlineRankingItem } from "../../types";
import { logger } from "../../lib/logger";

const MAX_ROWS = 10;

export default function AirlineRankingCard(): JSX.Element {
  const { t } = useTranslation("stats");
  const [airlines, setAirlines] = useState<AirlineRankingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .getAirlineRanking()
      .then((data) => setAirlines(data.airlines.slice(0, MAX_ROWS)))
      .catch((err) => logger.error("Failed to load airline ranking:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">{t("stats:airlineRanking.loading")}</p>;
  }

  if (airlines.length === 0) {
    return <p className="text-sm text-gray-500">{t("stats:airlineRanking.noData")}</p>;
  }

  const maxCount = airlines[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:airlineRanking.title")}</h3>
      <p className="text-xs text-gray-500 mb-2">
        {t("stats:airlineRanking.topN", { n: airlines.length })}
      </p>
      <div className="space-y-1.5">
        {airlines.map((row) => (
          <div key={row.airline} className="flex items-center gap-3">
            <div
              className="flex-1 rounded-full h-5 overflow-hidden"
              style={{ background: "var(--bg-elevated)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%`, background: "var(--accent)" }}
              />
            </div>
            <span
              className="w-8 text-xs font-mono shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              {row.iata ?? ""}
            </span>
            <span className="w-28 text-sm truncate" title={row.airline}>
              {row.airline}
            </span>
            <span className="w-10 text-right text-sm font-semibold">{row.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
