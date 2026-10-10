import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHeading";
import { CruiseLinks } from "./cruiseLinks";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseEvent, CruiseInsights } from "../../../types/cruiseInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

const EVIDENCE_KEY: Record<CruiseEvent, string> = {
  equator: "cruiseEquatorCruiseCount",
  dateline: "cruiseDatelineCruiseCount",
  birthdayAtSea: "cruiseBirthdayAtSeaCruiseCount",
  newYearAtSea: "cruiseNewYearAtSeaCruiseCount",
  canal: "cruiseCanalCruiseCount",
  polar: "cruisePolarCruiseCount",
};

/**
 * The special events the badges detect, as statistics with the voyages that
 * proved them (forgejo#257). An event no cruise proved says so; the birthday
 * event without a birthday on file says what would enable it instead of "0".
 */
export default function CruiseEventsBlock({
  events,
  scope,
}: {
  events: CruiseInsights["events"];
  scope: EvidenceScopeParams;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const muted = { color: "var(--text-muted)" };
  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="cruise-insights-events"
        title={t("stats:insights.cruise.events.title")}
        topic="cruiseEvents"
      />
      <ul className="space-y-2 text-sm">
        {events.list.map(({ event, cruises }) => {
          const label = t(`stats:insights.cruise.events.names.${event}`);
          return (
            <li key={event}>
              <span className="font-medium">{label}: </span>
              {event === "birthdayAtSea" && !events.birthdayKnown ? (
                <span style={muted}>{t("stats:insights.cruise.events.noBirthday")}</span>
              ) : cruises.length === 0 ? (
                <span style={muted}>{t("stats:insights.cruise.events.none")}</span>
              ) : (
                <>
                  <EvidenceCount
                    evidenceKey={EVIDENCE_KEY[event]}
                    scope={scope}
                    value={cruises.length}
                    label={label}
                  >
                    {t("stats:insights.cruise.events.cruises", { cruises: cruises.length })}
                  </EvidenceCount>
                  <span style={muted}>
                    {" — "}
                    <CruiseLinks cruises={cruises} />
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
