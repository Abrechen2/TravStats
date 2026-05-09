import type { FunStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import StatCard from "./StatCard";

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
        <StatCard
          title={t("stats:fun.timezoneHopper")}
          value={funStats.timezoneHopper}
          description={t("stats:fun.timezoneHopperDesc", { count: funStats.timezoneHopper })}
        />
        <StatCard
          title={t("stats:fun.earlyBird")}
          value={funStats.earlyBird}
          description={t("stats:fun.earlyBirdDesc", { count: funStats.earlyBird })}
        />
        <StatCard
          title={t("stats:fun.nightOwl")}
          value={funStats.nightOwl}
          description={t("stats:fun.nightOwlDesc", { count: funStats.nightOwl })}
        />
        <StatCard
          title={t("stats:fun.weekendWarrior")}
          value={funStats.weekendWarrior}
          description={t("stats:fun.weekendWarriorDesc", {
            count: funStats.weekendWarrior,
            percentage: funStats.weekendPercentage,
          })}
        />
        <StatCard
          title={t("stats:fun.loyaltyScore")}
          value={`${funStats.loyaltyScore}%`}
          description={t("stats:fun.loyaltyScoreDesc", {
            score: funStats.loyaltyScore,
            airline: funStats.mostUsedAirline || "N/A",
          })}
        />
        <StatCard
          title={t("stats:fun.shortHaulKing")}
          value={funStats.shortHaulKing}
          description={t("stats:fun.shortHaulKingDesc", { count: funStats.shortHaulKing })}
        />
        <StatCard
          title={t("stats:fun.longHaulPilot")}
          value={funStats.longHaulPilot}
          description={t("stats:fun.longHaulPilotDesc", { count: funStats.longHaulPilot })}
        />
        {funStats.fastestDay && (
          <StatCard
            title={t("stats:fun.fastestDay")}
            value={funStats.fastestDayFlights}
            valueSize="sm"
            description={t("stats:fun.fastestDayDesc", {
              date: new Date(funStats.fastestDay).toLocaleDateString(),
              count: funStats.fastestDayFlights,
            })}
          />
        )}
        <StatCard
          title={t("stats:fun.co2Footprint")}
          value={`${funStats.co2FootprintKg.toLocaleString()} kg`}
          valueSize="md"
          description={t("stats:fun.co2FootprintDesc", {
            kg: funStats.co2FootprintKg.toLocaleString(),
            elephants: funStats.co2InElephants.toFixed(1),
          })}
        />
        {funStats.milestoneYear && (
          <StatCard
            title={t("stats:fun.milestoneYear")}
            value={funStats.milestoneYear}
            description={t("stats:fun.milestoneYearDesc", {
              year: funStats.milestoneYear,
              count: funStats.milestoneYearFlights,
            })}
          />
        )}
        {funStats.routeMaster && (
          <StatCard
            title={t("stats:fun.routeMaster")}
            value={funStats.routeMaster}
            valueSize="sm"
            description={t("stats:fun.routeMasterDesc", {
              route: funStats.routeMaster,
              count: funStats.routeMasterCount,
            })}
          />
        )}
      </div>
    </div>
  );
}
