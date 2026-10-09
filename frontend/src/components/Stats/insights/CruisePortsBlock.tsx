import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHelp";
import { CruiseLink, CruiseLinks } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseInsights } from "../../../types/cruiseInsights";

/**
 * New ports against ports seen again, per year and per cruise; the longest
 * pause before a port was seen again; the ports of several cruises; and
 * identical itineraries (forgejo#257). The year rows open their own year's
 * evidence, whatever the tab's year pill says — the table is per year.
 */
export default function CruisePortsBlock({
  ports,
  itineraries,
}: {
  ports: CruiseInsights["ports"];
  itineraries: CruiseInsights["repeatedItineraries"];
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const head = "px-2 py-1 text-right font-medium";
  const cell = "px-2 py-1 text-right tabular-nums";
  const reunion = ports.longestReunion;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
        <InsightHeading
          id="cruise-insights-ports"
          title={t("stats:insights.cruise.ports.title")}
          topic="cruisePorts"
        />
        <table className="w-full text-sm" aria-labelledby="cruise-insights-ports">
          <thead style={muted}>
            <tr>
              <th className="px-2 py-1 text-left font-medium">
                {t("stats:insights.discovery.year")}
              </th>
              <th className={head}>{t("stats:insights.cruise.ports.cruises")}</th>
              <th className={head}>{t("stats:insights.cruise.ports.ports")}</th>
              <th className={head}>{t("stats:insights.cruise.ports.new")}</th>
              <th className={head}>{t("stats:insights.cruise.ports.again")}</th>
            </tr>
          </thead>
          <tbody>
            {[...ports.years].reverse().map((y) => {
              const yearScope = { period: "year" as const, year: y.year };
              return (
                <tr
                  key={y.year}
                  className="border-t"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    {y.year}
                  </th>
                  <td className={cell}>{fmt.num(y.cruises)}</td>
                  <td className={cell}>{fmt.num(y.ports)}</td>
                  <td className={cell}>
                    <EvidenceCount
                      evidenceKey="cruiseNewPortsCount"
                      scope={yearScope}
                      value={y.newPorts.length}
                      label={`${t("stats:insights.cruise.ports.new")} ${y.year}`}
                    />
                  </td>
                  <td className={cell}>
                    <EvidenceCount
                      evidenceKey="cruisePortRevisitCount"
                      scope={yearScope}
                      value={y.revisitedPorts}
                      label={`${t("stats:insights.cruise.ports.again")} ${y.year}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(ports.undatedCruises > 0 || ports.unresolvedCalls > 0) && (
          <p className="mt-3 text-xs" style={muted}>
            {t("stats:insights.cruise.ports.coverage", {
              undated: fmt.num(ports.undatedCruises),
              unresolved: fmt.num(ports.unresolvedCalls),
            })}
          </p>
        )}
        <h4 className="mb-1 mt-4 text-sm font-medium">
          {t("stats:insights.cruise.ports.perCruise")}
        </h4>
        <ul className="space-y-1 text-sm">
          {ports.perCruise.map((c) => (
            <li key={c.cruise.id}>
              <CruiseLink cruise={c.cruise} />
              <span style={muted}>
                {" — "}
                {c.cruise.startDate === null
                  ? t("stats:insights.cruise.ports.undatedRow", { ports: fmt.num(c.ports) })
                  : t("stats:insights.cruise.ports.cruiseRow", {
                      ports: fmt.num(c.ports),
                      fresh: fmt.num(c.newPorts),
                      again: fmt.num(c.revisitedPorts),
                    })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
        <InsightHeading
          id="cruise-insights-reunion"
          title={t("stats:insights.cruise.reunion.title")}
          topic="cruiseReunion"
        />
        {reunion === null ? (
          <p className="text-sm" style={muted}>
            {t("stats:insights.cruise.reunion.empty")}
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-medium">{reunion.portName}</span>
            {" — "}
            {t("stats:insights.cruise.reunion.days", { count: reunion.days })}
            <span className="block text-xs" style={muted}>
              <CruiseLink cruise={reunion.fromCruise} /> ({fmt.day(reunion.fromDay)}) →{" "}
              <CruiseLink cruise={reunion.toCruise} /> ({fmt.day(reunion.toDay)})
            </span>
          </p>
        )}
        <h4 className="mb-1 mt-4 text-sm font-medium">
          {t("stats:insights.cruise.reunion.repeatPorts")}
        </h4>
        {ports.repeatPorts.length === 0 ? (
          <p className="text-sm" style={muted}>
            {t("stats:insights.cruise.reunion.noRepeatPorts")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {ports.repeatPorts.map((p) => (
              <li key={p.portId}>
                <span className="font-medium">{p.portName}</span>
                {` (${fmt.num(p.cruises.length)}×) `}
                <span style={muted}>
                  <CruiseLinks cruises={p.cruises} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <InsightHeading
            id="cruise-insights-itineraries"
            title={t("stats:insights.cruise.itineraries.title")}
            topic="cruiseItineraries"
          />
          {itineraries.length === 0 ? (
            <p className="text-sm" style={muted}>
              {t("stats:insights.cruise.itineraries.empty")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {itineraries.map((g) => (
                <li key={g.cruises.map((c) => c.id).join("|")}>
                  <span className="font-medium">{g.ports.map((p) => p.name).join(" → ")}</span>
                  <span className="block text-xs" style={muted}>
                    <CruiseLinks cruises={g.cruises} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
