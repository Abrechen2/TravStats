import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading, insightCounting } from "./InsightHeading";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { RecordedFields } from "../../../types/flightInsights";

/**
 * Three figures from fields only enriched flights carry: time between wheels-off
 * and wheels-on, countries on the flight path, and who flew a codeshare. Every
 * line names its coverage ("from n of m flights") and nothing is extrapolated;
 * a field no flight carries draws no line at all — the block hides when none does.
 */
export default function FlightRecordedFieldsBlock({
  recorded,
}: {
  recorded: RecordedFields;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const { airborne, overflown, codeshare } = recorded;
  if (!airborne && !overflown && !codeshare) return null;
  const allTime = { period: "allTime" } as const;

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="insights-recorded"
        title={t("stats:insights.recorded.title")}
        topic="airborne"
        counting={[
          insightCounting("airborne", t("stats:insights.recorded.airborne.label")),
          insightCounting("overflown", t("stats:insights.recorded.overflown.label")),
          insightCounting("codeshare", t("stats:insights.recorded.codeshare.label")),
        ]}
      />
      <dl className="space-y-3 text-sm">
        {airborne && (
          <div data-testid="recorded-airborne">
            <dt className="font-medium">{t("stats:insights.recorded.airborne.label")}</dt>
            <dd>
              <EvidenceCount
                evidenceKey="flightAirborneMinutes"
                scope={allTime}
                value={airborne.minutes}
                label={t("stats:insights.recorded.airborne.label")}
              >
                {fmt.duration(airborne.minutes)}
              </EvidenceCount>{" "}
              <span style={muted}>
                {t("stats:insights.recorded.coverage", {
                  flights: fmt.num(airborne.flights),
                  of: fmt.num(airborne.of),
                })}
              </span>
            </dd>
          </div>
        )}
        {overflown && (
          <div data-testid="recorded-overflown">
            <dt className="font-medium">{t("stats:insights.recorded.overflown.label")}</dt>
            <dd>
              <EvidenceCount
                evidenceKey="flightOverflownCountriesCount"
                scope={allTime}
                value={overflown.countries.length}
                label={t("stats:insights.recorded.overflown.label")}
              >
                {t("stats:insights.recorded.overflown.count", {
                  count: overflown.countries.length,
                })}
              </EvidenceCount>{" "}
              <span style={muted}>
                {t("stats:insights.recorded.coverage", {
                  flights: fmt.num(overflown.flights),
                  of: fmt.num(overflown.of),
                })}
              </span>
              <p className="mt-1" style={muted}>
                {overflown.countries.join(", ")}
              </p>
            </dd>
          </div>
        )}
        {codeshare && (
          <div data-testid="recorded-codeshare">
            <dt className="font-medium">{t("stats:insights.recorded.codeshare.label")}</dt>
            <dd>
              <EvidenceCount
                evidenceKey="flightCodeshareCount"
                scope={allTime}
                value={codeshare.codeshare}
                label={t("stats:insights.recorded.codeshare.label")}
              >
                {t("stats:insights.recorded.codeshare.share", {
                  count: codeshare.codeshare,
                  known: fmt.num(codeshare.known),
                  pct: fmt.pct(codeshare.codeshare / codeshare.known),
                })}
              </EvidenceCount>{" "}
              <span style={muted}>
                {t("stats:insights.recorded.coverageKnown", {
                  known: fmt.num(codeshare.known),
                  of: fmt.num(codeshare.of),
                })}
              </span>
              {codeshare.operators.length > 0 && (
                <p className="mt-1" style={muted}>
                  {t("stats:insights.recorded.codeshare.operators")}{" "}
                  {codeshare.operators.map((o) => `${o.name} (${fmt.num(o.flights)})`).join(", ")}
                </p>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
