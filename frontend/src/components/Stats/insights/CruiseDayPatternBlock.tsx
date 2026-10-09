import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHelp";
import { CruiseLink } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseInsights } from "../../../types/cruiseInsights";

/**
 * Sea days against port days (forgejo#257): the kind of cruise each one was,
 * and how that changed per year. Days the stop list does not name are said,
 * not guessed.
 */
export default function CruiseDayPatternBlock({
  pattern,
}: {
  pattern: CruiseInsights["dayPattern"];
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const head = "px-2 py-1 text-right font-medium";
  const cell = "px-2 py-1 text-right tabular-nums";

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="cruise-insights-days"
        title={t("stats:insights.cruise.days.title")}
        topic="cruiseDays"
      />
      <table className="w-full text-sm" aria-labelledby="cruise-insights-days">
        <thead style={muted}>
          <tr>
            <th className="px-2 py-1 text-left font-medium">
              {t("stats:insights.discovery.year")}
            </th>
            <th className={head}>{t("stats:insights.cruise.days.seaDays")}</th>
            <th className={head}>{t("stats:insights.cruise.days.portDays")}</th>
            <th className={head}>{t("stats:insights.cruise.days.types")}</th>
          </tr>
        </thead>
        <tbody>
          {[...pattern.years].reverse().map((y) => (
            <tr key={y.year} className="border-t" style={{ borderColor: "var(--color-border)" }}>
              <th scope="row" className="px-2 py-1 text-left font-medium">
                {y.year}
              </th>
              <td className={cell}>{fmt.num(y.seaDays)}</td>
              <td className={cell}>
                <EvidenceCount
                  evidenceKey="cruisePortDaysTotal"
                  scope={{ period: "year", year: y.year }}
                  value={y.portDays}
                  label={`${t("stats:insights.cruise.days.portDays")} ${y.year}`}
                />
              </td>
              <td className={`${cell} text-xs`}>
                {t("stats:insights.cruise.days.typeCounts", {
                  seaHeavy: y.seaHeavy,
                  balanced: y.balanced,
                  portIntensive: y.portIntensive,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-4 space-y-1 text-sm">
        {pattern.perCruise.map((c) => (
          <li key={c.cruise.id}>
            <CruiseLink cruise={c.cruise} />
            <span style={muted}>
              {" — "}
              {c.type === null
                ? t("stats:insights.cruise.days.unclassified")
                : t(`stats:insights.cruise.days.typeNames.${c.type}`)}
              {" · "}
              {t("stats:insights.cruise.days.row", {
                sea: fmt.num(c.seaDays),
                port: fmt.num(c.portDays),
              })}
              {c.unlistedDays !== null &&
                c.unlistedDays > 0 &&
                ` · ${t("stats:insights.cruise.days.unlisted", { days: fmt.num(c.unlistedDays) })}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
