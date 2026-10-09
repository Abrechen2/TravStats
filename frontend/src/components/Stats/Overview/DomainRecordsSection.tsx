import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { DomainRecord } from "../../../types/domainRecords";
import StatCard from "../StatCard";
import MetricHelp from "../MetricHelp";

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
            value={
              <Link to={r.href} className="hover:underline">
                {value(r)}
              </Link>
            }
            description={[
              r.label,
              r.distanceSource === "great_circle" ? t("stats:domainRecords.straightLine") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </div>
      <MetricHelp
        testId="domain-records-help"
        items={[{ term: t("stats:domainRecords.title"), text: t("stats:domainRecords.help") }]}
      />
    </section>
  );
}
