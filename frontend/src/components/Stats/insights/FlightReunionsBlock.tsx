import type { JSX } from "react";
import { Link } from "react-router-dom";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import { InsightHeading } from "./InsightHeading";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightInsights, FlightReunion } from "../../../types/flightInsights";

/**
 * "Long time no see" and the airports used in every quarter of a year
 * (forgejo#256). Both are extremes rather than counts, so each row links the
 * flights that prove it instead of opening the evidence panel, which serves
 * sums and distinct counts only.
 */
export default function FlightReunionsBlock({
  reunions,
  quarterAirports,
  nameOf,
}: {
  reunions: readonly FlightReunion[];
  quarterAirports: FlightInsights["quarterAirports"];
  nameOf: (code: string) => string;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
        <InsightHeading
          id="insights-reunions"
          title={t("stats:insights.reunions.title")}
          topic="reunions"
        />
        {reunions.length === 0 ? (
          <p className="text-sm" style={muted}>
            {t("stats:insights.reunions.empty")}
          </p>
        ) : (
          <ol className="space-y-2 text-sm">
            {reunions.map((r) => (
              <li key={r.airport}>
                <span className="font-medium">{nameOf(r.airport)}</span>
                {" — "}
                {r.years > 0
                  ? t("stats:insights.reunions.years", { count: r.years })
                  : t("stats:insights.reunions.days", { count: r.days })}
                <div className="text-xs" style={muted}>
                  <Link to={`/flights/${r.fromFlightId}`} className="underline">
                    {fmt.day(r.fromDay)}
                  </Link>
                  {" → "}
                  <Link to={`/flights/${r.toFlightId}`} className="underline">
                    {fmt.day(r.toDay)}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
        <InsightHeading
          id="insights-quarters"
          title={t("stats:insights.quarters.title")}
          topic="quarters"
        />
        {quarterAirports.length === 0 ? (
          <p className="text-sm" style={muted}>
            {t("stats:insights.quarters.empty")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {quarterAirports.map((q) => (
              <li key={`${q.airport}-${q.year}`}>
                {t("stats:insights.quarters.row", { airport: nameOf(q.airport), year: q.year })}
                <div className="text-xs" style={muted}>
                  {q.visits.map((v, i) => (
                    <span key={v.quarter}>
                      {i > 0 && " · "}
                      <Link to={`/flights/${v.flightId}`} className="underline">
                        {t("stats:insights.quarters.quarter", { quarter: v.quarter })}:{" "}
                        {fmt.day(v.day)}
                      </Link>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
