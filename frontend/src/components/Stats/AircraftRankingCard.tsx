import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../lib/format";
import { useTranslation } from "../../hooks/useTranslation";
import CountingHelp from "./counting/CountingHelp";
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
  const [showAll, setShowAll] = useState(false);

  if (data === undefined) {
    return <p className="text-sm text-gray-500">{t("stats:aircraftRanking.loading")}</p>;
  }

  const all = data === null ? [] : data.aircraft;
  const aircraft = showAll ? all : all.slice(0, MAX_ROWS);
  const withoutRegistration = data?.withoutRegistration ?? 0;
  if (aircraft.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t("stats:aircraftRanking.title")}</h3>
        <p className="text-sm text-gray-500">{t("stats:aircraftRanking.noData")}</p>
        {withoutRegistration > 0 && (
          <p className="text-xs text-gray-500" data-testid="aircraft-unregistered">
            {t("stats:aircraftRanking.withoutRegistration", { count: withoutRegistration })}
          </p>
        )}
        <p className="text-xs text-gray-400">{t("stats:aircraftRanking.hint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:aircraftRanking.title")}</h3>
      <p className="text-sm" data-testid="aircraft-distinct">
        {t("stats:aircraftRanking.distinct", { count: all.length })}
      </p>
      {withoutRegistration > 0 && (
        <p className="text-xs text-gray-500" data-testid="aircraft-unregistered">
          {t("stats:aircraftRanking.withoutRegistration", { count: withoutRegistration })}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="aircraft-table">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-3 font-medium">
                {t("stats:aircraftRanking.col.registration")}
              </th>
              <th className="py-1 pr-3 font-medium">{t("stats:aircraftRanking.col.type")}</th>
              <th className="py-1 pr-3 font-medium">{t("stats:aircraftRanking.col.airline")}</th>
              <th className="py-1 pr-3 text-right font-medium">
                {t("stats:aircraftRanking.col.flights")}
              </th>
              <th className="py-1 pr-3 font-medium">{t("stats:aircraftRanking.col.first")}</th>
              <th className="py-1 font-medium">{t("stats:aircraftRanking.col.last")}</th>
            </tr>
          </thead>
          <tbody>
            {aircraft.map((row) => (
              <tr key={row.registration} className="border-t border-(--border)">
                <td className="py-1.5 pr-3 font-mono">
                  <Link
                    to={`/aircraft/${encodeURIComponent(row.registration)}`}
                    // The hull's own page lists its flights — this row's evidence.
                    data-stat-figure
                    className="hover:underline"
                  >
                    {row.registration}
                  </Link>
                </td>
                <td className="py-1.5 pr-3">{row.aircraft ?? "—"}</td>
                <td className="py-1.5 pr-3">{row.airline ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right font-semibold">{row.count}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {row.firstFlightDate ? formatDate(row.firstFlightDate) || "—" : "—"}
                </td>
                <td className="py-1.5 whitespace-nowrap">
                  {row.lastFlightDate ? formatDate(row.lastFlightDate) || "—" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > MAX_ROWS && (
        <button
          type="button"
          className="text-sm text-(--accent) hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? t("stats:aircraftRanking.showLess")
            : t("stats:aircraftRanking.showAll", { count: all.length })}
        </button>
      )}
      <CountingHelp
        testId="aircraft-counting-help"
        entries={[
          { term: t("stats:aircraftRanking.title"), helpKey: "flightStatsHelp:rankings.aircraft" },
        ]}
      />
    </div>
  );
}
