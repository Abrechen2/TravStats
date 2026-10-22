import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Achievement } from "../../types";

/**
 * Rail badges (2.7) follow the user's rail domain like every rail surface.
 * Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22), so the instance's beta
 * switch no longer hides them; the page asks the real `useEnabledDomains`.
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

vi.unmock("../../store/settingsStore");
import { useSettingsStore } from "../../store/settingsStore";

async function renderPage(): Promise<void> {
  const { default: AchievementsPage } = await import("../../pages/AchievementsPage");
  render(
    <MemoryRouter>
      <AchievementsPage />
    </MemoryRouter>
  );
  await screen.findByText("achievements:codes.FIRST_FLIGHT.name");
}

describe("AchievementsPage — rail badges follow the rail domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides rail badges and the rail pill while the user has rail off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    await renderPage();
    expect(screen.queryByText("achievements:codes.RAIL_FIRST.name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /achievements:filters.domainRail/ })
    ).not.toBeInTheDocument();
  });

  it("shows them, with a rail pill, with the beta switch off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: false });
    await renderPage();
    expect(screen.getByText("achievements:codes.RAIL_FIRST.name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /achievements:filters.domainRail/ })
    ).toBeInTheDocument();
  });
});
