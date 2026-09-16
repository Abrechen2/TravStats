import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getAllMock = vi.fn();
const getLeaderboardMock = vi.fn();

vi.mock("../../lib/api", () => ({
  achievementsApi: {
    getAll: () => getAllMock(),
    getLeaderboard: (n: number) => getLeaderboardMock(n),
    checkAchievements: () => Promise.resolve({ newlyUnlocked: [] }),
  },
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"] }),
}));

import AchievementsPage from "../AchievementsPage";

/**
 * forgejo#113. The audit (axe-core, real Chromium, 2026-09-08) reported both
 * of these selects as critical `select-name` failures: the label was printed
 * next to the control as bare text and never associated with it, so a screen
 * reader announced two nameless combo boxes.
 *
 * `getByLabelText` is the assertion that can tell the two apart — it resolves
 * through the accessible name, which is exactly what was missing, and finds
 * nothing when the label is merely adjacent.
 */
describe("AchievementsPage — the filter controls carry their labels", () => {
  beforeEach(() => {
    getAllMock.mockReset();
    getLeaderboardMock.mockReset();
    getAllMock.mockResolvedValue({ achievements: [], summary: null });
    getLeaderboardMock.mockResolvedValue([]);
  });

  it("names the category filter", async () => {
    render(
      <MemoryRouter>
        <AchievementsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(getAllMock).toHaveBeenCalled());

    const select = await screen.findByLabelText("achievements:filters.category");
    expect(select.tagName).toBe("SELECT");
  });

  it("names the tier filter", async () => {
    render(
      <MemoryRouter>
        <AchievementsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(getAllMock).toHaveBeenCalled());

    const select = await screen.findByLabelText("achievements:filters.tier");
    expect(select.tagName).toBe("SELECT");
  });
});
