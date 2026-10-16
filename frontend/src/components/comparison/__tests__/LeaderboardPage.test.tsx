import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LeaderboardPage from "../LeaderboardPage";
import { comparisonApi } from "../../../lib/api/comparison";
import type { LeaderboardResponse } from "../../../lib/comparison/types";
import type { DomainKey } from "../../../shared/domains";

const domains = vi.hoisted(() => ({ enabled: ["flight"] as string[] }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: domains.enabled,
    isEnabled: (key: DomainKey) => domains.enabled.includes(key),
  }),
}));
// The shell reads the profile store; this test is about the page, not the chrome.
vi.mock("../../ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../PeopleSection", () => ({ default: () => null }));
vi.mock("../AddPersonCard", () => ({ default: () => null }));
vi.mock("../BoardsSection", () => ({ default: () => null }));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: { leaderboard: vi.fn(), people: vi.fn() },
}));

const snap = (metrics: Record<string, number>) => ({
  schema: "travstats-leaderboard" as const,
  version: 1 as const,
  asOf: "2026-10-16T00:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics,
  partial: [],
});
const self = {
  key: "self",
  kind: "self" as const,
  username: "me",
  displayName: "Me",
  origin: null,
};
const ben = {
  key: "local:1",
  kind: "local" as const,
  username: "ben",
  displayName: "Ben",
  origin: null,
};
const two: LeaderboardResponse = {
  year: null,
  rows: [
    { person: self, status: "ok", snapshot: snap({ flightKm: 100, flights: 2 }), sharedYear: null },
    { person: ben, status: "ok", snapshot: snap({ flightKm: 300, flights: 5 }), sharedYear: null },
  ],
};

describe("LeaderboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domains.enabled = ["flight"];
    vi.mocked(comparisonApi.people).mockResolvedValue({ requests: [], people: [], boards: [] });
  });

  it("shows one card per metric of the chosen group, like the statistics pages", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
    render(<LeaderboardPage />);
    expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-flights")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "group.trips" }));
    expect(await screen.findByTestId("metric-flights")).toBeInTheDocument();
  });

  it("shows no figure of a domain the reader has switched off, even if a friend shares it", async () => {
    domains.enabled = ["flight"];
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue({
      year: null,
      rows: [two.rows[0], { ...two.rows[1], snapshot: snap({ flightKm: 300, cruiseKm: 900 }) }],
    });
    render(<LeaderboardPage />);
    expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-cruiseKm")).toBeNull();
  });

  it("asks for a year when the period changes", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
    render(<LeaderboardPage />);
    await screen.findByTestId("metric-flightKm");
    const year = String(new Date().getFullYear());
    fireEvent.change(screen.getByLabelText("period.label"), { target: { value: year } });
    await waitFor(() =>
      expect(comparisonApi.leaderboard).toHaveBeenLastCalledWith(Number(year), undefined)
    );
    await screen.findByTestId("metric-flightKm");
  });

  it("invites instead of ranking when nobody else is there", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue({ year: null, rows: [two.rows[0]] });
    render(<LeaderboardPage />);
    expect(await screen.findByText("empty.title")).toBeInTheDocument();
  });

  it("says the load failed instead of showing zeros, and retries", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(comparisonApi.leaderboard).mockRejectedValueOnce(new Error("down"));
    render(<LeaderboardPage />);
    expect(await screen.findByText("loadFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-flightKm")).toBeNull();

    vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    expect(screen.queryByText("loadFailed")).toBeNull();
    quiet.mockRestore();
  });

  it("shows one unreachable friend as a row status, not as a page error", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue({
      year: null,
      rows: [two.rows[0], { person: ben, status: "unreachable", snapshot: null, sharedYear: null }],
    });
    render(<LeaderboardPage />);
    expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    expect(screen.getByText("status.unreachable")).toBeInTheDocument();
    expect(screen.queryByText("loadFailed")).toBeNull();
  });
});
