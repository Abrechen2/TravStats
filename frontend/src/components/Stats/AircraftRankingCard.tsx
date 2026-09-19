import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { AircraftRankingResponse } from "../../types/aircraft";

const MAX_ROWS = 10;

export interface AircraftRankingCardProps {
  /**
   * The hull ranking, loaded by the page (forgejo#49) — see the three-state
   * note on `AirlineRankingCard`: `undefined` is in flight, `null` is a load
   * that finished and brought nothing.
   */
  aircraft: AircraftRankingResponse | null | undefined;
}

export default function AircraftRankingCard({
  aircraft: data,
}: AircraftRankingCardProps): JSX.Element {
  const { t } = useTranslation("stats");

  if (data === undefined) {
    return <p className="text-sm text-gray-500">{t("stats:aircraftRanking.loading")}</p>;
  }

  const aircraft = data === null ? [] : data.aircraft.slice(0, MAX_ROWS);
  if (aircraft.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t("stats:aircraftRanking.title")}</h3>
        <p className="text-sm text-gray-500">{t("stats:aircraftRanking.noData")}</p>
        <p className="text-xs text-gray-400">{t("stats:aircraftRanking.hint")}</p>
      </div>
    );
  }

  const maxCount = aircraft[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:aircraftRanking.title")}</h3>
      <p className="text-xs text-gray-500 mb-2">
        {t("stats:aircraftRanking.topN", { n: aircraft.length })}
      </p>
      <div className="space-y-1.5">
        {aircraft.map((row) => (
          <Link
            key={row.registration}
            to={`/aircraft/${encodeURIComponent(row.registration)}`}
            className="flex items-center gap-3 group"
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
            <span
              className="w-28 text-sm font-mono truncate group-hover:underline"
              title={row.aircraft ?? row.airline ?? row.registration}
            >
              {row.registration}
            </span>
            <span className="w-10 text-right text-sm font-semibold">{row.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
