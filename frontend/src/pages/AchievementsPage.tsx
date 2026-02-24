import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { achievementsApi } from "../lib/api";
import ContextualHint from "../components/Onboarding/ContextualHint";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import type { Achievement, AchievementSummary, LeaderboardEntry } from "../types";
import { STORAGE_KEYS } from "../lib/constants";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";

const tierTextColorValues: Record<string, string> = {
  bronze: "#f59e0b",
  silver: "var(--text-muted)",
  gold: "var(--accent)",
  platinum: "#22d3ee",
  diamond: "#a855f7",
};

export default function AchievementsPage(): JSX.Element {
  const { t } = useTranslation(["achievements", "common"]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [showUnlockedOnly, setShowUnlockedOnly] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const categoryNames: Record<string, string> = {
    explorer: t("achievements:categories.explorer"),
    distance: t("achievements:categories.distance"),
    collector: t("achievements:categories.collector"),
    elite: t("achievements:categories.elite"),
    special: t("achievements:categories.special"),
  };

  useEffect(() => {
    loadAchievements();
    loadLeaderboard();
    const onboarding = JSON.parse(localStorage.getItem(STORAGE_KEYS.ONBOARDING_CHECKLIST) || "{}");
    if (!onboarding.achievementsViewed) {
      onboarding.achievementsViewed = true;
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(onboarding));
    }
  }, []);

  const loadAchievements = async () => {
    try {
      setLoading(true);
      const data = await achievementsApi.getAll();
      setAchievements(data.achievements);
      setSummary(data.summary);
    } catch (error) {
      logger.error("Failed to load achievements:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const data = await achievementsApi.getLeaderboard(20);
      setLeaderboard(data.leaderboard);
    } catch (error) {
      logger.error("Failed to load leaderboard:", error);
    }
  };

  const handleCheckAchievements = async () => {
    try {
      const result = await achievementsApi.checkAchievements();
      if (result.newlyUnlocked > 0) {
        alert(t("achievements:alerts.unlocked", { count: result.newlyUnlocked }));
        loadAchievements();
      } else {
        alert(t("achievements:alerts.none"));
      }
    } catch (error) {
      logger.error("Failed to check achievements:", error);
    }
  };

  const filteredAchievements = achievements.filter((ach) => {
    if (selectedCategory !== "all" && ach.category !== selectedCategory) return false;
    if (selectedTier !== "all" && ach.tier !== selectedTier) return false;
    if (showUnlockedOnly && !ach.isUnlocked) return false;
    return true;
  });

  const groupedAchievements = filteredAchievements.reduce(
    (acc, ach) => {
      if (!acc[ach.category]) {
        acc[ach.category] = [];
      }
      acc[ach.category].push(ach);
      return acc;
    },
    {} as Record<string, Achievement[]>
  );
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-base)" }}
      >
        <div style={{ color: "var(--text-primary)" }} className="text-xl">
          {t("achievements:loading")}
        </div>
      </div>
    );
  }

  if (showLeaderboard) {
    return (
      <PageTransition>
        <div
          className="min-h-screen"
          style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
        >
          <NavigationBar />
          <div className="p-6">
            <div className="max-w-6xl mx-auto">
              <ContextualHint
                id="achievements-page-hint"
                title={t("achievements:hint.title")}
                message={t("achievements:hint.message")}
                linkTo="/"
                linkText={t("achievements:hint.linkText")}
              />
              <div className="flex items-center gap-4 mb-6">
                <button
                  onClick={() => setShowLeaderboard(false)}
                  style={{ color: "var(--text-muted)" }}
                  className="hover:opacity-80 transition-opacity"
                >
                  {t("achievements:leaderboard.backToAchievements")}
                </button>
                <h1 className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                  🏆 {t("achievements:leaderboard.title")}
                </h1>
              </div>
              <div
                className="rounded-xl p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                {leaderboard.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">🏆</div>
                    <h3
                      className="text-2xl font-bold mb-2"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {t("achievements:leaderboard.emptyTitle")}
                    </h3>
                    <p style={{ color: "var(--text-muted)" }}>
                      {t("achievements:leaderboard.emptyMessage")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => (
                      <div
                        key={entry.rank}
                        className="flex items-center gap-4 p-4 rounded-lg"
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <div
                          className="text-3xl font-bold w-12 text-center"
                          style={{
                            color:
                              entry.rank === 1
                                ? "var(--accent)"
                                : entry.rank === 2
                                  ? "var(--text-muted)"
                                  : entry.rank === 3
                                    ? "#d97706"
                                    : "var(--text-muted)",
                          }}
                        >
                          {entry.rank === 1
                            ? "🥇"
                            : entry.rank === 2
                              ? "🥈"
                              : entry.rank === 3
                                ? "🥉"
                                : `#${entry.rank}`}
                        </div>
                        <div className="flex-1">
                          <div
                            className="text-xl font-semibold"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {entry.username}
                          </div>
                          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                            {t("achievements:leaderboard.achievementCount", {
                              count: entry.achievementCount,
                            })}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                            {entry.totalPoints.toLocaleString()}
                          </div>
                          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                            {t("achievements:leaderboard.points")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }
  return (
    <PageTransition>
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <NavigationBar />
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                🏆 {t("achievements:title")}
              </h1>
            </div>
            <ContextualHint
              id="achievements-page-hint"
              title={t("achievements:hint.title")}
              message={t("achievements:hint.message")}
              linkTo="/"
              linkText={t("achievements:hint.linkText")}
            />
            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div
                  className="rounded-xl p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:summary.totalPoints")}
                  </div>
                  <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
                    {summary.totalPoints.toLocaleString()}
                  </div>
                </div>
                <div
                  className="rounded-xl p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:summary.unlocked")}
                  </div>
                  <div className="text-3xl font-bold" style={{ color: "var(--success)" }}>
                    {summary.unlockedAchievements} / {summary.totalAchievements}
                  </div>
                </div>
                <div
                  className="rounded-xl p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:summary.progress")}
                  </div>
                  <div className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {summary.totalAchievements > 0
                      ? Math.round((summary.unlockedAchievements / summary.totalAchievements) * 100)
                      : 0}
                    %
                  </div>
                </div>
                <button
                  onClick={() => setShowLeaderboard(true)}
                  className="rounded-xl p-6 transition-all text-left"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:summary.leaderboard")}
                  </div>
                  <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
                    {t("achievements:summary.view")}
                  </div>
                </button>
              </div>
            )}
            <div className="flex gap-4 mb-6">
              <button
                onClick={handleCheckAchievements}
                className="px-6 py-3 rounded-lg font-semibold transition-all"
                style={{ background: "var(--success)", color: "#0d1117" }}
              >
                {t("achievements:checkNew")}
              </button>
            </div>
            <div
              className="rounded-xl p-6 mb-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:filters.category")}
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-4 py-2 rounded-lg"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <option value="all">{t("achievements:filters.allCategories")}</option>
                    {Object.entries(categoryNames).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("achievements:filters.tier")}
                  </label>
                  <select
                    value={selectedTier}
                    onChange={(e) => setSelectedTier(e.target.value)}
                    className="px-4 py-2 rounded-lg"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <option value="all">{t("achievements:filters.allTiers")}</option>
                    <option value="bronze">{t("achievements:tiers.bronze")}</option>
                    <option value="silver">{t("achievements:tiers.silver")}</option>
                    <option value="gold">{t("achievements:tiers.gold")}</option>
                    <option value="platinum">{t("achievements:tiers.platinum")}</option>
                    <option value="diamond">{t("achievements:tiers.diamond")}</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showUnlockedOnly}
                      onChange={(e) => setShowUnlockedOnly(e.target.checked)}
                      className="checkbox"
                    />
                    <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {t("achievements:filters.showUnlockedOnly")}
                    </span>
                  </label>
                </div>
              </div>
            </div>{" "}
            <div className="space-y-8">
              {Object.entries(groupedAchievements).map(([category, categoryAchievements]) => (
                <div key={category}>
                  <h2 className="text-2xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    {categoryNames[category] || category}
                  </h2>
                  <motion.div
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    initial="hidden"
                    animate="visible"
                    variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
                  >
                    {categoryAchievements.map((achievement, index) => (
                      <motion.div
                        key={achievement.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.04, duration: 0.2 }}
                        whileHover={achievement.isUnlocked ? { scale: 1.04 } : {}}
                        className="relative rounded-xl overflow-hidden cursor-pointer"
                        style={{
                          background: "var(--bg-surface)",
                          border: "1px solid var(--color-border)",
                          boxShadow: achievement.isUnlocked
                            ? "0 0 12px var(--accent-glow)"
                            : "none",
                          filter: achievement.isUnlocked ? "none" : "grayscale(0.8)",
                          opacity: achievement.isUnlocked ? 1 : 0.55,
                        }}
                      >
                        <div className="p-6">
                          <div className="flex items-start justify-between mb-3">
                            <div className="text-4xl">{achievement.icon}</div>
                            <div
                              className="text-xs font-bold uppercase px-2 py-1 rounded"
                              style={{
                                color: achievement.isUnlocked
                                  ? tierTextColorValues[achievement.tier]
                                  : "var(--text-muted)",
                              }}
                            >
                              {t(`achievements:tiers.${achievement.tier}`)}
                            </div>
                          </div>
                          <h3
                            className="text-xl font-bold mb-2"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {achievement.name}
                          </h3>
                          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                            {achievement.description}
                          </p>
                          {!achievement.isUnlocked && (
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span style={{ color: "var(--text-muted)" }}>
                                  {t("achievements:progress.label")}
                                </span>
                                <span
                                  className="font-semibold"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {achievement.progress} / {achievement.requirement}
                                </span>
                              </div>
                              <div
                                className="w-full rounded-full h-2"
                                style={{ background: "var(--bg-muted)" }}
                              >
                                <div
                                  className="h-2 rounded-full transition-all"
                                  style={{
                                    width: `${achievement.progressPercentage}%`,
                                    background: "var(--accent)",
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {achievement.isUnlocked && (
                            <div className="flex items-center justify-between mt-4">
                              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                                {t("achievements:progress.unlocked", {
                                  date:
                                    achievement.unlockedAt &&
                                    new Date(achievement.unlockedAt).toLocaleDateString(),
                                })}
                              </span>
                              <span
                                className="text-lg font-bold"
                                style={{ color: "var(--accent)" }}
                              >
                                +{achievement.points}
                              </span>
                            </div>
                          )}
                        </div>
                        {!achievement.isUnlocked && (
                          <div
                            className="absolute inset-0 flex items-center justify-center rounded-xl"
                            style={{
                              background: "rgba(13,17,23,0.4)",
                              backdropFilter: "blur(2px)",
                            }}
                          >
                            <svg
                              className="w-8 h-8"
                              style={{ color: "var(--text-muted)" }}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                              />
                            </svg>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              ))}
            </div>
            {filteredAchievements.length === 0 && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🏆</div>
                <h3 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
                  {t("achievements:empty.title")}
                </h3>
                <p style={{ color: "var(--text-muted)" }}>{t("achievements:empty.message")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
