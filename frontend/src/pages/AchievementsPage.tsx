import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { achievementsApi } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { SkeletonAchievementGrid } from "../components/SkeletonLoader";
import type { Achievement, AchievementSummary, LeaderboardEntry } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { useLocale } from "../hooks/useLocale";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import type { DomainKey } from "../shared/domains";

/**
 * Filter achievements down to the ones the user should currently see based on
 * their enabled domains. `shared` achievements are always visible; anything
 * else must match one of the user's enabled domains.
 *
 * Exported so it can be unit-tested in isolation without spinning up the full
 * page (which pulls in NavigationBar, framer-motion, auth store, and other
 * heavy dependencies).
 */
export function filterAchievementsByDomain(
  achievements: Achievement[],
  enabled: DomainKey[]
): Achievement[] {
  return achievements.filter(
    (a) => a.domain === "shared" || enabled.includes(a.domain as DomainKey)
  );
}

/**
 * Tier colours, from the token layer.
 *
 * Three of the five were literals here — bronze, platinum and diamond — while
 * silver and gold pointed at app variables. They happened to match
 * `tierColor` in `design/tokens.json`, which is luck rather than a guarantee:
 * nothing tied them together, so a change upstream would have moved three of
 * the five and left two behind.
 */
const tierTextColorValues: Record<string, string> = {
  bronze: "var(--ts-tier-bronze)",
  silver: "var(--ts-tier-silver)",
  gold: "var(--ts-tier-gold)",
  platinum: "var(--ts-tier-platinum)",
  diamond: "var(--ts-tier-diamond)",
};

export default function AchievementsPage(): JSX.Element {
  const { t } = useTranslation(["achievements", "common"]);
  const locale = useLocale();
  const { addToast } = useToastStore();
  const { enabled } = useEnabledDomains();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTier, setSelectedTier] = useState<string>("all");
  // Domain filter chip row. `all` shows everything the user's enabled domains
  // allow; `shared` narrows to cross-domain achievements; otherwise a specific
  // domain. Works on top of `visibleAchievements` which already hides disabled
  // domains, so this filter is purely a user-picked narrowing.
  const [selectedDomain, setSelectedDomain] = useState<"all" | "shared" | DomainKey>("all");
  const [showUnlockedOnly, setShowUnlockedOnly] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Hide achievements that belong to domains the user hasn't enabled. `shared`
  // achievements always stay visible. This is the baseline for category counts
  // and the rendered grid — stats are derived from the backend summary, which
  // already reflects what the user has unlocked across all domains, so we only
  // filter the per-card rendering.
  const visibleAchievements = useMemo(
    () => filterAchievementsByDomain(achievements, enabled),
    [achievements, enabled]
  );

  const categoryNames: Record<string, string> = {
    explorer: t("achievements:categories.explorer"),
    distance: t("achievements:categories.distance"),
    collector: t("achievements:categories.collector"),
    elite: t("achievements:categories.elite"),
    special: t("achievements:categories.special"),
    planner: t("achievements:categories.planner"),
    survivor: t("achievements:categories.survivor"),
    kurios: t("achievements:categories.kurios"),
  };

  useEffect(() => {
    loadAchievements();
    loadLeaderboard();
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
        addToast("success", t("achievements:alerts.unlocked", { count: result.newlyUnlocked }));
        loadAchievements();
      } else {
        addToast("info", t("achievements:alerts.none"));
      }
    } catch (error) {
      logger.error("Failed to check achievements:", error);
    }
  };

  const filteredAchievements = visibleAchievements.filter((ach) => {
    if (selectedCategory !== "all" && ach.category !== selectedCategory) return false;
    if (selectedTier !== "all" && ach.tier !== selectedTier) return false;
    if (selectedDomain !== "all" && ach.domain !== selectedDomain) return false;
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
      <PageTransition>
        <div
          className="min-h-screen"
          style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
        >
          <NavigationBar />
          <div className="p-4 sm:p-6 pb-24">
            <div className="max-w-7xl mx-auto">
              <SkeletonAchievementGrid />
            </div>
          </div>
        </div>
      </PageTransition>
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
          <div className="p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center gap-4 mb-6">
                <button
                  onClick={() => setShowLeaderboard(false)}
                  style={{ color: "var(--text-muted)" }}
                  className="hover:opacity-80 transition-opacity"
                >
                  {t("achievements:leaderboard.backToAchievements")}
                </button>
                <h1 className="t-screen-title">🏆 {t("achievements:leaderboard.title")}</h1>
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
                            {entry.totalPoints.toLocaleString(locale)}
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
        <div className="p-4 sm:p-6 pb-32">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="t-screen-title">🏆 {t("achievements:title")}</h1>
            </div>
            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
                    {summary.totalPoints.toLocaleString(locale)}
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
                className="btn-primary px-6 py-3 rounded-lg font-semibold transition-all"
              >
                {t("achievements:checkNew")}
              </button>
            </div>
            <div
              className="rounded-xl p-6 mb-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              {/* Domain chip row — lives above the category / tier selects so
                  the two-level hierarchy (domain → category → tier) reads
                  top-down. "shared" is kept as its own chip because it's a
                  useful cut ("what counts everywhere?"). */}
              <div className="mb-4">
                <label className="block text-sm mb-2" style={{ color: "var(--text-muted)" }}>
                  {t("achievements:filters.domain")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: "all", label: t("achievements:filters.allDomains") },
                      ...(enabled.includes("flight" as DomainKey)
                        ? [
                            {
                              id: "flight",
                              label: `✈ ${t("achievements:filters.domainFlight")}`,
                            },
                          ]
                        : []),
                      ...(enabled.includes("cruise" as DomainKey)
                        ? [
                            {
                              id: "cruise",
                              label: `🚢 ${t("achievements:filters.domainCruise")}`,
                            },
                          ]
                        : []),
                      ...(enabled.includes("lodging" as DomainKey)
                        ? [
                            {
                              id: "lodging",
                              label: `🏨 ${t("achievements:filters.domainLodging")}`,
                            },
                          ]
                        : []),
                      ...(enabled.includes("poi" as DomainKey)
                        ? [
                            {
                              id: "poi",
                              label: `📍 ${t("achievements:filters.domainPoi")}`,
                            },
                          ]
                        : []),
                      { id: "shared", label: t("achievements:filters.domainShared") },
                    ] as Array<{ id: "all" | "shared" | DomainKey; label: string }>
                  ).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={(): void => setSelectedDomain(chip.id)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                      style={{
                        background:
                          selectedDomain === chip.id ? "var(--accent)" : "var(--bg-elevated)",
                        color: selectedDomain === chip.id ? "#fff" : "var(--text-muted)",
                        borderColor:
                          selectedDomain === chip.id ? "var(--accent)" : "var(--color-border)",
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
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
              {Object.entries(groupedAchievements).map(([category, categoryAchievements]) => {
                const hiddenInCategory = categoryAchievements.filter(
                  (a) => a.isHidden && !a.isUnlocked
                );
                const visibleInCategory = categoryAchievements.filter((a) => !a.isHidden);
                const visibleUnlocked = visibleInCategory.filter((a) => a.isUnlocked).length;
                const showHiddenHint =
                  hiddenInCategory.length > 0 &&
                  visibleInCategory.length > 0 &&
                  visibleUnlocked / visibleInCategory.length >= 0.5;
                return (
                  <div key={category}>
                    <h2
                      className="text-2xl font-bold mb-4"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {categoryNames[category] || category}
                    </h2>
                    {showHiddenHint && (
                      <div
                        className="rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-3"
                        style={{
                          background: "rgba(207,141,32,0.08)",
                          border: "1px solid rgba(207,141,32,0.25)",
                          color: "var(--accent)",
                        }}
                      >
                        <span className="text-lg">🕵️</span>
                        <span>
                          {t("achievements:hiddenHint", {
                            count: hiddenInCategory.length,
                            defaultValue:
                              "{{count}} hidden achievement(s) waiting in this category — unusual timings, rare routes or specific seat choices could unlock them.",
                          })}
                        </span>
                      </div>
                    )}
                    <motion.div
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                      initial="hidden"
                      animate="visible"
                      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
                    >
                      {categoryAchievements.map((achievement, index) => {
                        const isMystery = Boolean(achievement.isHidden) && !achievement.isUnlocked;
                        return (
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
                              filter: achievement.isUnlocked ? "none" : "grayscale(0.5)",
                              opacity: achievement.isUnlocked ? 1 : 0.6,
                            }}
                          >
                            <div className="p-6">
                              <div className="flex items-start justify-between mb-3">
                                <div className="text-4xl">
                                  {isMystery ? "❔" : achievement.icon}
                                </div>
                                <div
                                  className="text-xs font-bold uppercase px-2 py-1 rounded-sm"
                                  style={{
                                    color: achievement.isUnlocked
                                      ? tierTextColorValues[achievement.tier]
                                      : "var(--text-muted)",
                                  }}
                                >
                                  {isMystery
                                    ? t("achievements:hiddenBadge", { defaultValue: "Hidden" })
                                    : t(`achievements:tiers.${achievement.tier}`)}
                                </div>
                              </div>
                              <h3
                                className="text-xl font-bold mb-2"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {isMystery
                                  ? "???"
                                  : t(`achievements:codes.${achievement.code}.name`, {
                                      defaultValue: achievement.name,
                                    })}
                              </h3>
                              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                                {isMystery
                                  ? t("achievements:hiddenDescription", {
                                      defaultValue:
                                        "Hidden achievement — complete it to reveal the details.",
                                    })
                                  : t(`achievements:codes.${achievement.code}.description`, {
                                      defaultValue: achievement.description,
                                    })}
                              </p>
                              {!achievement.isUnlocked && !isMystery && (
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
                              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                                <svg
                                  className="w-10 h-10"
                                  style={{ color: "var(--text-muted)", opacity: 0.5 }}
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
                        );
                      })}
                    </motion.div>
                  </div>
                );
              })}
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
