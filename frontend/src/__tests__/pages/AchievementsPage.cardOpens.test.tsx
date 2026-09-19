import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { Achievement } from "../../types";

/**
 * #330, the other half.
 *
 * The cards drew a pointer cursor and unlocked ones grew on hover while
 * nothing was clickable; a tester clicked and nothing happened. The owner's
 * call (2026-09-11) was to keep the affordance and make it true. This pins
 * that the card is a control — reachable by mouse AND by keyboard — and that
 * it opens the detail dialog.
 *
 * Taking the affordance away instead would also have satisfied "no lie", and
 * was tried and reverted on 2026-09-18: the decision was already on record and
 * it was the opposite one.
 */

vi.mock("../../components/NavigationBar", () => ({
  default: (): JSX.Element => <nav />,
}));

vi.mock("../../components/PageTransition", () => ({
  default: ({ children }: { children: React.ReactNode }): JSX.Element => <>{children}</>,
}));

const unlocked = {
  id: "1",
  code: "FIRST_FLIGHT",
  name: "First flight",
  description: "You flew.",
  category: "explorer",
  icon: "",
  tier: "bronze",
  requirement: 1,
  points: 10,
  requirementType: "flights_count",
  isHidden: false,
  createdAt: "2026-01-01T00:00:00Z",
  domain: "flight",
  isUnlocked: true,
  progress: 1,
  unlockedAt: "2026-02-01T00:00:00Z",
} as Achievement;

vi.mock("../../lib/api", () => ({
  achievementsApi: {
    getAll: vi.fn(async () => ({
      achievements: [unlocked],
      summary: {
        totalAchievements: 1,
        unlockedAchievements: 1,
        totalPoints: 10,
        categories: { explorer: { total: 1, unlocked: 1 } },
      },
    })),
    getLeaderboard: vi.fn(async () => []),
    checkAchievements: vi.fn(async () => ({ newlyUnlocked: 0 })),
  },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: (): { enabled: string[]; isEnabled: () => boolean } => ({
    enabled: ["flight"],
    isEnabled: () => true,
  }),
}));

describe("AchievementsPage — a card that looks clickable is clickable (#330)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the detail dialog on a click, and the card is a control", async () => {
    const { default: AchievementsPage } = await import("../../pages/AchievementsPage");
    // A Router is required since the page gained the evidence panel: the
    // panel's open state lives in `?evidence=` (useEvidence.ts).
    render(
      <MemoryRouter>
        <AchievementsPage />
      </MemoryRouter>
    );

    await screen.findByText("achievements:codes.FIRST_FLIGHT.name");
    const cards = screen.getAllByRole("button", { name: /FIRST_FLIGHT/ });
    expect(cards.length).toBeGreaterThan(0);

    expect(screen.queryByTestId("achievement-detail-modal")).not.toBeInTheDocument();
    await userEvent.click(cards[0]);
    expect(screen.getByTestId("achievement-detail-modal")).toBeInTheDocument();
  });

  it("opens on Enter too — a div that only answers a mouse is half a control", async () => {
    const { default: AchievementsPage } = await import("../../pages/AchievementsPage");
    // A Router is required since the page gained the evidence panel: the
    // panel's open state lives in `?evidence=` (useEvidence.ts).
    render(
      <MemoryRouter>
        <AchievementsPage />
      </MemoryRouter>
    );

    await screen.findByText("achievements:codes.FIRST_FLIGHT.name");
    const card = screen.getAllByRole("button", { name: /FIRST_FLIGHT/ })[0];
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("achievement-detail-modal")).toBeInTheDocument();
  });
});
