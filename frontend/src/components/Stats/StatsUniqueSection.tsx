import type { UniqueStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import StatCard from "./StatCard";
import DualFigureCard from "./DualFigureCard";
import { formatDate } from "../../lib/displayFormat";

interface StatsUniqueSectionProps {
  uniqueStats: UniqueStats | null;
}

export default function StatsUniqueSection({ uniqueStats }: StatsUniqueSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  /**
   * All-time, like every measure registered for this surface — the section is
   * built from the full countable set and carries no year filter of its own.
   *
   * The east/west balance and the international/domestic split each render
   * TWO served numbers in one card ("12E / 8W"), and a `StatCard` opens ONE
   * panel — so both stayed unwired until the owner ruled on 2026-09-19 that
   * the cards should be split. They are `DualFigureCard`s now: one card, two
   * triggers, the slash between them plain text. The RATIO beside each pair
   * stays untouched — it is in the description, and `ratio` is not a kind
   * release 1 serves. Every other unwired tile here is an `extremum`,
   * `ratio`, `boolean` or `sequence` measure for the same reason.
   */
  const allTime = { period: "allTime" as const };

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:unique.title")}
      </h2>

      {uniqueStats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatCard
            evidence={{
              kind: "metric",
              key: "timeTravelFlightCount",
              scope: allTime,
              renderedValue: uniqueStats.timeTravelIndex,
            }}
            title={t("stats:unique.timeTravelIndex")}
            value={uniqueStats.timeTravelIndex}
            description={t("stats:unique.timeTravelIndexDesc", {
              count: uniqueStats.timeTravelIndex,
            })}
          />
          <StatCard
            evidence={{
              kind: "metric",
              key: "equatorCrossingCount",
              scope: allTime,
              renderedValue: uniqueStats.equatorCrossings,
            }}
            title={t("stats:unique.equatorCrossings")}
            value={uniqueStats.equatorCrossings}
            description={t("stats:unique.equatorCrossingsDesc", {
              count: uniqueStats.equatorCrossings,
            })}
          />
          <StatCard
            evidence={{
              kind: "metric",
              key: "arcticFlightCount",
              scope: allTime,
              renderedValue: uniqueStats.arcticFlights,
            }}
            title={t("stats:unique.arcticFlights")}
            value={uniqueStats.arcticFlights}
            description={t("stats:unique.arcticFlightsDesc", { count: uniqueStats.arcticFlights })}
          />
          <StatCard
            evidence={{
              kind: "metric",
              key: "oceanCrossingCount",
              scope: allTime,
              renderedValue: uniqueStats.oceanCrossings,
            }}
            title={t("stats:unique.oceanCrossings")}
            value={uniqueStats.oceanCrossings}
            description={t("stats:unique.oceanCrossingsDesc", {
              count: uniqueStats.oceanCrossings,
            })}
          />
          {uniqueStats.hemisphereHops !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "hemisphereHopCount",
                scope: allTime,
                renderedValue: uniqueStats.hemisphereHops,
              }}
              title={t("stats:unique.hemisphereHops")}
              value={uniqueStats.hemisphereHops}
              description={t("stats:unique.hemisphereHopsDesc", {
                count: uniqueStats.hemisphereHops,
              })}
            />
          )}
          {uniqueStats.dateLineCrossings !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "dateLineCrossingCount",
                scope: allTime,
                renderedValue: uniqueStats.dateLineCrossings,
              }}
              title={t("stats:unique.dateLineCrossings")}
              value={uniqueStats.dateLineCrossings}
              description={t("stats:unique.dateLineCrossingsDesc", {
                count: uniqueStats.dateLineCrossings,
              })}
            />
          )}
          {uniqueStats.continentalExplorer !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "continentsTouchedByFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.continentalExplorer,
              }}
              title={t("stats:unique.continentalExplorer")}
              value={uniqueStats.continentalExplorer}
              description={t("stats:unique.continentalExplorerDesc", {
                count: uniqueStats.continentalExplorer,
              })}
              footnote={
                uniqueStats.continents && uniqueStats.continents.length > 0
                  ? uniqueStats.continents.join(", ")
                  : undefined
              }
            />
          )}
          {uniqueStats.tropicsTraveler !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "tropicsFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.tropicsTraveler,
              }}
              title={t("stats:unique.tropicsTraveler")}
              value={uniqueStats.tropicsTraveler}
              description={t("stats:unique.tropicsTravelerDesc", {
                count: uniqueStats.tropicsTraveler,
              })}
            />
          )}
          {uniqueStats.eastWestBalance && (
            <DualFigureCard
              title={t("stats:unique.eastWestBalance")}
              first={{
                kind: "metric",
                evidenceKey: "eastwardFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.eastWestBalance.eastward,
                display: `${uniqueStats.eastWestBalance.eastward}E`,
                label: t("stats:unique.eastWestBalanceEast"),
              }}
              second={{
                kind: "metric",
                evidenceKey: "westwardFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.eastWestBalance.westward,
                display: `${uniqueStats.eastWestBalance.westward}W`,
                label: t("stats:unique.eastWestBalanceWest"),
              }}
              description={t("stats:unique.eastWestBalanceDesc", {
                eastward: uniqueStats.eastWestBalance.eastward,
                westward: uniqueStats.eastWestBalance.westward,
                ratio: uniqueStats.eastWestBalance.ratio.toFixed(2),
              })}
            />
          )}
          {uniqueStats.sameDayFlights !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "sameDayFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.sameDayFlights,
              }}
              title={t("stats:unique.sameDayFlights")}
              value={uniqueStats.sameDayFlights}
              description={t("stats:unique.sameDayFlightsDesc", {
                count: uniqueStats.sameDayFlights,
              })}
            />
          )}
          {uniqueStats.midnightFlights !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "midnightFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.midnightFlights,
              }}
              title={t("stats:unique.midnightFlights")}
              value={uniqueStats.midnightFlights}
              description={t("stats:unique.midnightFlightsDesc", {
                count: uniqueStats.midnightFlights,
              })}
            />
          )}
          {uniqueStats.seasonalExplorer !== undefined && (
            <StatCard
              title={t("stats:unique.seasonalExplorer")}
              value={uniqueStats.seasonalExplorer ? "✓" : "✗"}
              description={t("stats:unique.seasonalExplorerDesc", {
                count: uniqueStats.seasonsCount || 0,
              })}
            />
          )}
          {uniqueStats.internationalVsDomestic && (
            <DualFigureCard
              title={t("stats:unique.internationalVsDomestic")}
              first={{
                kind: "metric",
                evidenceKey: "internationalFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.internationalVsDomestic.international,
                display: `${uniqueStats.internationalVsDomestic.international}I`,
                label: t("stats:unique.internationalVsDomesticInternational"),
              }}
              second={{
                kind: "metric",
                evidenceKey: "domesticFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.internationalVsDomestic.domestic,
                display: `${uniqueStats.internationalVsDomestic.domestic}D`,
                label: t("stats:unique.internationalVsDomesticDomestic"),
              }}
              description={t("stats:unique.internationalVsDomesticDesc", {
                international: uniqueStats.internationalVsDomestic.international,
                domestic: uniqueStats.internationalVsDomestic.domestic,
                ratio: uniqueStats.internationalVsDomestic.ratio.toFixed(2),
              })}
            />
          )}
          {uniqueStats.roundTripMaster !== undefined && (
            <StatCard
              evidence={{
                kind: "metric",
                key: "roundTripFlightCount",
                scope: allTime,
                renderedValue: uniqueStats.roundTripMaster,
              }}
              title={t("stats:unique.roundTripMaster")}
              value={uniqueStats.roundTripMaster}
              description={t("stats:unique.roundTripMasterDesc", {
                count: uniqueStats.roundTripMaster,
              })}
            />
          )}
          {uniqueStats.highestAirport && (
            <StatCard
              title={t("stats:unique.highestAirport")}
              valueSize="sm"
              value={uniqueStats.highestAirport.name}
              description={t("stats:unique.highestAirportDesc", {
                name: uniqueStats.highestAirport.name,
                code: uniqueStats.highestAirport.code,
                altitude: uniqueStats.highestAirport.altitude,
              })}
            />
          )}
          {uniqueStats.northernmost && (
            <StatCard
              title={t("stats:unique.northernmost")}
              valueSize="sm"
              value={uniqueStats.northernmost.code}
              description={t("stats:unique.northernmostDesc", {
                code: uniqueStats.northernmost.code,
                lat: uniqueStats.northernmost.lat.toFixed(2),
              })}
            />
          )}
          {uniqueStats.southernmost && (
            <StatCard
              title={t("stats:unique.southernmost")}
              valueSize="sm"
              value={uniqueStats.southernmost.code}
              description={t("stats:unique.southernmostDesc", {
                code: uniqueStats.southernmost.code,
                lat: Math.abs(uniqueStats.southernmost.lat).toFixed(2),
              })}
            />
          )}
          {uniqueStats.longestTravelChain > 1 && (
            <StatCard
              title={t("stats:unique.longestTravelChain")}
              value={uniqueStats.longestTravelChain}
              description={t("stats:unique.longestTravelChainDesc", {
                count: uniqueStats.longestTravelChain,
              })}
            />
          )}
          {uniqueStats.fastestRoute && (
            <StatCard
              title={t("stats:unique.fastestRoute")}
              valueSize="sm"
              value={uniqueStats.fastestRoute.route}
              description={t("stats:unique.fastestRouteDesc", {
                route: uniqueStats.fastestRoute.route,
                speed: uniqueStats.fastestRoute.speed,
              })}
            />
          )}
          {uniqueStats.mostCountriesInDay > 0 && uniqueStats.mostCountriesDate && (
            <StatCard
              title={t("stats:unique.mostCountriesInDay")}
              value={uniqueStats.mostCountriesInDay}
              description={t("stats:unique.mostCountriesInDayDesc", {
                count: uniqueStats.mostCountriesInDay,
                date: formatDate(uniqueStats.mostCountriesDate),
              })}
            />
          )}
          {uniqueStats.longestLayover && (
            <StatCard
              title={t("stats:unique.longestLayover")}
              valueSize="md"
              value={`${uniqueStats.longestLayover.hours}h`}
              description={t("stats:unique.longestLayoverDesc", {
                hours: uniqueStats.longestLayover.hours,
                from: uniqueStats.longestLayover.from,
              })}
            />
          )}
          {uniqueStats.shortestLayover && (
            <StatCard
              title={t("stats:unique.shortestLayover")}
              valueSize="md"
              value={`${uniqueStats.shortestLayover.hours}h`}
              description={t("stats:unique.shortestLayoverDesc", {
                hours: uniqueStats.shortestLayover.hours,
                from: uniqueStats.shortestLayover.from,
              })}
            />
          )}
        </div>
      ) : (
        <div
          className="rounded-lg shadow-sm p-6 text-center"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <p className="" style={{ color: "var(--text-muted)" }}>
            {t("stats:loading")}
          </p>
        </div>
      )}
    </div>
  );
}
