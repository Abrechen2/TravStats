import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CompareTable, { type ComparedFriend } from "../CompareTable";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "rgb(1, 2, 3)" }),
}));

const snap = (
  metrics: Record<string, number | null>,
  partial: string[] = [],
  domains = ["flight"]
) => ({
  schema: "travstats-leaderboard" as const,
  version: 1 as const,
  asOf: "2026-11-07T00:00:00.000Z",
  year: null,
  domains,
  metrics,
  partial,
});
const person = (key: string, kind: "self" | "local") => ({
  key,
  kind,
  username: key,
  displayName: key,
  origin: null,
});
const row = (
  key: string,
  kind: "self" | "local",
  metrics: Record<string, number | null>,
  partial: string[] = [],
  domains = ["flight"]
): LeaderboardRow => ({
  person: person(key, kind),
  status: "ok",
  snapshot: snap(metrics, partial, domains),
  sharedYear: null,
});

const self = row("self", "self", { flightKm: 1000, flights: 10, countries: 5 });
const show = (friends: ComparedFriend[], domains: ReadonlySet<never> | null = null) =>
  render(
    <CompareTable
      self={self}
      friends={friends}
      year={null}
      domains={domains}
      isEnabled={() => true}
    />
  );
const text = (id: string) => screen.getByTestId(id).textContent;

describe("CompareTable", () => {
  it("a withdrawn friend's column reads 'teilt nicht mehr' and the difference is empty, not 0", () => {
    show([
      { key: "gone", name: "Gone" },
      {
        key: "wd",
        name: "Wd",
        row: { ...row("wd", "local", {}), status: "withdrawn", snapshot: null },
      },
    ]);
    for (const key of ["gone", "wd"]) {
      expect(text(`cell-flightKm-${key}`)).toBe("status.withdrawn");
      expect(text(`diff-flightKm-${key}`)).toBe("");
    }
    expect(text("cell-flightKm-self")).toContain("1");
  });

  it("a partial value gets no difference", () => {
    show([{ key: "p", name: "P", row: row("p", "local", { flightKm: 400 }, ["flightKm"]) }]);
    expect(text("cell-flightKm-p")).toMatch(/^≥ /);
    expect(text("diff-flightKm-p")).toBe("compare.notComparable");
  });

  it("a like-for-like pair shows a signed difference", () => {
    show([{ key: "f", name: "F", row: row("f", "local", { flightKm: 400 }) }]);
    expect(text("diff-flightKm-f")).toMatch(/^\+/);
    show([{ key: "g", name: "G", row: row("g", "local", { flightKm: 4000 }) }]);
    expect(text("diff-flightKm-g")).toMatch(/^−/);
  });

  it("null renders its reason, never 0", () => {
    show([{ key: "n", name: "N", row: row("n", "local", { flightKm: null, flights: 3 }) }]);
    expect(text("cell-flightKm-n")).toBe("status.unknown");
    expect(text("cell-flightKm-n")).not.toMatch(/0/);
    expect(text("diff-flightKm-n")).toBe("compare.notComparable");
  });

  it("a cross-domain figure across different domain coverage is not compared", () => {
    show([
      { key: "d", name: "D", row: row("d", "local", { countries: 9 }, [], ["flight", "rail"]) },
    ]);
    expect(text("cell-countries-d")).toBe("status.notComparable");
    expect(text("diff-countries-d")).toBe("compare.notComparable");
  });

  it("the domain filter hides other domains' tables and marks the cross-domain one", () => {
    show(
      [{ key: "f", name: "F", row: row("f", "local", { flightKm: 1 }) }],
      new Set(["rail"]) as never
    );
    expect(screen.queryByTestId("compare-flight")).toBeNull();
    expect(screen.getByTestId("compare-cross").textContent).toContain("friends.crossDomainNote");
  });
});
