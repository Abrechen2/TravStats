import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CompareRows from "../CompareRows";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { name?: string }) => (o?.name ? `${k}|${o.name}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "rgb(1, 2, 3)" }),
}));

const row = (
  key: "self" | "ben",
  metrics: Record<string, number | null>,
  over: { domains?: string[]; partial?: string[] } = {}
): LeaderboardRow => ({
  person: {
    key,
    kind: key === "self" ? "self" : "local",
    username: key,
    displayName: key,
    origin: null,
  },
  status: "ok",
  sharedYear: null,
  snapshot: {
    schema: "travstats-leaderboard",
    version: 2,
    asOf: "2026-11-08T00:00:00.000Z",
    year: null,
    domains: over.domains ?? ["flight"],
    metrics,
    partial: over.partial ?? [],
  },
});
const show = (self: LeaderboardRow, friend?: LeaderboardRow) =>
  render(
    <CompareRows
      self={self}
      friend={{ name: "Ben", row: friend }}
      year={null}
      domains={null}
      isEnabled={(d) => d === "flight"}
    />
  );

describe("CompareRows", () => {
  it("draws two bars on one scale and marks who leads without a sign", () => {
    show(row("self", { flightKm: 1000 }), row("ben", { flightKm: 250 }));
    const r = screen.getByTestId("metric-flightKm");
    expect(r).toHaveAttribute("data-lead", "you");
    expect(screen.getByTestId("bar-flightKm-you").style.width).toBe("100%");
    expect(screen.getByTestId("bar-flightKm-them").style.width).toBe("25%");
    expect(within(r).getByTestId("lead-flightKm")).toHaveTextContent("friend.youLead");
    expect(r.textContent).not.toMatch(/[+−]\d/);
  });

  it("names the friend when they are ahead", () => {
    show(row("self", { flightKm: 100 }), row("ben", { flightKm: 400 }));
    expect(screen.getByTestId("metric-flightKm")).toHaveAttribute("data-lead", "them");
    expect(screen.getByTestId("lead-flightKm")).toHaveTextContent("friend.theyLead|Ben");
  });

  it("a partial figure draws no leader: bars stay, 'nicht vergleichbar' is said, the figure carries ≥", () => {
    show(row("self", { flightKm: 1000 }), row("ben", { flightKm: 250 }, { partial: ["flightKm"] }));
    expect(screen.getByTestId("metric-flightKm")).toHaveAttribute("data-lead", "none");
    expect(screen.getByText("compare.notComparable")).toBeInTheDocument();
    expect(screen.getByTestId("cell-flightKm-friend").textContent).toMatch(/^≥ /);
  });

  it("a withheld friend figure says why and draws no bar for them — never a zero", () => {
    show(row("self", { flightKm: 1000 }), row("ben", {}));
    expect(screen.getByTestId("cell-flightKm-friend").textContent).toBe("status.metricNotShared");
    expect(screen.getByTestId("bar-flightKm-them").style.width).toBe("0%");
    expect(screen.getByTestId("metric-flightKm")).toHaveAttribute("data-lead", "none");
  });

  it("head cards carry three key figures per person; a cross-domain total the friend cannot derive says so instead of 'unbekannt'", () => {
    show(
      row(
        "self",
        { daysAway: 302, countries: 27, flights: 115 },
        { domains: ["flight", "cruise"] }
      ),
      row("ben", { daysAway: null, countries: null, flights: 78 })
    );
    const me = screen.getByTestId("head-card-you");
    expect(within(me).getByTestId("head-you-daysAway")).toHaveTextContent("comparison:unit.days");
    const them = screen.getByTestId("head-card-them");
    expect(within(them).getByTestId("head-them-daysAway").textContent).toContain(
      "status.notDerivable"
    );
    expect(within(them).getByTestId("head-them-daysAway").textContent).not.toContain(
      "status.unknown"
    );
    expect(within(them).getByTestId("head-them-flights")).toHaveTextContent("78");
  });
});
