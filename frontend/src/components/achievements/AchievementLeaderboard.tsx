import type { JSX } from "react";
import type { LeaderboardEntry } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useLocale } from "../../hooks/useLocale";
import PageHeader from "../ui/PageHeader";
import { TIER_COLOR } from "./AchievementCard";

/** The first three ranks take the metal they are named after. */
const RANK_COLOR: Record<number, string> = {
  1: TIER_COLOR.gold,
  2: TIER_COLOR.silver,
  3: TIER_COLOR.bronze,
};

/**
 * The instance leaderboard. A view of the achievements page rather than a
 * route, so the back link returns to the same filters.
 */
export default function AchievementLeaderboard({
  entries,
  onBack,
}: {
  entries: LeaderboardEntry[];
  onBack: () => void;
}): JSX.Element {
  const { t } = useTranslation(["achievements"]);
  const locale = useLocale();

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="ts-back-link mb-3 inline-flex items-center gap-1.5 text-sm"
        style={{ color: "var(--ts-muted)" }}
      >
        <span aria-hidden>←</span>
        {t("achievements:title")}
      </button>
      <PageHeader title={t("achievements:leaderboard.title")} />
      {entries.length === 0 ? (
        <div className="py-12 text-center">
          <h3 style={{ fontSize: 20, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {t("achievements:leaderboard.emptyTitle")}
          </h3>
          <p className="t-caption mt-1">{t("achievements:leaderboard.emptyMessage")}</p>
        </div>
      ) : (
        <ol
          className="divide-y divide-[var(--ts-border)] overflow-hidden"
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-card)",
          }}
        >
          {entries.map((entry) => (
            <li key={entry.rank} className="flex items-center gap-4 px-5 py-3">
              <span
                className="w-10 text-center text-lg font-bold"
                style={{
                  fontFamily: "var(--ts-font-mono)",
                  color: RANK_COLOR[entry.rank] ?? "var(--ts-muted)",
                }}
              >
                {entry.rank}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>
                  {entry.username}
                </span>
                <span className="t-caption">
                  {t("achievements:leaderboard.achievementCount", {
                    count: entry.achievementCount,
                  })}
                </span>
              </span>
              <span className="text-right" style={{ fontFamily: "var(--ts-font-mono)" }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ts-accent)" }}>
                  {entry.totalPoints.toLocaleString(locale)}
                </span>
                <span className="t-caption"> {t("achievements:leaderboard.points")}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
