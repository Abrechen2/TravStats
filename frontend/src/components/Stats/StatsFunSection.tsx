import type { FunStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface StatsFunSectionProps {
  funStats: FunStats;
}

export default function StatsFunSection({ funStats }: StatsFunSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:fun.title")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.timezoneHopper")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.timezoneHopper}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.timezoneHopperDesc", { count: funStats.timezoneHopper })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.earlyBird")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.earlyBird}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.earlyBirdDesc", { count: funStats.earlyBird })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-indigo-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.nightOwl")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.nightOwl}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.nightOwlDesc", { count: funStats.nightOwl })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-pink-500 to-rose-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.weekendWarrior")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.weekendWarrior}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.weekendWarriorDesc", {
              count: funStats.weekendWarrior,
              percentage: funStats.weekendPercentage,
            })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.loyaltyScore")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.loyaltyScore}%</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.loyaltyScoreDesc", {
              score: funStats.loyaltyScore,
              airline: funStats.mostUsedAirline || "N/A",
            })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.shortHaulKing")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.shortHaulKing}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.shortHaulKingDesc", { count: funStats.shortHaulKing })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-red-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.longHaulPilot")}</h3>
          <p className="text-4xl font-bold mb-1">{funStats.longHaulPilot}</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.longHaulPilotDesc", { count: funStats.longHaulPilot })}
          </p>
        </div>

        {funStats.fastestDay && (
          <div className="bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.fastestDay")}</h3>
            <p className="text-2xl font-bold mb-1">{funStats.fastestDayFlights}</p>
            <p className="text-sm opacity-75">
              {t("stats:fun.fastestDayDesc", {
                date: new Date(funStats.fastestDay).toLocaleDateString(),
                count: funStats.fastestDayFlights,
              })}
            </p>
          </div>
        )}

        <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.co2Footprint")}</h3>
          <p className="text-3xl font-bold mb-1">{funStats.co2FootprintKg.toLocaleString()} kg</p>
          <p className="text-sm opacity-75">
            {t("stats:fun.co2FootprintDesc", {
              kg: funStats.co2FootprintKg.toLocaleString(),
              elephants: funStats.co2InElephants.toFixed(1),
            })}
          </p>
        </div>

        {funStats.milestoneYear && (
          <div className="bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.milestoneYear")}</h3>
            <p className="text-4xl font-bold mb-1">{funStats.milestoneYear}</p>
            <p className="text-sm opacity-75">
              {t("stats:fun.milestoneYearDesc", {
                year: funStats.milestoneYear,
                count: funStats.milestoneYearFlights,
              })}
            </p>
          </div>
        )}

        {funStats.routeMaster && (
          <div className="bg-gradient-to-br from-sky-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.routeMaster")}</h3>
            <p className="text-2xl font-bold mb-1">{funStats.routeMaster}</p>
            <p className="text-sm opacity-75">
              {t("stats:fun.routeMasterDesc", {
                route: funStats.routeMaster,
                count: funStats.routeMasterCount,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
