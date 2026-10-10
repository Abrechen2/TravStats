import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { DomainRecord, DomainRecordId } from "../../../types/domainRecords";
import StatCard from "../StatCard";
import CountingHelp from "../counting/CountingHelp";

/**
 * Travel records beyond flights (forgejo#265): the longest cruise, stay,
 * roadtrip, rental, train and bus ride, the most visited place — one card per
 * domain the reader sees, each in its own unit and linked to the entry that
 * holds it. The flight records stay on the flight tab, where they always were.
 *
 * The server decides everything: which domains are visible (a domain behind
 * the beta switch has no record), and that a record which cannot be derived
 * is omitted rather than shown as a zero. A failed load draws nothing, like
 * the travel account beside it: the rest of the overview is still correct.
 */
/**
 * The evidence measure of each record — its one witness, the entry that holds
 * it (`services/evidence/metricEvidenceDomainRecords.ts`, lifetime only).
 */
const DOMAIN_RECORD_EVIDENCE_KEYS: Record<DomainRecordId, string> = {
  "longest-cruise": "recordLongestCruise",
  "longest-stay": "recordLongestStay",
  "most-visited-place": "recordMostVisitedPlace",
  "longest-roadtrip": "recordLongestRoadtrip",
  "longest-rail-ride": "recordLongestRailRide",
  "longest-rental": "recordLongestRental",
  "longest-bus-ride": "recordLongestBusRide",
};

export default function DomainRecordsSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["stats"]);
  const { colorOf } = useDomainColors();
  const [records, setRecords] = useState<DomainRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .getDomainRecords()
      .then((next) => {
        if (!cancelled) setRecords(next);
      })
      .catch((err: unknown) => {
        logger.error("DomainRecordsSection: fetch failed", err);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (records === null || records.length === 0) return null;
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const value = (r: DomainRecord): string =>
    t(`stats:domainRecords.units.${r.unit}`, {
      count: r.value,
      value: r.value.toLocaleString(locale),
    });

  return (
    <section className="mt-8" data-testid="domain-records">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("stats:domainRecords.title")}
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {records.map((r) => (
          <StatCard
            key={r.id}
            accent={colorOf(r.domain)}
            valueSize="md"
            title={t(`stats:domainRecords.ids.${r.id}`)}
            value={value(r)}
            // The figure opens the record's witness; the entry's name under
            // it stays a link to the entry, outside the trigger.
            evidence={{
              kind: "metric",
              key: DOMAIN_RECORD_EVIDENCE_KEYS[r.id],
              scope: { period: "allTime" },
              renderedValue: r.value,
            }}
            descriptionHasOwnTrigger
            description={
              <>
                <Link to={r.href} className="hover:underline">
                  {r.label ?? t(`stats:domainRecords.ids.${r.id}`)}
                </Link>
                {r.distanceSource === "great_circle"
                  ? ` · ${t("stats:domainRecords.straightLine")}`
                  : null}
              </>
            }
          />
        ))}
      </div>
      <CountingHelp
        testId="domain-records-help"
        entries={[{ term: t("stats:domainRecords.title"), helpKey: "stats:domainRecords.help" }]}
      />
    </section>
  );
}
