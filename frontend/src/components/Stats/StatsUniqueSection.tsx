import type { UniqueStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import StatCard from "./StatCard";

interface StatsUniqueSectionProps {
  uniqueStats: UniqueStats | null;
}

export default function StatsUniqueSection({ uniqueStats }: StatsUniqueSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:unique.title")}
      </h2>

      {uniqueStats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatCard
            title={t("stats:unique.timeTravelIndex")}
            value={uniqueStats.timeTravelIndex}
            description={t("stats:unique.timeTravelIndexDesc", {
              count: uniqueStats.timeTravelIndex,
            })}
          />
          <StatCard
            title={t("stats:unique.equatorCrossings")}
            value={uniqueStats.equatorCrossings}
            description={t("stats:unique.equatorCrossingsDesc", {
              count: uniqueStats.equatorCrossings,
            })}
          />
          <StatCard
            title={t("stats:unique.arcticFlights")}
            value={uniqueStats.arcticFlights}
            description={t("stats:unique.arcticFlightsDesc", { count: uniqueStats.arcticFlights })}
          />
          <StatCard
            title={t("stats:unique.oceanCrossings")}
            value={uniqueStats.oceanCrossings}
            description={t("stats:unique.oceanCrossingsDesc", {
              count: uniqueStats.oceanCrossings,
            })}
          />
          {uniqueStats.hemisphereHops !== undefined && (
            <StatCard
              title={t("stats:unique.hemisphereHops")}
              value={uniqueStats.hemisphereHops}
              description={t("stats:unique.hemisphereHopsDesc", {
                count: uniqueStats.hemisphereHops,
              })}
            />
          )}
          {uniqueStats.dateLineCrossings !== undefined && (
            <StatCard
              title={t("stats:unique.dateLineCrossings")}
              value={uniqueStats.dateLineCrossings}
              description={t("stats:unique.dateLineCrossingsDesc", {
                count: uniqueStats.dateLineCrossings,
              })}
            />
          )}
          {uniqueStats.continentalExplorer !== undefined && (
            <StatCard
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
              title={t("stats:unique.tropicsTraveler")}
              value={uniqueStats.tropicsTraveler}
              description={t("stats:unique.tropicsTravelerDesc", {
                count: uniqueStats.tropicsTraveler,
              })}
            />
          )}
          {uniqueStats.eastWestBalance && (
            <StatCard
              title={t("stats:unique.eastWestBalance")}
              valueSize="sm"
              value={`${uniqueStats.eastWestBalance.eastward}E / ${uniqueStats.eastWestBalance.westward}W`}
              description={t("stats:unique.eastWestBalanceDesc", {
                eastward: uniqueStats.eastWestBalance.eastward,
                westward: uniqueStats.eastWestBalance.westward,
                ratio: uniqueStats.eastWestBalance.ratio.toFixed(2),
              })}
            />
          )}
          {uniqueStats.sameDayFlights !== undefined && (
            <StatCard
              title={t("stats:unique.sameDayFlights")}
              value={uniqueStats.sameDayFlights}
              description={t("stats:unique.sameDayFlightsDesc", {
                count: uniqueStats.sameDayFlights,
              })}
            />
          )}
          {uniqueStats.midnightFlights !== undefined && (
            <StatCard
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
            <StatCard
              title={t("stats:unique.internationalVsDomestic")}
              valueSize="sm"
              value={`${uniqueStats.internationalVsDomestic.international}I / ${uniqueStats.internationalVsDomestic.domestic}D`}
              description={t("stats:unique.internationalVsDomesticDesc", {
                international: uniqueStats.internationalVsDomestic.international,
                domestic: uniqueStats.internationalVsDomestic.domestic,
                ratio: uniqueStats.internationalVsDomestic.ratio.toFixed(2),
              })}
            />
          )}
          {uniqueStats.roundTripMaster !== undefined && (
            <StatCard
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
                date: new Date(uniqueStats.mostCountriesDate).toLocaleDateString(),
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
