import type { UniqueStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

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
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:unique.timeTravelIndex")}
            </h3>
            <p className="text-4xl font-bold mb-1">{uniqueStats.timeTravelIndex}</p>
            <p className="text-sm opacity-75">
              {t("stats:unique.timeTravelIndexDesc", { count: uniqueStats.timeTravelIndex })}
            </p>
          </div>

          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:unique.equatorCrossings")}
            </h3>
            <p className="text-4xl font-bold mb-1">{uniqueStats.equatorCrossings}</p>
            <p className="text-sm opacity-75">
              {t("stats:unique.equatorCrossingsDesc", {
                count: uniqueStats.equatorCrossings,
              })}
            </p>
          </div>

          <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:unique.arcticFlights")}
            </h3>
            <p className="text-4xl font-bold mb-1">{uniqueStats.arcticFlights}</p>
            <p className="text-sm opacity-75">
              {t("stats:unique.arcticFlightsDesc", { count: uniqueStats.arcticFlights })}
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-teal-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:unique.oceanCrossings")}
            </h3>
            <p className="text-4xl font-bold mb-1">{uniqueStats.oceanCrossings}</p>
            <p className="text-sm opacity-75">
              {t("stats:unique.oceanCrossingsDesc", { count: uniqueStats.oceanCrossings })}
            </p>
          </div>

          {uniqueStats.hemisphereHops !== undefined && (
            <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.hemisphereHops")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.hemisphereHops}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.hemisphereHopsDesc", { count: uniqueStats.hemisphereHops })}
              </p>
            </div>
          )}

          {uniqueStats.dateLineCrossings !== undefined && (
            <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.dateLineCrossings")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.dateLineCrossings}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.dateLineCrossingsDesc", {
                  count: uniqueStats.dateLineCrossings,
                })}
              </p>
            </div>
          )}

          {uniqueStats.continentalExplorer !== undefined && (
            <div className="bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.continentalExplorer")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.continentalExplorer}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.continentalExplorerDesc", {
                  count: uniqueStats.continentalExplorer,
                })}
              </p>
              {uniqueStats.continents && uniqueStats.continents.length > 0 && (
                <p className="text-xs opacity-60 mt-2">{uniqueStats.continents.join(", ")}</p>
              )}
            </div>
          )}

          {uniqueStats.tropicsTraveler !== undefined && (
            <div className="bg-gradient-to-br from-orange-400 to-yellow-400 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.tropicsTraveler")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.tropicsTraveler}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.tropicsTravelerDesc", {
                  count: uniqueStats.tropicsTraveler,
                })}
              </p>
            </div>
          )}

          {uniqueStats.eastWestBalance && (
            <div className="bg-gradient-to-br from-slate-500 to-gray-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.eastWestBalance")}
              </h3>
              <p className="text-2xl font-bold mb-1">
                {uniqueStats.eastWestBalance.eastward}E / {uniqueStats.eastWestBalance.westward}W
              </p>
              <p className="text-sm opacity-75">
                {t("stats:unique.eastWestBalanceDesc", {
                  eastward: uniqueStats.eastWestBalance.eastward,
                  westward: uniqueStats.eastWestBalance.westward,
                  ratio: uniqueStats.eastWestBalance.ratio.toFixed(2),
                })}
              </p>
            </div>
          )}

          {uniqueStats.sameDayReturns !== undefined && (
            <div className="bg-gradient-to-br from-teal-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.sameDayReturns")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.sameDayReturns}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.sameDayReturnsDesc", { count: uniqueStats.sameDayReturns })}
              </p>
            </div>
          )}

          {uniqueStats.midnightFlights !== undefined && (
            <div className="bg-gradient-to-br from-indigo-600 to-blue-600 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.midnightFlights")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.midnightFlights}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.midnightFlightsDesc", {
                  count: uniqueStats.midnightFlights,
                })}
              </p>
            </div>
          )}

          {uniqueStats.seasonalExplorer !== undefined && (
            <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.seasonalExplorer")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.seasonalExplorer ? "✓" : "✗"}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.seasonalExplorerDesc", {
                  count: uniqueStats.seasonsCount || 0,
                })}
              </p>
            </div>
          )}

          {uniqueStats.internationalVsDomestic && (
            <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.internationalVsDomestic")}
              </h3>
              <p className="text-2xl font-bold mb-1">
                {uniqueStats.internationalVsDomestic.international}I /{" "}
                {uniqueStats.internationalVsDomestic.domestic}D
              </p>
              <p className="text-sm opacity-75">
                {t("stats:unique.internationalVsDomesticDesc", {
                  international: uniqueStats.internationalVsDomestic.international,
                  domestic: uniqueStats.internationalVsDomestic.domestic,
                  ratio: uniqueStats.internationalVsDomestic.ratio.toFixed(2),
                })}
              </p>
            </div>
          )}

          {uniqueStats.roundTripMaster !== undefined && (
            <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.roundTripMaster")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.roundTripMaster}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.roundTripMasterDesc", {
                  count: uniqueStats.roundTripMaster,
                })}
              </p>
            </div>
          )}

          {uniqueStats.highestAirport && (
            <div className="bg-gradient-to-br from-gray-600 to-gray-700 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.highestAirport")}
              </h3>
              <p className="text-2xl font-bold mb-1">{uniqueStats.highestAirport.name}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.highestAirportDesc", {
                  name: uniqueStats.highestAirport.name,
                  code: uniqueStats.highestAirport.code,
                  altitude: uniqueStats.highestAirport.altitude,
                })}
              </p>
            </div>
          )}

          {uniqueStats.northernmost && (
            <div className="bg-gradient-to-br from-sky-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.northernmost")}
              </h3>
              <p className="text-2xl font-bold mb-1">{uniqueStats.northernmost.code}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.northernmostDesc", {
                  code: uniqueStats.northernmost.code,
                  lat: uniqueStats.northernmost.lat.toFixed(2),
                })}
              </p>
            </div>
          )}

          {uniqueStats.southernmost && (
            <div className="bg-gradient-to-br from-teal-500 to-green-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.southernmost")}
              </h3>
              <p className="text-2xl font-bold mb-1">{uniqueStats.southernmost.code}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.southernmostDesc", {
                  code: uniqueStats.southernmost.code,
                  lat: Math.abs(uniqueStats.southernmost.lat).toFixed(2),
                })}
              </p>
            </div>
          )}

          {uniqueStats.longestTravelChain > 1 && (
            <div className="bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.longestTravelChain")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.longestTravelChain}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.longestTravelChainDesc", {
                  count: uniqueStats.longestTravelChain,
                })}
              </p>
            </div>
          )}

          {uniqueStats.fastestRoute && (
            <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.fastestRoute")}
              </h3>
              <p className="text-2xl font-bold mb-1">{uniqueStats.fastestRoute.route}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.fastestRouteDesc", {
                  route: uniqueStats.fastestRoute.route,
                  speed: uniqueStats.fastestRoute.speed,
                })}
              </p>
            </div>
          )}

          {uniqueStats.mostCountriesInDay > 0 && uniqueStats.mostCountriesDate && (
            <div className="bg-gradient-to-br from-rose-500 to-pink-500 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.mostCountriesInDay")}
              </h3>
              <p className="text-4xl font-bold mb-1">{uniqueStats.mostCountriesInDay}</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.mostCountriesInDayDesc", {
                  count: uniqueStats.mostCountriesInDay,
                  date: new Date(uniqueStats.mostCountriesDate).toLocaleDateString(),
                })}
              </p>
            </div>
          )}

          {uniqueStats.longestLayover && (
            <div className="bg-gradient-to-br from-amber-600 to-orange-600 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t("stats:unique.longestLayover")}
              </h3>
              <p className="text-3xl font-bold mb-1">{uniqueStats.longestLayover.hours}h</p>
              <p className="text-sm opacity-75">
                {t("stats:unique.longestLayoverDesc", {
                  hours: uniqueStats.longestLayover.hours,
                  from: uniqueStats.longestLayover.from,
                })}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg shadow p-6 text-center"
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
