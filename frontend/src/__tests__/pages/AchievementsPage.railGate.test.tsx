import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Achievement } from "../../types";
import { achievementDomains } from "../../pages/AchievementsPage";

/**
 * Rail badges (2.7) live behind the `railDomain` beta gate like every rail
 * surface. A user who switched rail on while the gate was open keeps `rail` in
 * their enabled domains after the instance closes it — so the enabled list
 * alone would still show the badges and the "Bahn" pill.
 */

vi.mock("../../components/NavigationBar", () => ({
  default: (): JSX.Element => <nav />,
}));

vi.mock("../../components/PageTransition", () => ({
  default: ({ children }: { children: React.ReactNode }): JSX.Element => <>{children}</>,
}));

const badge = (code: string, domain: string): Achievement =>
  ({
    id: code,
    code,
    name: code,
    description: "",
    category: "explorer",
    icon: "",
    tier: "bronze",
    requirement: 1,
    points: 10,
    requirementType: domain === "rail" ? "rail_count" : "flights_count",
    isHidden: false,
    createdAt: "2026-01-01T00:00:00Z",
    domain,
    isUnlocked: false,
    progress: 0,
  }) as Achievement;

vi.mock("../../lib/api", () => ({
  achievementsApi: {
    getAll: vi.fn(async () => ({
      achievements: [badge("FIRST_FLIGHT", "flight"), badge("RAIL_FIRST", "rail")],
      summary: { totalAchievements: 2, unlockedAchievements: 0, totalPoints: 0, categories: {} },
    })),
    getLeaderboard: vi.fn(async () => ({ leaderboard: [] })),
    checkAchievements: vi.fn(async () => ({ newlyUnlocked: 0 })),
  },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: (): { enabled: string[]; isEnabled: (k: string) => boolean } => ({
    enabled: ["flight", "rail"],
    isEnabled: (k: string) => ["flight", "rail"].includes(k),
  }),
}));

const railGate = { open: false };
vi.mock("../../hooks/useRailVisible", () => ({
  useRailVisible: (): boolean => railGate.open,
}));

async function renderPage(): Promise<void> {
  const { default: AchievementsPage } = await import("../../pages/AchievementsPage");
  render(
    <MemoryRouter>
      <AchievementsPage />
    </MemoryRouter>
  );
  await screen.findByText("achievements:codes.FIRST_FLIGHT.name");
}

describe("AchievementsPage — rail badges follow the rail beta gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops rail from the badge domains only while rail is not visible", () => {
    expect(achievementDomains(["flight", "rail"], false)).toEqual(["flight"]);
    expect(achievementDomains(["flight", "rail"], true)).toEqual(["flight", "rail"]);
  });

  // forgejo#262 / #263: rental and bus badges follow their own beta gates.
  it("drops rental and bus unless their gates are open, and reads a missing gate as closed", () => {
    const all = ["flight", "rental", "bus"] as const;
    expect(achievementDomains([...all], false)).toEqual(["flight"]);
    expect(achievementDomains([...all], false, { rentalVisible: true })).toEqual([
      "flight",
      "rental",
    ]);
    expect(achievementDomains([...all], false, { rentalVisible: true, busVisible: true })).toEqual([
      "flight",
      "rental",
      "bus",
    ]);
  });

  it("hides rail badges and the rail pill with the gate closed", async () => {
    railGate.open = false;
    await renderPage();
    expect(screen.queryByText("achievements:codes.RAIL_FIRST.name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /achievements:filters.domainRail/ })
    ).not.toBeInTheDocument();
  });

  it("shows them, with a rail pill, once rail is visible", async () => {
    railGate.open = true;
    await renderPage();
    expect(screen.getByText("achievements:codes.RAIL_FIRST.name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /achievements:filters.domainRail/ })
    ).toBeInTheDocument();
  });
});
