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
import type { SectionVisibility } from "../../hooks/useSectionVisibility";

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

  useEffect(() => {
    let cancelled = false;
    roadtripsApi
      .list()
      .then((r) => !cancelled && setRows(r))
      .catch((err: unknown) => {
        logger.warn("Failed to load roadtrips for statistics", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scoped = useMemo(() => {
    if (!rows) return null;
    const now = Date.now();
    return rows.filter((r) => {
      if (r.startDate && new Date(r.startDate).getTime() > now) return false;
      if (scope.year === null) return true;
      return r.startDate !== null && new Date(r.startDate).getUTCFullYear() === scope.year;
    });
  }, [rows, scope.year]);

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("roadtrips:stats.loadFailed")}</p>;
  }
  if (!scoped) {
    return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  }
  if (scoped.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("roadtrips:stats.empty")}</p>;
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

  const show = visibility.isVisible;
  return (
    <section className="space-y-8">
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
    </section>
  );
}
