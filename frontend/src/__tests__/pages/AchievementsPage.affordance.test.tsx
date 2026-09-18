import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Achievement } from "../../types";

/**
 * #330: every achievement box drew a pointer cursor, and unlocked ones grew on
 * hover — both affordances of a card that has no click handler at all. A tester
 * clicked and nothing happened.
 *
 * What this test can and cannot see: jsdom applies no Tailwind stylesheet, so
 * the *rendered* cursor is unobservable and the class is the only handle on it.
 * framer-motion's `whileHover` is unobservable too, because nothing hovers.
 * So the guard is deliberately narrow — the card must not claim to be
 * interactive, in the two ways a reader of the markup can check: no pointer
 * class, and no click handler. If the card ever becomes genuinely clickable,
 * this test should be replaced by one that clicks it, not relaxed.
 */

vi.mock("../../components/NavigationBar", () => ({
  default: (): JSX.Element => <nav />,
}));

vi.mock("../../components/PageTransition", () => ({
  default: ({ children }: { children: React.ReactNode }): JSX.Element => <>{children}</>,
}));

const unlocked: Achievement = {
  id: "1",
  code: "FIRST_FLIGHT",
  name: "First flight",
  description: "You flew.",
  category: "explorer",
  icon: "",
  tier: "bronze",
  requirement: 1,
  requirementType: "flights_count",
  points: 10,
  isHidden: false,
  createdAt: "2026-01-01T00:00:00Z",
  domain: "flight",
  isUnlocked: true,
  progress: 1,
  unlockedAt: "2026-02-01T00:00:00Z",
} as Achievement;

const locked: Achievement = {
  ...unlocked,
  id: "2",
  code: "TEN_FLIGHTS",
  name: "Ten flights",
  isUnlocked: false,
  progress: 3,
  unlockedAt: undefined,
} as Achievement;

vi.mock("../../lib/api", () => ({
  achievementsApi: {
    getAll: vi.fn(async () => ({
      achievements: [unlocked, locked],
      summary: {
        totalAchievements: 2,
        unlockedAchievements: 1,
        totalPoints: 10,
        categories: { explorer: { total: 2, unlocked: 1 } },
      },
    })),
    getLeaderboard: vi.fn(async () => []),
    checkAchievements: vi.fn(async () => ({ newlyUnlocked: [] })),
  },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: (): { enabled: string[]; isEnabled: () => boolean } => ({
    enabled: ["flight"],
    isEnabled: () => true,
  }),
}));

describe("AchievementsPage — the card promises nothing it cannot do (#330)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draws no pointer cursor and no click handler on an achievement card", async () => {
    const { default: AchievementsPage } = await import("../../pages/AchievementsPage");
    const { container } = render(<AchievementsPage />);

    // The card's own name goes through i18n, which returns the key here, so
    // the cards are found by their shape. Asserting the count first is what
    // keeps this honest: an empty grid would otherwise pass every assertion
    // below without rendering a single card.
    await screen.findByText("achievements:codes.FIRST_FLIGHT.name");
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("div.relative.rounded-xl.overflow-hidden")
    );
    expect(cards).toHaveLength(2);

    for (const card of cards) {
      expect(card.className).not.toContain("cursor-pointer");
      // `onclick` is what React sets for an inline handler on a DOM node; a card
      // that is styled as clickable and has none is the defect this pins.
      expect(card.onclick).toBeNull();
    }
  });
});
