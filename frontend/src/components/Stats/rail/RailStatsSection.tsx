import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { railApi } from "../../../lib/api/rail";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { RailRanked, RailStats } from "../../../types/rail";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";
import PeriodComparisonStrip from "../PeriodComparisonStrip";
import type { PeriodScope } from "../useStatsPeriod";

/**
 * The rail numbers on the statistics page (spec 2026-09-25-rail-domain, 2b).
 *
 * Every figure is the server's (`GET /rail/stats`), which counts through
 * `shared/railCounting` — the page counts nothing itself. Two rules from the
 * spec are visible here rather than buried: kilometres say what they measure
 * (straight line vs. traced line vs. ticket, owner decision 7), and hours and
 * delays name the sample they were taken over, so "on time" never includes
 * "nobody wrote the delay down".
 *
 * Mounted only behind the `railDomain` beta gate — the page decides that
 * through `resolveStatsTab`; this component does not ask again.
 */
export default function RailStatsSection({
  scope,
  visibility,
}: {
  scope: PeriodScope;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["rail", "stats", "common"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("rail");
  const { year, compareYear } = scope;
  const [stats, setStats] = useState<RailStats | null>(null);
  const [previous, setPrevious] = useState<RailStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setFailed(false);
    void (async () => {
      try {
        const [current, prior] = await Promise.all([
          railApi.stats(year),
          compareYear === null ? Promise.resolve(null) : railApi.stats(compareYear),
        ]);
        if (cancelled) return;
        setStats(current);
        setPrevious(prior);
      } catch (err) {
        logger.error("RailStatsSection: fetch failed", err);
        // A failed load says so; zeros would claim "you never took a train".
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [year, compareYear]);

  if (failed) return <p className="text-sm text-(--text-muted)">{t("rail:stats.loadError")}</p>;
  if (!stats) return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;

  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const num = (n: number, digits = 0): string =>
    n.toLocaleString(locale, { maximumFractionDigits: digits });
  const show = visibility.isVisible;

  const comparison =
    previous && year !== null && compareYear !== null ? (
      <div className="mb-8">
        <PeriodComparisonStrip
          year={year}
          compareYear={compareYear}
          rows={[
            {
              key: "journeys",
              label: t("rail:stats.journeys"),
              current: stats.journeys,
              previous: previous.journeys,
            },
            {
              key: "km",
              label: t("rail:stats.kmAll"),
              current: Math.round(stats.distance.totalKm),
              previous: Math.round(previous.distance.totalKm),
            },
            {
              key: "countries",
              label: t("rail:stats.countries"),
              current: stats.countries.length,
              previous: previous.countries.length,
            },
          ]}
        />
      </div>
    ) : null;

  if (stats.journeys === 0) {
    return (
      <section className="flex flex-col gap-6">
        {comparison}
        <p className="text-sm text-(--text-muted)">
          {year === null ? t("rail:stats.empty") : t("stats:period.emptyYear", { year })}
        </p>
      </section>
    );
  }

  const regionNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region" })
      : null;
  const toRows = (ranked: RailRanked[]): RankedRow[] => {
    const max = Math.max(...ranked.map((r) => r.count), 1);
    return ranked.map((r) => ({
      key: r.label,
      label: r.label,
      weight: r.count / max,
      value: String(r.count),
    }));
  };
  const { distance, hoursOnBoard, delays, longest } = stats;
  const delayMax = Math.max(...delays.buckets.map((b) => b.count), 1);
  const delayRows: RankedRow[] = delays.buckets.map((b, i) => ({
    key: String(b.upToMinutes ?? "open"),
    label: delayBucketLabel(t, b.upToMinutes, i === 0 ? null : delays.buckets[i - 1].upToMinutes),
    weight: b.count / delayMax,
    value: String(b.count),
  }));
  const yearMax = Math.max(...stats.byYear.map((y) => y.journeys), 1);
  const yearRows: RankedRow[] = [...stats.byYear].reverse().map((y) => ({
    key: String(y.year),
    label: String(y.year),
    weight: y.journeys / yearMax,
    value: String(y.journeys),
    hint: `${num(y.km)} km`,
  }));

  return (
    <section>
      {comparison}
      {show("kpis") && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("rail:stats.journeys")}
            value={num(stats.journeys)}
            description={t("rail:stats.journeysDesc")}
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("rail:stats.kmAll")}
            value={`${num(distance.totalKm)} km`}
            description={
              <span data-testid="rail-km-split">
                {[
                  distance.tracedKm > 0 && t("rail:stats.kmTraced", { km: num(distance.tracedKm) }),
                  distance.ticketKm > 0 && t("rail:stats.kmTicket", { km: num(distance.ticketKm) }),
                  distance.straightLineKm > 0 &&
                    t("rail:stats.kmStraight", { km: num(distance.straightLineKm) }),
                  distance.unmeasuredJourneys > 0 &&
                    t("rail:stats.kmUnmeasured", { count: distance.unmeasuredJourneys }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            }
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("rail:stats.hours")}
            value={`${num(hoursOnBoard.hours, 1)} h`}
            description={t("rail:stats.sample", {
              count: hoursOnBoard.measuredJourneys,
              total: stats.journeys,
            })}
          />
          <StatCard
            accent={accent}
            valueSize="md"
            title={t("rail:stats.countries")}
            value={num(stats.countries.length)}
            description={stats.countries.map((c) => regionNames?.of(c) ?? c).join(", ")}
          />
        </div>
      )}
      {show("rankings") && (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <RankedBarList
            title={t("rail:stats.operators")}
            rows={toRows(stats.operators)}
            accent={accent}
            emptyLabel={t("rail:stats.noOperators")}
          />
          <RankedBarList
            title={t("rail:stats.categories")}
            rows={toRows(stats.trainCategories)}
            accent={accent}
            emptyLabel={t("rail:stats.noCategories")}
          />
          <RankedBarList
            title={t("rail:stats.stations")}
            rows={toRows(stats.stations)}
            accent={accent}
            emptyLabel={t("rail:stats.noStations")}
          />
        </div>
      )}
      {show("delays") && (
        <div className="mt-8">
          <RankedBarList
            title={t("rail:stats.delays")}
            total={t("rail:stats.sample", {
              count: delays.recordedJourneys,
              total: stats.journeys,
            })}
            rows={delays.recordedJourneys > 0 ? delayRows : []}
            accent={accent}
            emptyLabel={t("rail:stats.noDelays")}
          />
        </div>
      )}
      {show("records") && longest && (
        <div className="mt-8">
          <StatCard
            accent={accent}
            valueSize="sm"
            title={t("rail:stats.longest")}
            value={
              <Link to={`/rail/${longest.id}`} className="hover:underline">
                {longest.depStationName} → {longest.arrStationName}
              </Link>
            }
            description={`${num(longest.distanceKm)} km · ${distanceSourceLabel(t, longest.distanceSource)}`}
          />
        </div>
      )}
      {show("years") && year === null && yearRows.length > 1 && (
        <div className="mt-8">
          <RankedBarList
            title={t("rail:stats.byYear")}
            rows={yearRows}
            accent={accent}
            emptyLabel={t("rail:stats.empty")}
          />
        </div>
      )}
    </section>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function delayBucketLabel(t: Translate, upTo: number | null, lower: number | null): string {
  if (upTo === 0) return t("rail:stats.delayOnTime");
  if (upTo === null) return t("rail:stats.delayOver", { minutes: lower ?? 0 });
  return t("rail:stats.delayUpTo", { minutes: upTo });
}

/** What a distance measures — the label the owner asked for (decision 7). */
function distanceSourceLabel(t: Translate, source: string | null): string {
  if (source === "route") return t("rail:stats.sourceTraced");
  if (source === "user") return t("rail:stats.sourceTicket");
  return t("rail:stats.sourceStraight");
}
