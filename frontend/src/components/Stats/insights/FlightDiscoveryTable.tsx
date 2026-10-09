import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import InsightHelp, { InsightHeading } from "./InsightHelp";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightInsightYear } from "../../../types/flightInsights";

/**
 * Discovery rate and network growth per year (forgejo#256), newest year first.
 * Each "new" and "again" count opens the flights behind it; the rate is the
 * quotient of two figures on the same row and opens nothing of its own.
 */
export default function FlightDiscoveryTable({
  years,
}: {
  years: readonly FlightInsightYear[];
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const cell = "px-2 py-1 text-right tabular-nums";
  const head = "px-2 py-1 text-right font-medium";

  return (
    <div className={`${STAT_CARD_CLASS} mt-6`} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="insights-discovery"
        title={t("stats:insights.discovery.title")}
        topic="discovery"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-labelledby="insights-discovery">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr>
              <th className="px-2 py-1 text-left font-medium">
                {t("stats:insights.discovery.year")}
              </th>
              <th className={head}>{t("stats:insights.discovery.flights")}</th>
              <th className={head}>{t("stats:insights.discovery.airportsUsed")}</th>
              <th className={head}>{t("stats:insights.discovery.newAirports")}</th>
              <th className={head}>{t("stats:insights.discovery.rate")}</th>
              <th className={head}>
                <span className="inline-flex items-center gap-1">
                  {t("stats:insights.discovery.newConnections")}
                  <InsightHelp topic="routes" />
                </span>
              </th>
              <th className={head}>{t("stats:insights.discovery.repeatedConnections")}</th>
            </tr>
          </thead>
          <tbody>
            {[...years].reverse().map((y) => {
              const scope = { period: "year" as const, year: y.year };
              return (
                <tr
                  key={y.year}
                  className="border-t"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    {y.year}
                  </th>
                  <td className={cell}>{fmt.num(y.flights)}</td>
                  <td className={cell}>{fmt.num(y.airportsUsed)}</td>
                  <td className={cell}>
                    <EvidenceCount
                      evidenceKey="flightNewAirportsCount"
                      scope={scope}
                      value={y.newAirports.length}
                      label={`${t("stats:insights.discovery.newAirports")} ${y.year}`}
                    />
                  </td>
                  <td className={cell}>
                    {y.discoveryRate === null ? "—" : fmt.pct(y.discoveryRate)}
                  </td>
                  <td className={cell}>
                    <EvidenceCount
                      evidenceKey="flightNewConnectionsCount"
                      scope={scope}
                      value={y.newConnections.length}
                      label={`${t("stats:insights.discovery.newConnections")} ${y.year}`}
                    />
                  </td>
                  <td className={cell}>
                    <EvidenceCount
                      evidenceKey="flightRepeatedConnectionsCount"
                      scope={scope}
                      value={y.repeatedConnections.length}
                      label={`${t("stats:insights.discovery.repeatedConnections")} ${y.year}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
