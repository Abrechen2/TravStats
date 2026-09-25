import { useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import { achievementsApi } from "../lib/api";
import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import PageHeader from "../components/ui/PageHeader";
import { Icon } from "../components/ui/Icon";
import { SkeletonAchievementGrid } from "../components/SkeletonLoader";
import AchievementCard, { TIER_COLOR } from "../components/achievements/AchievementCard";
import AchievementDetailModal from "../components/achievements/AchievementDetailModal";
import AchievementLeaderboard from "../components/achievements/AchievementLeaderboard";
import EvidencePanel from "../components/evidence/EvidencePanel";
import type { Achievement, AchievementSummary, LeaderboardEntry } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { useLocale } from "../hooks/useLocale";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { countAchievements } from "../lib/achievementCounts";
import { AVAILABLE_DOMAINS, type DomainKey } from "../shared/domains";

/**
 * Filter achievements down to the ones the user should currently see based on
 * their enabled domains. `shared` achievements are always visible; anything
 * else must match one of the user's enabled domains.
 *
 * Exported so it can be unit-tested in isolation without spinning up the full
 * page (which pulls in NavigationBar, auth store, and other heavy dependencies).
 */
export function filterAchievementsByDomain(
  achievements: Achievement[],
  enabled: DomainKey[]
): Achievement[] {
  return achievements.filter(
    (a) => a.domain === "shared" || enabled.includes(a.domain as DomainKey)
  );
}

const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
const CATEGORIES = [
  "explorer",
  "distance",
  "collector",
  "elite",
  "special",
  "planner",
  "survivor",
  "kurios",
] as const;
const DOMAIN_LABEL: Record<DomainKey, string> = {
  flight: "achievements:filters.domainFlight",
  cruise: "achievements:filters.domainCruise",
  lodging: "achievements:filters.domainLodging",
  poi: "achievements:filters.domainPoi",
  roadtrip: "achievements:filters.domainRoadtrip",
  rail: "achievements:filters.domainRail",
};

type DomainFilter = "all" | "shared" | DomainKey;
type StateFilter = "all" | "unlocked" | "open";

function Pill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold"
      style={{
        background: active ? "var(--ts-accent)" : "transparent",
        color: active ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
        border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border)"}`,
      }}
    >
      {children}
      {count !== undefined && (
        <span className="text-xs" style={{ fontFamily: "var(--ts-font-mono)", opacity: 0.75 }}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The achievements page, round 4 ("Erfolge"): a header with the totals in its
 * meta line and the actions beside it, a strip of the five tiers (which also
 * filters), one row of pills for category, area and state, and a flat grid of
 * compact cards.
 *
 * It replaces four figure tiles — one of which was a button reading
 * "Ansehen" — a boxed filter form with two selects and a checkbox, and a grid
 * grouped under a 24px heading per category, which made the category filter
 * and the grouping say the same thing twice.
 */
export default function AchievementsPage(): JSX.Element {
  const { t } = useTranslation(["achievements", "common"]);
  const locale = useLocale();
  const { addToast } = useToastStore();
  const { enabled } = useEnabledDomains();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  /** The card whose detail dialog is open, or null (#330). */
  const [selected, setSelected] = useState<Achievement | null>(null);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [selectedDomain, setSelectedDomain] = useState<DomainFilter>("all");
  const [selectedState, setSelectedState] = useState<StateFilter>("all");
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Achievements of areas the user has not enabled stay out of every count
  // and the grid; `shared` ones always stay.
  const visibleAchievements = useMemo(
    () => filterAchievementsByDomain(achievements, enabled),
    [achievements, enabled]
  );

  useEffect(() => {
    void loadAchievements();
    void loadLeaderboard();
  }, []);

  const loadAchievements = async (): Promise<void> => {
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

  const loadLeaderboard = async (): Promise<void> => {
    try {
      const data = await achievementsApi.getLeaderboard(20);
      setLeaderboard(data.leaderboard);
    } catch (error) {
      logger.error("Failed to load leaderboard:", error);
    }
  };

  const handleCheckAchievements = async (): Promise<void> => {
    try {
      const result = await achievementsApi.checkAchievements();
      if (result.newlyUnlocked > 0) {
        addToast("success", t("achievements:alerts.unlocked", { count: result.newlyUnlocked }));
        void loadAchievements();
      } else {
        addToast("info", t("achievements:alerts.none"));
      }
    } catch (error) {
      logger.error("Failed to check achievements:", error);
    }
  };

  const filtered = visibleAchievements.filter((ach) => {
    if (selectedCategory !== "all" && ach.category !== selectedCategory) return false;
    if (selectedTier !== "all" && ach.tier !== selectedTier) return false;
    if (selectedDomain !== "all" && ach.domain !== selectedDomain) return false;
    if (selectedState === "unlocked" && !ach.isUnlocked) return false;
    if (selectedState === "open" && ach.isUnlocked) return false;
    return true;
  });

  // Unlocked first (newest first), then open ones by how close they are.
  const sorted = [...filtered].sort((a, b) => {
    if (a.isUnlocked !== b.isUnlocked) return a.isUnlocked ? -1 : 1;
    if (a.isUnlocked) return (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? "");
    return (b.progressPercentage ?? 0) - (a.progressPercentage ?? 0);
  });

  // The nudge towards hidden ones, once the reader has done half of the rest
  // of what they are looking at.
  const hiddenOpen = filtered.filter((a) => a.isHidden && !a.isUnlocked).length;
  const plain = filtered.filter((a) => !a.isHidden);
  const showHiddenHint =
    hiddenOpen > 0 &&
    plain.length > 0 &&
    plain.filter((a) => a.isUnlocked).length / plain.length >= 0.5;

  const countBy = (pick: (a: Achievement) => boolean): number =>
    visibleAchievements.filter(pick).length;

  if (loading) {
    return (
      <AppShell width="list">
        <SkeletonAchievementGrid />
      </AppShell>
    );
  }

  if (showLeaderboard) {
    return (
      <AppShell width="list">
        <AchievementLeaderboard entries={leaderboard} onBack={() => setShowLeaderboard(false)} />
      </AppShell>
    );
  }

  const counts = countAchievements(visibleAchievements);

  return (
    <AppShell width="list">
      <PageHeader
        title={t("achievements:title")}
        meta={[
          t("achievements:header.meta", {
            unlocked: counts.unlocked,
            total: counts.total,
            points: (summary?.totalPoints ?? 0).toLocaleString(locale),
          }),
          counts.retiredUnlocked > 0
            ? t("achievements:header.retired", { count: counts.retiredUnlocked })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Button onClick={() => void handleCheckAchievements()}>
              {t("achievements:checkNew")}
            </Button>
            <Button onClick={() => setShowLeaderboard(true)}>
              <Icon name="trophy" size={16} />
              {t("achievements:summary.leaderboard")}
            </Button>
          </>
        }
      />

      <div
        role="group"
        aria-label={t("achievements:filters.tier")}
        className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5"
        style={{
          padding: "var(--ts-space-md)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        {TIERS.map((tier) => {
          const active = selectedTier === tier;
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedTier(active ? "all" : tier)}
              className="flex items-center gap-3 rounded-[var(--ts-radius-button)] px-2 py-1.5 text-left"
              style={{ background: active ? "var(--ts-surface2)" : "transparent" }}
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ border: `2px solid ${TIER_COLOR[tier]}`, color: TIER_COLOR[tier] }}
              >
                <Icon name="trophy" size={16} />
              </span>
              <span className="flex flex-col">
                <span style={{ fontWeight: 700, color: TIER_COLOR[tier] }}>
                  {t(`achievements:tiers.${tier}`)}
                </span>
                <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                  {countBy((a) => a.tier === tier && !a.isRetired && Boolean(a.isUnlocked))} /{" "}
                  {countBy((a) => a.tier === tier && !a.isRetired)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2">
        <div
          role="group"
          aria-label={t("achievements:filters.category")}
          className="flex flex-wrap gap-2"
        >
          <Pill
            active={selectedCategory === "all"}
            count={visibleAchievements.length}
            onClick={() => setSelectedCategory("all")}
          >
            {t("achievements:filters.allCategories")}
          </Pill>
          {CATEGORIES.filter((c) => countBy((a) => a.category === c) > 0).map((c) => (
            <Pill
              key={c}
              active={selectedCategory === c}
              count={countBy((a) => a.category === c)}
              onClick={() => setSelectedCategory(selectedCategory === c ? "all" : c)}
            >
              {t(`achievements:categories.${c}`)}
            </Pill>
          ))}
        </div>
        <div
          role="group"
          aria-label={t("achievements:filters.domain")}
          className="flex flex-wrap gap-2"
        >
          <Pill active={selectedDomain === "all"} onClick={() => setSelectedDomain("all")}>
            {t("achievements:filters.allDomains")}
          </Pill>
          {/* Rail has no achievements yet (its spec, phase 2) — a chip for it
              would open an empty list. */}
          {AVAILABLE_DOMAINS.filter((d) => d !== "rail" && enabled.includes(d)).map((d) => (
            <Pill key={d} active={selectedDomain === d} onClick={() => setSelectedDomain(d)}>
              {t(DOMAIN_LABEL[d])}
            </Pill>
          ))}
          <Pill active={selectedDomain === "shared"} onClick={() => setSelectedDomain("shared")}>
            {t("achievements:filters.domainShared")}
          </Pill>
        </div>
        <div
          role="group"
          aria-label={t("achievements:filters.state")}
          className="flex flex-wrap gap-2"
        >
          {(["all", "unlocked", "open"] as const).map((s) => (
            <Pill key={s} active={selectedState === s} onClick={() => setSelectedState(s)}>
              {t(`achievements:filters.states.${s}`)}
            </Pill>
          ))}
        </div>
      </div>

      {showHiddenHint && (
        <p className="t-caption mb-4" style={{ color: "var(--ts-accent)" }}>
          {t("achievements:hiddenHint", {
            count: hiddenOpen,
            defaultValue:
              "{{count}} hidden achievement(s) waiting in this category — unusual timings, rare routes or specific seat choices could unlock them.",
          })}
        </p>
      )}

      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sorted.map((achievement) => (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              onOpen={() => setSelected(achievement)}
            />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <h3 style={{ fontSize: 20, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {t("achievements:empty.title")}
          </h3>
          <p className="t-caption mt-1">{t("achievements:empty.message")}</p>
        </div>
      )}
      <AchievementDetailModal achievement={selected} onClose={() => setSelected(null)} />
      {/* The dialog's evidence trigger only writes `?evidence=`; without the
          panel mounted here the click would change the URL and show nothing.
          `AdvancedStatsPage` is the only other page that mounts it. */}
      <EvidencePanel />
    </AppShell>
  );
}
