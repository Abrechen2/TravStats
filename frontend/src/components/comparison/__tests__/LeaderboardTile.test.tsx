import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LeaderboardTile from "../LeaderboardTile";
import { LEADERBOARD_METRICS } from "../../../shared/comparisonMetrics";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const snap = (metrics: Record<string, number>, partial: string[] = []) => ({
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
});
