import { useTranslation } from "../../hooks/useTranslation";
import type { AirlineRankingResponse } from "../../types";
import EvidenceTrigger from "./EvidenceTrigger";
import { rankingKey } from "../../shared/evidence";

const MAX_ROWS = 10;

export interface AirlineRankingCardProps {
  /**
   * The ranking, loaded by the page (forgejo#49). This card used to fetch
   * `/stats/airlines` itself, which was one of twelve requests the statistics
   * page issued for one load; it is now one section of `/stats/page`, which
   * answers nine of them from a single pass over the flight table.
   *
   * Three states, because the failure of one shared request must not read as
   * nine sections still loading: `undefined` is in flight, `null` is "the load
   * finished and brought nothing" (the page says why, once, above), and a value
   * is the ranking.
   */
  airlines: AirlineRankingResponse | null | undefined;
}

export default function AirlineRankingCard({
  airlines: data,
}: AirlineRankingCardProps): JSX.Element {
  const { t } = useTranslation("stats");

  if (data === undefined) {
    return <p className="text-sm text-gray-500">{t("stats:airlineRanking.loading")}</p>;
  }

  const airlines = data === null ? [] : data.airlines.slice(0, MAX_ROWS);
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
          <EvidenceTrigger
            key={row.airline}
            kind="ranking"
            evidenceKey={rankingKey("airline", row.key)}
            scope={{ period: "allTime" }}
            renderedValue={row.count}
            label={row.airline}
            className="flex items-center gap-3"
          >
            <div
              className="flex-1 rounded-full h-5 overflow-hidden"
              style={{ background: "var(--bg-elevated)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="w-8 text-xs font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
              {row.iata ?? ""}
            </span>
            <span className="w-28 text-sm truncate" title={row.airline}>
              {row.airline}
            </span>
            <span className="w-10 text-right text-sm font-semibold">{row.percentage}%</span>
          </EvidenceTrigger>
        ))}
      </div>
    </div>
  );
}
