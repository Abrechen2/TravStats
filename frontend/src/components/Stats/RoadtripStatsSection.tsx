import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { logger } from "../../lib/logger";
import type { RoadtripSummary } from "../../types/roadtrip";
import StatCard from "./StatCard";
import RankedBarList, { type RankedRow } from "./lodging/RankedBarList";
import type { PeriodScope } from "./useStatsPeriod";
import PeriodComparisonStrip from "./PeriodComparisonStrip";
import type { SectionVisibility } from "../../hooks/useSectionVisibility";
import { statsInsightsApi } from "../../lib/api/statsInsights";
import type { RoadtripInsights } from "../../types/statsInsights";
import RoadtripInsightsSection from "./roadtrip/RoadtripInsightsSection";
import TourStatsSection from "./roadtrip/TourStatsSection";

/**
 * The roadtrip tab of the statistics page (2.7).
 *
 * Every figure is read off the roadtrip list, which the server derives with
 * the one night rule and the one station-country rule — this component adds
 * nothing it could get wrong except the year filter. A roadtrip belongs to the
 * year it STARTED, the same rule cruises follow; one that has not started yet
 * is planned and counted nowhere.
 */
export default function RoadtripStatsSection({
  scope,
  visibility,
}: {
  scope: PeriodScope;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "stats", "common"]);
  const accent = useDomainColors().colorOf("roadtrip");
  const [rows, setRows] = useState<RoadtripSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  // forgejo#260 — the insights load beside the list and never hold it up: a
  // failure there costs the insight blocks, not the tab.
  const [insights, setInsights] = useState<RoadtripInsights | null>(null);
  const [insightsFailed, setInsightsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    roadtripsApi
      .list()
      .then((r) => !cancelled && setRows(r))
      .catch((err: unknown) => {
        logger.warn("Failed to load roadtrips for statistics", err);
        if (!cancelled) setFailed(true);
      });
    statsInsightsApi
      .roadtrips()
      .then((r) => !cancelled && setInsights(r))
      .catch((err: unknown) => {
        logger.warn("Failed to load roadtrip insights", err);
        if (!cancelled) setInsightsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scoped = useMemo(() => (rows ? roadtripsIn(rows, scope.year) : null), [rows, scope.year]);
  const compared = useMemo(
    () => (rows && scope.compareYear !== null ? roadtripsIn(rows, scope.compareYear) : null),
    [rows, scope.compareYear]
  );

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("roadtrips:stats.loadFailed")}</p>;
  }
  if (!scoped) {
    return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  }
  // The year set against the compare year, as the cruise, lodging, places and
  // rail tabs do — counts only, from the same rows the tiles below fold.
  const comparison =
    scope.year !== null && scope.compareYear !== null && compared ? (
      <PeriodComparisonStrip
        year={scope.year}
        compareYear={scope.compareYear}
        rows={[
          {
            key: "count",
            label: t("roadtrips:stats.count"),
            current: scoped.length,
            previous: compared.length,
          },
          {
            key: "km",
            label: t("roadtrips:stats.distance"),
            current: Math.round(scoped.reduce((s, r) => s + r.distanceKm, 0)),
            previous: Math.round(compared.reduce((s, r) => s + r.distanceKm, 0)),
            // A distance says its unit, as the tile below does ("2.620 km").
            format: (n: number): string => `${nf.format(n)} km`,
          },
          {
            key: "countries",
            label: t("roadtrips:stats.countries"),
            current: new Set(scoped.flatMap((r) => r.countries)).size,
            previous: new Set(compared.flatMap((r) => r.countries)).size,
          },
        ]}
      />
    ) : null;

  if (scoped.length === 0) {
    return (
      <section className="space-y-8">
        {comparison}
        <p className="text-sm text-(--text-muted)">
          {scope.year === null
            ? t("roadtrips:stats.empty")
            : t("stats:period.emptyYear", { year: scope.year })}
        </p>
        {/* forgejo#264 — tours stand on their own: no roadtrip is needed for one. */}
        {visibility.isVisible("tours") && <TourStatsSection year={scope.year} accent={accent} />}
      </section>
    );
  }

  const km = scoped.reduce((s, r) => s + r.distanceKm, 0);
  const driven = scoped.reduce((s, r) => s + r.drivenKm, 0);
  const stayNights = scoped.reduce((s, r) => s + r.stayNights, 0);
  const freeNights = scoped.reduce((s, r) => s + r.freeNights, 0);
  const countries = new Set(scoped.flatMap((r) => r.countries));
  const nightsSoft = scoped.some((r) => !r.nightsKnown);

  const byKm = [...scoped].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 5);
  const byNights = [...scoped].sort((a, b) => b.nights - a.nights).slice(0, 5);
  const toRow = (r: RoadtripSummary, weight: number, value: string): RankedRow => ({
    key: r.id,
    label: r.name,
    weight,
    value,
  });

  const vehicleCounts = new Map<string, number>();
  for (const r of scoped) {
    const key = r.vehicle ?? "unknown";
    vehicleCounts.set(key, (vehicleCounts.get(key) ?? 0) + 1);
  }
  const vehicleRows: RankedRow[] = [...vehicleCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([vehicle, count]) => ({
      key: vehicle,
      label: t(`roadtrips:vehicle.${vehicle}`),
      weight: count,
      value: nf.format(count),
    }));

  const aheadKm = insights
    ? insights.roadtrips
        .filter((r) => scoped.some((s) => s.id === r.id))
        .reduce((sum, r) => sum + r.km.current + r.km.planned + r.km.unplaced, 0)
    : 0;
  const aheadFootnote =
    aheadKm > 0
      ? t("roadtrips:stats.insights.aheadFootnote", { km: nf.format(Math.round(aheadKm)) })
      : undefined;

  const show = visibility.isVisible;
  return (
    <section className="space-y-8">
      {comparison}
      {show("kpis") && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("roadtrips:stats.count")}
            value={nf.format(scoped.length)}
            description={t("roadtrips:stats.countHint", { count: scoped.length })}
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("roadtrips:stats.distance")}
            value={`${nf.format(Math.round(km))} km`}
            description={t("roadtrips:stats.drivenHint", { km: nf.format(Math.round(driven)) })}
            // The list's distance is the whole route of every roadtrip that has
            // started — including the stretches still ahead of one under way.
            // Said here, so the tile is not read as kilometres already driven.
            footnote={aheadFootnote}
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("roadtrips:stats.nights")}
            value={nf.format(stayNights + freeNights)}
            description={t("roadtrips:stats.nightsHint", {
              stay: nf.format(stayNights),
              free: nf.format(freeNights),
            })}
            footnote={nightsSoft ? t("roadtrips:stats.nightsSoft") : undefined}
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("roadtrips:stats.countries")}
            value={nf.format(countries.size)}
            description={[...countries].sort().join(" · ") || "—"}
          />
        </div>
      )}
      {show("records") && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RankedBarList
            title={t("roadtrips:stats.longestByKm")}
            emptyLabel={t("roadtrips:stats.empty")}
            accent={accent}
            rows={byKm.map((r) =>
              toRow(r, r.distanceKm, `${nf.format(Math.round(r.distanceKm))} km`)
            )}
          />
          <RankedBarList
            title={t("roadtrips:stats.longestByNights")}
            emptyLabel={t("roadtrips:stats.empty")}
            accent={accent}
            rows={byNights.map((r) =>
              toRow(r, r.nights, t("roadtrips:nightsCount", { count: r.nights }))
            )}
          />
        </div>
      )}
      {show("vehicles") && (
        <RankedBarList
          title={t("roadtrips:stats.vehicles")}
          emptyLabel={t("roadtrips:stats.empty")}
          accent={accent}
          rows={vehicleRows}
        />
      )}
      {show("insights") &&
        (insights ? (
          <RoadtripInsightsSection data={insights} year={scope.year} accent={accent} />
        ) : insightsFailed ? (
          <p className="text-sm text-(--text-muted)">{t("roadtrips:stats.insights.loadFailed")}</p>
        ) : null)}
      {show("tours") && <TourStatsSection year={scope.year} accent={accent} />}
    </section>
  );
}

/**
 * The roadtrips that count in a year: started (a planned one counts nowhere)
 * and started IN that year, the rule cruises follow. `null` is lifetime.
 */
function roadtripsIn(rows: readonly RoadtripSummary[], year: number | null): RoadtripSummary[] {
  const now = Date.now();
  return rows.filter((r) => {
    if (r.startDate && new Date(r.startDate).getTime() > now) return false;
    if (year === null) return true;
    return r.startDate !== null && new Date(r.startDate).getUTCFullYear() === year;
  });
}
