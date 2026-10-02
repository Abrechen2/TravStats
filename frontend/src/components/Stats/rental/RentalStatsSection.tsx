import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { rentalLinksApi, type RentalStats } from "../../../lib/api/rentalLinks";
import { formatAmount } from "../../../lib/units";
import { countryName } from "../../../shared/geo/countryCode";
import { logger } from "../../../lib/logger";

interface Props {
  /** A calendar year, or null for all years. */
  year: number | null;
}

/**
 * The rental statistics (spec 2026-10-01-rental-domain-design §7.4; concept
 * page 2026-10-01): rental days on the stations' calendars, providers ranked
 * by rental days with brokers apart, the stations' countries, cost per day
 * per currency, and km that say how many rentals they come from. A failed
 * load says so; a figure nobody knows reads "–", never 0.
 */
export default function RentalStatsSection({ year }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const [stats, setStats] = useState<RentalStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    rentalLinksApi
      .stats(year ?? undefined)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err: unknown) => {
        logger.error("RentalStatsSection: load failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  if (failed) {
    return (
      <p role="alert" className="text-(--danger)">
        {t("rental:stats.loadError")}
      </p>
    );
  }
  if (!stats) return <p className="t-caption">{t("rental:detail.loading")}</p>;

  const tile = (value: string, label: string, note: string | null, key: string): JSX.Element => (
    <div
      key={key}
      className="rounded-md border border-border p-3"
      data-testid={`rental-stat-${key}`}
    >
      <div className="font-mono text-2xl">{value}</div>
      <div className="text-sm">{label}</div>
      {note ? <div className="t-caption">{note}</div> : null}
    </div>
  );
  const [firstCost, ...otherCosts] = stats.costPerDay;

  return (
    <section className="space-y-4" data-testid="rental-stats">
      <div className="grid gap-3 sm:grid-cols-3">
        {tile(
          String(stats.days),
          t("rental:stats.days"),
          t("rental:stats.rentals", { count: stats.rentals }),
          "days"
        )}
        {tile(
          stats.km.total === null ? "–" : stats.km.total.toLocaleString(locale),
          t("rental:stats.km"),
          t("rental:stats.kmCoverage", { covered: stats.km.covered, of: stats.km.of }),
          "km"
        )}
        {tile(
          firstCost
            ? formatAmount(firstCost.perDay, firstCost.currency, { language: i18n.language })
            : "–",
          // No costed rental means no currency to name: "pro Tag ()" (forgejo#167).
          firstCost
            ? t("rental:stats.perDay", { currency: firstCost.currency })
            : t("rental:stats.perDayNoCost"),
          otherCosts.length > 0
            ? t("rental:stats.otherCurrencies", {
                list: otherCosts
                  .map((c) => formatAmount(c.perDay, c.currency, { language: i18n.language }))
                  .join(", "),
              })
            : null,
          "cost"
        )}
      </div>

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

      {stats.byYear.length > 1 ? (
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
