import type { FunStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import StatCard from "./StatCard";
import { formatDate } from "../../lib/displayFormat";

interface StatsFunSectionProps {
  funStats: FunStats;
}

export default function StatsFunSection({ funStats }: StatsFunSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  /**
   * Every served measure on this surface is registered `scopes: ["allTime"]`
   * and this section is built from the full countable set, never the page's
   * year filter — so the scope it sends is the scope the tile measured.
   *
   * The four tiles WITHOUT an `evidence` prop are unserved on purpose: the
   * loyalty score is a `ratio` and the fastest day, the milestone year and
   * the route master are `extremum` measures, and release 1 serves neither
   * (`shared/evidenceMeasuresFlightFun.ts`). Wiring a tile whose key has no
   * resolver ships a pointer cursor over a 404.
   */
  const allTime = { period: "allTime" as const };

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:fun.title")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          evidence={{
            kind: "metric",
            key: "timezoneHopperFlightCount",
            scope: allTime,
            renderedValue: funStats.timezoneHopper,
          }}
          title={t("stats:fun.timezoneHopper")}
          value={funStats.timezoneHopper}
          description={t("stats:fun.timezoneHopperDesc", { count: funStats.timezoneHopper })}
        />
        <StatCard
          evidence={{
            kind: "metric",
            key: "earlyBirdFlightCount",
            scope: allTime,
            renderedValue: funStats.earlyBird,
          }}
          title={t("stats:fun.earlyBird")}
          value={funStats.earlyBird}
          description={t("stats:fun.earlyBirdDesc", { count: funStats.earlyBird })}
        />
        <StatCard
          evidence={{
            kind: "metric",
            key: "nightOwlFlightCount",
            scope: allTime,
            renderedValue: funStats.nightOwl,
          }}
          title={t("stats:fun.nightOwl")}
          value={funStats.nightOwl}
          description={t("stats:fun.nightOwlDesc", { count: funStats.nightOwl })}
        />
        <StatCard
          evidence={{
            kind: "metric",
            key: "weekendFlightCount",
            scope: allTime,
            renderedValue: funStats.weekendWarrior,
          }}
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
          evidence={{
            kind: "metric",
            key: "shortHaulFlightCount",
            scope: allTime,
            renderedValue: funStats.shortHaulKing,
          }}
          title={t("stats:fun.shortHaulKing")}
          value={funStats.shortHaulKing}
          description={t("stats:fun.shortHaulKingDesc", { count: funStats.shortHaulKing })}
        />
        <StatCard
          evidence={{
            kind: "metric",
            key: "longHaulFlightCount",
            scope: allTime,
            renderedValue: funStats.longHaulPilot,
          }}
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
              date: formatDate(funStats.fastestDay),
              count: funStats.fastestDayFlights,
            })}
          />
        )}
        <StatCard
          evidence={{
            kind: "metric",
            key: "co2FootprintKg",
            scope: allTime,
            renderedValue: funStats.co2FootprintKg,
          }}
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
