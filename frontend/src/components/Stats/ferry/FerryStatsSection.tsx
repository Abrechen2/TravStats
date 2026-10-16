import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { ferryApi } from "../../../lib/api/ferry";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { FerryJourney } from "../../../types/ferry";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import { adaptFerry } from "../../../lib/stats/domain-stats/ferryStatsAdapter";
import { ferryYear } from "../../../shared/ferryCounting";
import type { PeriodScope } from "../useStatsPeriod";
import StatCard from "../StatCard";
import CountingHelp from "../counting/CountingHelp";

/**
 * The ferry numbers on the statistics page. Ferry was the one transport domain
 * with figures on the overview card and no tab of its own. The figures are the
 * overview card's own (`adaptFerry`, counted through `shared/ferryCounting`:
 * completed crossings, each filed on its departure port's calendar), so the
 * tab and the card cannot disagree. Kilometres say what they measure, and the
 * hours on board abstain when no crossing carries both of its times.
 *
 * Mounted only behind the `ferryDomain` beta gate — the page decides that
 * through `resolveStatsTab`; this component does not ask again.
 */
export default function FerryStatsSection({
  scope,
  visibility,
}: {
  scope: Pick<PeriodScope, "year">;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["ferry", "stats", "common"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("ferry");
  const { year } = scope;
  const [crossings, setCrossings] = useState<FerryJourney[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCrossings(null);
    setFailed(false);
    void (async () => {
      try {
        const all = await ferryApi.listAll();
        if (!cancelled) setCrossings(all);
      } catch (err) {
        logger.error("FerryStatsSection: fetch failed", err);
        // A failed load says so; zeros would claim "you never took a ferry".
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(
    () =>
      crossings === null
        ? null
        : adaptFerry({
            journeys: year === null ? crossings : crossings.filter((c) => ferryYear(c) === year),
          }),
    [crossings, year]
  );

  if (failed) return <p className="text-sm text-(--text-muted)">{t("ferry:stats.loadError")}</p>;
  if (!stats) return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  if (!stats.hasData) {
    return (
      <p className="text-sm text-(--text-muted)" data-testid="ferry-stats-empty">
        {year === null ? t("ferry:stats.empty") : t("stats:period.emptyYear", { year })}
      </p>
    );
  }

  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const num = (n: number, digits = 0): string =>
    n.toLocaleString(locale, { maximumFractionDigits: digits });
  const kmOf = (labelKey: string): number =>
    Number(stats.summary.headlineKpis.find((k) => k.labelKey === labelKey)?.value ?? 0);
  const measuredKm = kmOf("overviewCard.kpi.ferryKmMeasured");
  const straightKm = kmOf("overviewCard.kpi.ferryKmStraight");
  const regionNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region" })
      : null;
  const operators = stats.summary.topItems?.items ?? [];

  return (
    <section data-testid="ferry-stats">
      {visibility.isVisible("kpis") && (
        <div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("ferry:stats.crossings")}
              value={num(stats.totalEvents ?? 0)}
              description={t("ferry:stats.crossingsDesc")}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("ferry:stats.km")}
              value={`${num(stats.totalDistanceKm ?? 0)} km`}
              description={
                <span data-testid="ferry-km-split">
                  {[
                    measuredKm > 0 && t("ferry:stats.kmMeasured", { km: num(measuredKm) }),
                    straightKm > 0 && t("ferry:stats.kmStraight", { km: num(straightKm) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              }
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("ferry:stats.hours")}
              // Abstention: no crossing with both times is "unknown", not 0 h.
              value={stats.totalDurationHours ? `${num(stats.totalDurationHours, 1)} h` : "–"}
              description={t("ferry:stats.hoursDesc")}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("ferry:stats.countries")}
              value={num(stats.countries?.length ?? 0)}
              description={(stats.countries ?? []).map((c) => regionNames?.of(c) ?? c).join(", ")}
            />
          </div>
          <CountingHelp
            testId="ferry-kpis-help"
            entries={[
              { term: t("ferry:stats.crossings"), helpKey: "ferry:stats.help.crossings" },
              { term: t("ferry:stats.km"), helpKey: "ferry:stats.help.km" },
              { term: t("ferry:stats.hours"), helpKey: "ferry:stats.help.hours" },
              { term: t("ferry:stats.countries"), helpKey: "ferry:stats.help.countries" },
            ]}
          />
        </div>
      )}
      {visibility.isVisible("operators") && operators.length > 0 && (
        <div className="mt-6" data-testid="ferry-operators">
          <h3 className="mb-2 text-sm font-semibold text-(--text-primary)">
            {t("ferry:stats.operators")}
          </h3>
          <ul className="text-sm text-(--text-secondary)">
            {operators.map((o) => (
              <li key={o.label}>
                {o.label} · {num(o.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
