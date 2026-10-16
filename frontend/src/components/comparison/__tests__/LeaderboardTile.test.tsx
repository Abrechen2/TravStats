import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LeaderboardTile from "../LeaderboardTile";
import { LEADERBOARD_METRICS } from "../../../shared/comparisonMetrics";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const snap = (metrics: Record<string, number | null>, partial: string[] = []) => ({
  schema: "travstats-leaderboard" as const,
  version: 1 as const,
  asOf: "2026-10-16T00:00:00.000Z",
  year: 2025,
  domains: ["flight"],
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
const rows: LeaderboardRow[] = [
  {
    person: person("self", "self"),
    status: "ok",
    snapshot: snap({ flightKm: 100 }),
    sharedYear: null,
  },
  {
    person: person("ben", "local"),
    status: "ok",
    snapshot: snap({ flightKm: 200 }, ["flightKm"]),
    sharedYear: null,
  },
  { person: person("cleo", "local"), status: "unreachable", snapshot: null, sharedYear: null },
];

vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: (d: string) => `rgb(1, 2, ${d.length})` }),
}));

describe("LeaderboardTile", () => {
  it("leads with the reader's own value and ranks everyone under it", () => {
    const flightKm = LEADERBOARD_METRICS.find((m) => m.key === "flightKm")!;
    render(<LeaderboardTile metric={flightKm} rows={rows} year={2025} />);
    const card = screen.getByTestId("metric-flightKm");
    expect(within(card).getByText("metric.flightKm")).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "tile.ranking" })).getAllByRole(
      "listitem"
    );
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("ben"),
      expect.stringContaining("you"),
      expect.stringContaining("cleo"),
    ]);
    expect(items[0]).toHaveTextContent("≥ 200 stats:distance.kilometers");
    expect(items[2]).toHaveTextContent("status.unreachable");
    expect(items[2]).toHaveTextContent("—");
  });

  const metricOf = (key: string) => LEADERBOARD_METRICS.find((m) => m.key === key)!;
  const itemsOf = () =>
    within(screen.getByRole("list", { name: "tile.ranking" })).getAllByRole("listitem");

  it("marks the leader 1 and an unranked row with the dash mark", () => {
    render(<LeaderboardTile metric={metricOf("flightKm")} rows={rows} year={2025} />);
    const items = itemsOf();
    expect(within(items[0]).getByText("1")).toHaveClass("t-stat-number");
    expect(within(items[2]).getByText("–")).toHaveClass("t-stat-number");
  });

  it("gives people tied on a value the same rank and skips the next", () => {
    const tied: LeaderboardRow[] = [
      {
        person: person("self", "self"),
        status: "ok",
        snapshot: snap({ flightKm: 100 }),
        sharedYear: null,
      },
      {
        person: person("ben", "local"),
        status: "ok",
        snapshot: snap({ flightKm: 100 }),
        sharedYear: null,
      },
      {
        person: person("dan", "local"),
        status: "ok",
        snapshot: snap({ flightKm: 50 }),
        sharedYear: null,
      },
    ];
    render(<LeaderboardTile metric={metricOf("flightKm")} rows={tied} year={2025} />);
    const items = itemsOf();
    expect(within(items[0]).getByText("1")).toBeInTheDocument();
    expect(within(items[1]).getByText("1")).toBeInTheDocument();
    expect(within(items[2]).getByText("3")).toBeInTheDocument();
  });

  it("shows an ok row that lacks the metric as absent with its reason, not as 0", () => {
    const lacking: LeaderboardRow[] = [
      rows[0],
      {
        person: person("eva", "local"),
        status: "ok",
        snapshot: snap({ cruiseKm: 5 }),
        sharedYear: null,
      },
    ];
    render(<LeaderboardTile metric={metricOf("flightKm")} rows={lacking} year={2025} />);
    const eva = itemsOf()[1];
    expect(eva).toHaveTextContent("status.metricNotShared");
    expect(eva).toHaveTextContent("—");
    expect(eva).not.toHaveTextContent("0 ");
  });

  it("shows a consented domain the person does not use as switched off, not as not shared", () => {
    const off: LeaderboardRow[] = [
      { ...rows[0], snapshot: { ...snap({ cruiseKm: 7 }), domains: ["flight", "cruise"] } },
      {
        person: person("ben", "local"),
        status: "ok",
        snapshot: snap({ cruiseKm: null }),
        sharedYear: null,
      },
    ];
    render(<LeaderboardTile metric={metricOf("cruiseKm")} rows={off} year={2025} />);
    const ben = itemsOf()[1];
    expect(ben).toHaveTextContent("status.domainOff");
    expect(ben).toHaveTextContent("—");
    expect(ben).not.toHaveTextContent("status.metricNotShared");
  });

  it("colours the left edge from the domain colour store, and from the accent across domains", () => {
    const { unmount } = render(
      <LeaderboardTile metric={metricOf("flightKm")} rows={rows} year={2025} />
    );
    expect(screen.getByTestId("metric-flightKm").style.borderLeftColor).toBe("rgb(1, 2, 6)");
    unmount();
    render(<LeaderboardTile metric={metricOf("daysAway")} rows={rows} year={2025} />);
    expect(screen.getByTestId("metric-daysAway").style.borderLeftColor).toBe("var(--ts-accent)");
  });
});
