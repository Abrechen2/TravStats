import { useEffect, useState } from "react";
import type { JSX } from "react";

import { busApi } from "../../../lib/api/bus";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { BusStats } from "../../../types/bus";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import { comparisonWindow, sameSpanUntil } from "../../../lib/stats/comparisonWindow";
import type { PeriodScope } from "../useStatsPeriod";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import StatCard from "../StatCard";
import PeriodComparisonStrip from "../PeriodComparisonStrip";
import CountingHelp from "../counting/CountingHelp";
import BusStatsBlocks from "./BusStatsBlocks";

/**
 * The bus numbers on the statistics page (spec 2026-10-07-bus-domain-design
 * §6, package B2; forgejo#263). Every figure is the server's (`GET
 * /bus/stats`, counted through `shared/busCounting`); this component counts
 * nothing. Rail's section is the template: kilometres say what they measure,
 * hours and delays name the sample they were taken over, and a night bus is
 * one whose clocks say so — a missing time is never filled in.
 *
 * Mounted only behind the `busDomain` beta gate — the page decides that
 * through `resolveStatsTab`; this component does not ask again.
 */
export default function BusStatsSection({
  scope,
  visibility,
}: {
  scope: Pick<PeriodScope, "year" | "compareYear">;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["bus", "stats", "common"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("bus");
  const { year, compareYear } = scope;
  const [stats, setStats] = useState<BusStats | null>(null);
  const [pair, setPair] = useState<{
    current: BusStats;
    previous: BusStats;
    samePeriod: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setPair(null);
    setFailed(false);
    void (async () => {
      try {
        // A running year against the SAME span of the other (acceptance D11).
        const until =
          year !== null && compareYear !== null
            ? sameSpanUntil(comparisonWindow(year, compareYear), year)
            : null;
        const [whole, cut, prior] = await Promise.all([
          busApi.stats(year, null),
          until === null ? Promise.resolve(null) : busApi.stats(year, until),
          compareYear === null ? Promise.resolve(null) : busApi.stats(compareYear, until),
        ]);
        if (cancelled) return;
        setStats(whole);
        setPair(
          prior === null
            ? null
            : { current: cut ?? whole, previous: prior, samePeriod: cut !== null }
        );
      } catch (err) {
        logger.error("BusStatsSection: fetch failed", err);
        // A failed load says so; zeros would claim "you never took a bus".
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [year, compareYear]);

  if (failed) return <p className="text-sm text-(--text-muted)">{t("bus:stats.loadError")}</p>;
  if (!stats) return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;

  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const num = (n: number, digits = 0): string =>
    n.toLocaleString(locale, { maximumFractionDigits: digits });
  const show = visibility.isVisible;
  const evidenceScope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const evidence = (key: string, renderedValue: number) => ({
    kind: "metric" as const,
    key,
    scope: evidenceScope,
    renderedValue,
  });

  const comparison =
    pair && year !== null && compareYear !== null ? (
      <div className="mb-8">
        <PeriodComparisonStrip
          year={year}
          compareYear={compareYear}
          samePeriod={pair.samePeriod}
          rows={[
            {
              key: "rides",
              label: t("bus:stats.rides"),
              current: pair.current.rides,
              previous: pair.previous.rides,
              evidenceKey: "busRideCount",
            },
            {
              key: "km",
              label: t("bus:stats.km"),
              current: Math.round(pair.current.distance.totalKm),
              previous: Math.round(pair.previous.distance.totalKm),
              evidenceKey: "busDistanceKmTotal",
            },
          ]}
          evidence={{ scope: { period: "year", year } }}
        />
      </div>
    ) : null;

  if (stats.rides === 0) {
    return (
      <section className="flex flex-col gap-6">
        {comparison}
        <p className="text-sm text-(--text-muted)" data-testid="bus-stats-empty">
          {year === null ? t("bus:stats.empty") : t("stats:period.emptyYear", { year })}
        </p>
      </section>
    );
  }

  const { distance, hoursOnBoard } = stats;
  const regionNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region" })
      : null;

  return (
    <section data-testid="bus-stats">
      {comparison}
      {show("kpis") && (
        <div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.rides")}
              value={num(stats.rides)}
              description={t("bus:stats.ridesDesc", { count: stats.journeys.withTransfer })}
              evidence={evidence("busRideCount", stats.rides)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.km")}
              value={`${num(distance.totalKm)} km`}
              evidence={evidence("busDistanceKmTotal", distance.totalKm)}
              description={
                <span data-testid="bus-km-split">
                  {[
                    distance.routeKm > 0 && t("bus:stats.kmRoute", { km: num(distance.routeKm) }),
                    distance.ticketKm > 0 &&
                      t("bus:stats.kmTicket", { km: num(distance.ticketKm) }),
                    distance.straightLineKm > 0 &&
                      t("bus:stats.kmStraight", { km: num(distance.straightLineKm) }),
                    distance.unmeasuredRides > 0 &&
                      t("bus:stats.kmUnmeasured", { count: distance.unmeasuredRides }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              }
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.hours")}
              value={hoursOnBoard.measuredRides === 0 ? "–" : `${num(hoursOnBoard.hours, 1)} h`}
              description={t("bus:stats.sample", {
                count: hoursOnBoard.measuredRides,
                total: stats.rides,
              })}
              evidence={evidence("busHoursOnBoard", hoursOnBoard.hours)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.countries")}
              value={num(stats.countries.length)}
              description={stats.countries.map((c) => regionNames?.of(c) ?? c).join(", ")}
              evidence={evidence("busCountriesCount", stats.countries.length)}
            />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.nightRides")}
              value={num(stats.night.rides)}
              description={t("bus:stats.nightRidesDesc", { count: stats.night.nights })}
              evidence={evidence("busNightRideCount", stats.night.rides)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.terminalsVisited")}
              value={num(stats.terminalsVisited)}
              description={t("bus:stats.terminalsVisitedDesc")}
              evidence={evidence("busTerminalsCount", stats.terminalsVisited)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.transfers")}
              value={
                stats.transfers.averageMinutes === null
                  ? "–"
                  : `${num(stats.transfers.averageMinutes, 1)} min`
              }
              description={
                stats.transfers.count === 0
                  ? t("bus:stats.transfersNone")
                  : t("bus:stats.transfersDesc", { count: stats.transfers.count })
              }
              evidence={evidence("busTransferCount", stats.transfers.count)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("bus:stats.longestReturn")}
              value={
                stats.longestReturn === null
                  ? "–"
                  : t("bus:stats.daysValue", { count: stats.longestReturn.days })
              }
              description={stats.longestReturn?.terminal ?? t("bus:stats.longestReturnNone")}
              // A lifetime figure whatever year is picked, so its entries are too.
              evidence={{
                kind: "metric",
                key: "busLongestReturn",
                scope: { period: "allTime" },
                renderedValue: stats.longestReturn?.days ?? null,
              }}
            />
          </div>
          <CountingHelp
            testId="bus-kpis-help"
            entries={[
              { term: t("bus:stats.rides"), helpKey: "bus:stats.help.rides" },
              { term: t("bus:stats.km"), helpKey: "bus:stats.help.km" },
              { term: t("bus:stats.hours"), helpKey: "bus:stats.help.hours" },
              { term: t("bus:stats.countries"), helpKey: "bus:stats.help.countries" },
              { term: t("bus:stats.nightRides"), helpKey: "bus:stats.help.night" },
              { term: t("bus:stats.terminalsVisited"), helpKey: "bus:stats.help.terminals" },
              { term: t("bus:stats.transfers"), helpKey: "bus:stats.help.transfers" },
              { term: t("bus:stats.longestReturn"), helpKey: "bus:stats.help.longestReturn" },
            ]}
          />
        </div>
      )}
      <BusStatsBlocks stats={stats} year={year} accent={accent} visibility={visibility} />
    </section>
  );
}
