import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { rentalLinksApi, type RentalStats } from "../../../lib/api/rentalLinks";
import { formatAmount } from "../../../lib/units";
import { countryName } from "../../../shared/geo/countryCode";
import { logger } from "../../../lib/logger";
import { comparisonWindow, sameSpanUntil } from "../../../lib/stats/comparisonWindow";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import type { PeriodScope } from "../useStatsPeriod";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import StatCard from "../StatCard";
import PeriodComparisonStrip from "../PeriodComparisonStrip";
import CountingHelp from "../counting/CountingHelp";
import RentalStatsDetails, { type RentalEvidence } from "./RentalStatsDetails";

const ALL_VISIBLE: SectionVisibility = {
  isVisible: () => true,
  toggle: () => undefined,
  reset: () => undefined,
  hiddenCount: 0,
};

interface Props {
  scope: Pick<PeriodScope, "year" | "compareYear">;
  /** The tab's section switches; omitted, every block is drawn. */
  visibility?: SectionVisibility;
}

/**
 * The rental statistics (spec 2026-10-01-rental-domain-design §7.4; concept
 * page 2026-10-01; forgejo#262): rental days on the stations' calendars,
 * providers ranked by rental days with brokers apart, the stations'
 * countries, cost per day per currency, km that say how many rentals they
 * come from — and, since forgejo#262, a year comparison, one-way rentals,
 * efficiency over one documented subset, booked against billed, vehicles and
 * records (`RentalStatsDetails`). A failed load says so; a figure nobody
 * knows reads "–", never 0.
 *
 * Mounted only behind the `rentalDomain` beta gate — the page decides that
 * through `resolveStatsTab`; this component does not ask again.
 */
export default function RentalStatsSection({
  scope,
  visibility = ALL_VISIBLE,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental", "stats"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("rental");
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const { year, compareYear } = scope;
  const [stats, setStats] = useState<RentalStats | null>(null);
  const [pair, setPair] = useState<{
    current: RentalStats;
    previous: RentalStats;
    samePeriod: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPair(null);
    void (async () => {
      try {
        // A running year against the SAME span of the other one (the rail
        // tab's rule, acceptance D11), never eight months against twelve.
        const until =
          year !== null && compareYear !== null
            ? sameSpanUntil(comparisonWindow(year, compareYear), year)
            : null;
        const [whole, cut, prior] = await Promise.all([
          rentalLinksApi.stats(year ?? undefined),
          until === null ? Promise.resolve(null) : rentalLinksApi.stats(year ?? undefined, until),
          compareYear === null ? Promise.resolve(null) : rentalLinksApi.stats(compareYear, until),
        ]);
        if (cancelled) return;
        setStats(whole);
        setPair(
          prior === null
            ? null
            : { current: cut ?? whole, previous: prior, samePeriod: cut !== null }
        );
      } catch (err: unknown) {
        logger.error("RentalStatsSection: load failed", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, compareYear]);

  if (failed) {
    return (
      <p role="alert" className="text-(--danger)">
        {t("rental:stats.loadError")}
      </p>
    );
  }
  if (!stats) return <p className="t-caption">{t("rental:detail.loading")}</p>;

  const show = visibility.isVisible;
  const evidenceScope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const evidence: RentalEvidence = (key, renderedValue) => ({
    kind: "metric",
    key,
    scope: evidenceScope,
    renderedValue,
  });

  const comparison =
    pair && year !== null && compareYear !== null ? (
      <PeriodComparisonStrip
        year={year}
        compareYear={compareYear}
        samePeriod={pair.samePeriod}
        rows={[
          {
            key: "rentals",
            label: t("rental:stats.rentalsLabel"),
            current: pair.current.rentals,
            previous: pair.previous.rentals,
            evidenceKey: "rentalCount",
          },
          {
            key: "days",
            label: t("rental:stats.days"),
            current: pair.current.days,
            previous: pair.previous.days,
            evidenceKey: "rentalDaysTotal",
          },
        ]}
        evidence={{ scope: { period: "year", year } }}
      />
    ) : null;

  if (stats.rentals === 0) {
    return (
      <section className="space-y-4" data-testid="rental-stats">
        {comparison}
        <p className="t-caption" data-testid="rental-stats-empty">
          {year === null ? t("rental:stats.empty") : t("stats:period.emptyYear", { year })}
        </p>
        {/* The empty tiles stay: an unknown cost reads "–", never 0 (forgejo#167). */}
        <KpiTiles stats={stats} locale={locale} accent={accent} evidence={evidence} />
      </section>
    );
  }

  return (
    <section className="space-y-6" data-testid="rental-stats">
      {comparison}
      {show("kpis") && (
        <div>
          <KpiTiles stats={stats} locale={locale} accent={accent} evidence={evidence} />
          <CountingHelp
            testId="rental-kpis-help"
            entries={[
              { term: t("rental:stats.days"), helpKey: "rental:stats.help.days" },
              { term: t("rental:stats.km"), helpKey: "rental:stats.help.km" },
              { term: t("rental:stats.perDayNoCost"), helpKey: "rental:stats.help.costPerDay" },
            ]}
          />
        </div>
      )}

      {show("providers") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">{t("rental:stats.providers")}</h3>
            <ol className="mt-1 space-y-1 text-sm">
              {stats.providers.map((p) => (
                <li key={p.provider} className="flex justify-between gap-2">
                  <span>{p.provider}</span>
                  <span className="font-mono">{t("rental:list.days", { count: p.days })}</span>
                </li>
              ))}
            </ol>
            <p className="t-caption mt-1">{t("rental:stats.brokerNote")}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t("rental:stats.countries")}</h3>
            <p className="text-sm">
              {stats.countries.map((c) => countryName(c, i18n.language) || c).join(", ") || "–"}
            </p>
            <p className="t-caption">{t("rental:stats.countriesNote")}</p>
          </div>
        </div>
      )}

      {stats.extra && (
        <RentalStatsDetails
          stats={stats}
          extra={stats.extra}
          accent={accent}
          visibility={visibility}
          evidence={evidence}
        />
      )}

      {stats.cancellationFees.length > 0 ? (
        <p className="text-sm" data-testid="rental-stats-fees">
          {t("rental:stats.cancellationFees", {
            count: stats.cancellationFees.reduce((n, f) => n + f.rentals, 0),
            list: stats.cancellationFees
              .map((f) => formatAmount(f.amount, f.currency, { language: i18n.language }))
              .join(", "),
          })}
        </p>
      ) : null}

      {show("years") && stats.byYear.length > 1 ? (
        <div>
          <h3 className="text-sm font-semibold">{t("rental:stats.byYear")}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {stats.byYear.map((y) => (
              <li key={y.year} className="flex justify-between gap-2">
                <span className="font-mono">{y.year}</span>
                <span>{t("rental:list.days", { count: y.days })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Days, km and cost per day — the three figures the tab opened with (spec §7.4). */
function KpiTiles({
  stats,
  locale,
  accent,
  evidence,
}: {
  stats: RentalStats;
  locale: string;
  accent: string;
  evidence: RentalEvidence;
}): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const [firstCost, ...otherCosts] = stats.costPerDay;
  const money = (amount: number, currency: string): string =>
    formatAmount(amount, currency, { language: i18n.language });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div data-testid="rental-stat-days">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("rental:stats.days")}
          value={String(stats.days)}
          description={t("rental:stats.rentals", { count: stats.rentals })}
          evidence={stats.rentals > 0 ? evidence("rentalDaysTotal", stats.days) : undefined}
        />
      </div>
      <div data-testid="rental-stat-km">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("rental:stats.km")}
          value={stats.km.total === null ? "–" : stats.km.total.toLocaleString(locale)}
          description={t("rental:stats.kmCoverage", { covered: stats.km.covered, of: stats.km.of })}
        />
      </div>
      <div data-testid="rental-stat-cost">
        <StatCard
          accent={accent}
          valueSize="md"
          // No costed rental means no currency to name: "pro Tag ()" (forgejo#167).
          title={
            firstCost
              ? t("rental:stats.perDay", { currency: firstCost.currency })
              : t("rental:stats.perDayNoCost")
          }
          value={firstCost ? money(firstCost.perDay, firstCost.currency) : "–"}
          description={
            otherCosts.length > 0
              ? t("rental:stats.otherCurrencies", {
                  list: otherCosts.map((c) => money(c.perDay, c.currency)).join(", "),
                })
              : firstCost
                ? t("rental:stats.costSample", { count: firstCost.rentals })
                : t("rental:stats.costNone")
          }
        />
      </div>
    </div>
  );
}
