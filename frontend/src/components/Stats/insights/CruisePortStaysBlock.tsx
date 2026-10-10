import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHeading";
import { CruiseLink } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseInsights, PortStay } from "../../../types/cruiseInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

/**
 * Time in port (forgejo#257): the average over the calls whose arrival and
 * departure are both known to the minute, and the longest and shortest call.
 * The calls without times are named, not averaged in as zero.
 */
export default function CruisePortStaysBlock({
  stays,
  scope,
}: {
  stays: CruiseInsights["portStays"];
  scope: EvidenceScopeParams;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const stay = (label: string, s: PortStay): JSX.Element => (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd style={muted}>
        {fmt.duration(s.minutes)} · {s.portName}
        {s.day && ` (${fmt.day(s.day)})`} · <CruiseLink cruise={s.cruise} />
      </dd>
    </div>
  );

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="cruise-insights-stays"
        title={t("stats:insights.cruise.stays.title")}
        topic="cruiseStays"
      />
      {stays.averageMinutes === null ? (
        <p className="text-sm" style={muted}>
          {t("stats:insights.cruise.stays.empty")}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            {t("stats:insights.cruise.stays.average", {
              average: fmt.duration(Math.round(stays.averageMinutes)),
            })}{" "}
            <EvidenceCount
              evidenceKey="cruiseMeasuredPortStayCount"
              scope={scope}
              value={stays.measured}
              label={t("stats:insights.cruise.stays.measuredLabel")}
            >
              {t("stats:insights.cruise.stays.measured", { calls: fmt.num(stays.measured) })}
            </EvidenceCount>
          </p>
          <dl className="space-y-2 text-sm">
            {stays.longest && stay(t("stats:insights.cruise.stays.longest"), stays.longest)}
            {stays.shortest && stay(t("stats:insights.cruise.stays.shortest"), stays.shortest)}
          </dl>
        </>
      )}
      {stays.calls > 0 && (
        <p className="mt-3 text-xs" style={muted}>
          {t("stats:insights.cruise.stays.coverage", {
            measured: fmt.num(stays.measured),
            calls: fmt.num(stays.calls),
            missing: fmt.num(stays.missingTime),
            inconsistent: fmt.num(stays.inconsistent),
          })}
        </p>
      )}
    </div>
  );
}
