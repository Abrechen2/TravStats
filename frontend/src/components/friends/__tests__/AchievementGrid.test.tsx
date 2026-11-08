import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AchievementGrid from "../AchievementGrid";
import type { Achievement } from "../../../types";
import type { AchievementSection, LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.defaultValue !== undefined
        ? String(o.defaultValue)
        : o
          ? `${k}|${Object.values(o).join("|")}`
          : k,
    i18n: { language: "de" },
  }),
}));
// The coarse pointer is the iPad: there is no hover, so a tap must be enough.
vi.mock("../../../hooks/useCoarsePointer", () => ({ useCoarsePointer: () => true }));

const cat = (code: string, name: string, points: number): Achievement =>
  ({
    id: code,
    code,
    name,
    description: `${name} description`,
    icon: "*",
    tier: "gold",
    points,
  }) as unknown as Achievement;
const CATALOGUE = [
  cat("a", "Alpha", 10),
  cat("b", "Beta", 20),
  cat("c", "Gamma", 30),
  cat("d", "Delta", 40),
];
const section = (
  items: AchievementSection["items"],
  catalogue = "1".repeat(16)
): AchievementSection => ({
  catalogue,
  items,
});
const rowWith = (
  achievements: AchievementSection | undefined,
  extra: Partial<LeaderboardRow> = {}
): LeaderboardRow => ({
  person: { key: "x", kind: "local", username: "x", displayName: "x", origin: null },
  status: "ok",
  sharedYear: null,
  snapshot: null,
  achievements,
  ...extra,
});
const mine = rowWith(
  section([
    { code: "a", unlocked: true, progress: null },
    { code: "b", unlocked: true, progress: null },
    { code: "c", unlocked: false, progress: 0.4 },
    { code: "d", unlocked: false, progress: 0.1 },
  ])
);
const theirs = rowWith(
  section([
    { code: "a", unlocked: true, progress: null },
    { code: "b", unlocked: false, progress: 0.6 },
    { code: "c", unlocked: true, progress: null },
    // "d" is not defined on their side
  ])
);
const grid = (over: Partial<React.ComponentProps<typeof AchievementGrid>> = {}) =>
  render(
    <AchievementGrid
      self={mine}
      friend={{ name: "Ben", row: theirs }}
      year={null}
      catalogue={CATALOGUE}
      progressShared
      achievementsSwitch
      {...over}
    />
  );

describe("AchievementGrid", () => {
  it("counts both sides over ONE denominator — only the badges both servers define", () => {
    grid();
    expect(screen.getByTestId("ach-denominator").textContent).toContain("friend.denominator|3");
    // "d" is unknown on their side: it is named as such, not counted against them.
    expect(screen.getByTestId("ach-missing").textContent).toContain("Delta");
    expect(screen.getByTestId("ach-count-self").textContent).toContain("achievements.count|2|3");
    expect(screen.getByTestId("ach-count-friend").textContent).toContain("achievements.count|2|3");
  });

  it("groups the badges: both, only you, only them", () => {
    grid();
    expect(within(screen.getByTestId("ach-both")).getByText("Alpha")).toBeInTheDocument();
    expect(within(screen.getByTestId("ach-you")).getByText("Beta")).toBeInTheDocument();
    expect(within(screen.getByTestId("ach-them")).getByText("Gamma")).toBeInTheDocument();
  });

  it("a tap on a badge opens its info on a coarse pointer: name, description, points and the progress of whoever lacks it", () => {
    grid();
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    const info = screen.getByTestId("ach-info-b");
    expect(info.textContent).toContain("Beta description");
    expect(info.textContent).toContain("achievements.points|20");
    expect(info.textContent).toContain("friend.progressThem|Ben|60 %");
  });

  it("hides progress when the friend's leaderboard grant does not carry it", () => {
    grid({ progressShared: false });
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByTestId("ach-info-b").textContent).not.toContain("friend.progress");
  });

  it("Escape closes the info", () => {
    grid();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByTestId("ach-info-a")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("ach-info-a")).toBeNull();
  });

  it("a tap outside closes the info", () => {
    grid();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("ach-info-a")).toBeNull();
  });

  it("says in one line why there is no grid: the year view, no grant, an older server", () => {
    const { unmount } = grid({ year: 2025 });
    expect(screen.getByTestId("achievements-year-only")).toBeInTheDocument();
    unmount();
    grid({
      friend: { name: "Ben", row: rowWith(undefined, { achievementsUnavailable: "olderServer" }) },
    });
    expect(screen.getByTestId("achievements-unavailable").textContent).toContain(
      "achievements.unavailable.olderServer"
    );
  });
});
