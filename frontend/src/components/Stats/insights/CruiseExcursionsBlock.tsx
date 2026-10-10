import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHeading";
import { CruiseLink } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseInsights } from "../../../types/cruiseInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

/**
 * Shore excursions per cruise (forgejo#257) from excursion notes and the day
 * tours linked to a port call. A cruise with nothing documented reads "nothing
 * documented", never "0 excursions"; distance and climb appear only where a
 * tour measured them, recorded and planned kilometres apart; tours are not
 * mentioned at all while they are hidden.
 */
export default function CruiseExcursionsBlock({
  excursions,
  scope,
}: {
  excursions: CruiseInsights["excursions"];
  scope: EvidenceScopeParams;
}): JSX.Element {
  const { t } = useTranslation(["stats", "roadtrips"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const km = (value: number): string => `${fmt.num(Math.round(value * 10) / 10)} km`;

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="cruise-insights-excursions"
        title={t("stats:insights.cruise.excursions.title")}
        topic={excursions.toursVisible ? "cruiseExcursions" : "cruiseExcursionsNotes"}
      />
      {excursions.documentedCalls === 0 ? (
        <p className="mb-3 text-sm" style={muted}>
          {excursions.toursVisible
            ? t("stats:insights.cruise.excursions.empty", { km: excursions.linkRuleKm })
            : t("stats:insights.cruise.excursions.emptyNotesOnly")}
        </p>
      ) : (
        <p className="mb-3 text-sm">
          <EvidenceCount
            evidenceKey="cruiseDocumentedExcursionCount"
            scope={scope}
            value={excursions.documentedCalls}
            label={t("stats:insights.cruise.excursions.title")}
          >
            {t("stats:insights.cruise.excursions.summary", {
              calls: fmt.num(excursions.documentedCalls),
              ports: fmt.num(excursions.portsWithExcursions),
              cruises: fmt.num(excursions.cruisesWithExcursions),
            })}
          </EvidenceCount>
        </p>
      )}
      <ul className="space-y-2 text-sm">
        {excursions.perCruise.map((c) => (
          <li key={c.cruise.id}>
            <CruiseLink cruise={c.cruise} />
            <span style={muted}>
              {" — "}
              {c.documentedCalls === 0
                ? t("stats:insights.cruise.excursions.noneDocumented")
                : t("stats:insights.cruise.excursions.cruiseRow", {
                    documented: fmt.num(c.documentedCalls),
                    calls: fmt.num(c.calls),
                    notes: fmt.num(c.notedCalls),
                    tours: fmt.num(c.tours?.length ?? 0),
                  })}
            </span>
            {c.tours !== null && c.tours.length > 0 && (
              <span className="block text-xs" style={muted}>
                {Object.entries(c.activities ?? {})
                  .map(([activity, n]) =>
                    activity === "unspecified"
                      ? `${t("stats:insights.cruise.excursions.unspecified")} ${n}`
                      : `${t(`roadtrips:activity.${activity}`)} ${n}`
                  )
                  .join(" · ")}
                {c.onFootRecordedKm !== null &&
                  ` · ${t("stats:insights.cruise.excursions.onFootRecorded", { km: km(c.onFootRecordedKm) })}`}
                {c.recordedKm !== null &&
                  c.recordedKm !== c.onFootRecordedKm &&
                  ` · ${t("stats:insights.cruise.excursions.recorded", { km: km(c.recordedKm) })}`}
                {c.plannedKm !== null &&
                  ` · ${t("stats:insights.cruise.excursions.planned", { km: km(c.plannedKm) })}`}
                {c.ascentM !== null &&
                  ` · ${t("stats:insights.cruise.excursions.ascent", { m: fmt.num(Math.round(c.ascentM)) })}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
