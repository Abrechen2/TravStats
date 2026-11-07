import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AchievementsCompare from "../AchievementsCompare";
import type { ComparedFriend } from "../CompareTable";
import type { AchievementSection, LeaderboardRow } from "../../../lib/comparison/types";
import type { Achievement } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "de" },
  }),
}));

const def = (code: string, name: string, points: number): Achievement =>
  ({ id: code, code, name, icon: "★", tier: "gold", points, isHidden: false }) as Achievement;
const catalogue = [def("a", "Alpha", 10), def("b", "Beta", 20), def("c", "Gamma", 30)];

const section = (
  catalogueId: string,
  items: [string, boolean, number | null][]
): AchievementSection => ({
  catalogue: catalogueId,
  items: items.map(([code, unlocked, progress]) => ({ code, unlocked, progress })),
});
const row = (
  key: string,
  kind: "self" | "local",
  achievements?: AchievementSection,
  extra: Partial<LeaderboardRow> = {}
): LeaderboardRow => ({
  person: { key, kind, username: key, displayName: key, origin: null },
  status: "ok",
  snapshot: null,
  achievements,
  sharedYear: null,
  ...extra,
});
const friend = (r: LeaderboardRow): ComparedFriend => ({ key: r.person.key, name: "Ben", row: r });

describe("AchievementsCompare", () => {
  const self = row(
    "self",
    "self",
    section("1111111111111111", [
      ["a", true, 1],
      ["b", true, 1],
      ["c", false, 0.4],
    ])
  );

  it("groups badges into ihr beide / nur du / nur <Name>", () => {
    const ben = row(
      "ben",
      "local",
      section("1111111111111111", [
        ["a", true, 1],
        ["b", false, 0.5],
        ["c", true, 1],
      ])
    );
    render(
      <AchievementsCompare self={self} friends={[friend(ben)]} year={null} catalogue={catalogue} />
    );
    expect(within(screen.getByTestId("ach-both-ben")).getByText("Alpha")).toBeInTheDocument();
    expect(within(screen.getByTestId("ach-you-ben")).getByText("Beta")).toBeInTheDocument();
    expect(within(screen.getByTestId("ach-them-ben")).getByText("Gamma")).toBeInTheDocument();
    // The lacking side's progress shows as a bar.
    expect(within(screen.getByTestId("ach-you-ben")).getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("ach-count-self").textContent).toContain("achievements.points");
  });

  it("year view shows 'nur für die Gesamtzeit'", () => {
    render(
      <AchievementsCompare
        self={{ ...self, achievements: undefined }}
        friends={[]}
        year={2025}
        catalogue={catalogue}
      />
    );
    expect(screen.getByTestId("achievements-year-only").textContent).toBe("achievements.yearOnly");
  });

  it("an unknown-catalogue code reads 'auf dem anderen Server unbekannt'", () => {
    const ben = row("ben", "local", section("2222222222222222", [["a", true, 1]]));
    render(
      <AchievementsCompare self={self} friends={[friend(ben)]} year={null} catalogue={catalogue} />
    );
    const note = screen.getByTestId("ach-missing-ben").textContent;
    expect(note).toContain("Beta, Gamma");
    expect(note).toContain("achievements.unknownOther");
  });

  it("the same catalogue with a missing code says the friend does not share it", () => {
    const ben = row("ben", "local", section("1111111111111111", [["a", true, 1]]));
    render(
      <AchievementsCompare self={self} friends={[friend(ben)]} year={null} catalogue={catalogue} />
    );
    expect(screen.getByTestId("ach-missing-ben").textContent).toContain(
      "achievements.notSharedCode"
    );
  });

  it("an older server reads 'nicht verfügbar' and a withdrawn friend says so", () => {
    const old = row("old", "local", undefined, { achievementsUnavailable: "olderServer" });
    render(
      <AchievementsCompare
        self={self}
        friends={[friend(old), { key: "gone", name: "Gone" }]}
        year={null}
        catalogue={catalogue}
      />
    );
    expect(screen.getByTestId("ach-count-old").textContent).toContain(
      "achievements.unavailable.olderServer"
    );
    expect(screen.getByTestId("ach-count-gone").textContent).toContain("status.withdrawn");
  });
});
