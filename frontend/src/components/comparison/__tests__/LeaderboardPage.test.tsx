import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import LeaderboardPage from "../LeaderboardPage";
import { comparisonApi } from "../../../lib/api/comparison";
import type { LeaderboardResponse } from "../../../lib/comparison/types";
import { setClockForTests } from "../../../shared/time/clock";
import { useSettingsStore } from "../../../store/settingsStore";
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
// A button in place of the section, so a test can fire the reload a consent change causes.
vi.mock("../PeopleSection", () => ({
  default: ({ onChanged }: { onChanged: () => void }) => (
    <button type="button" onClick={onChanged}>
      people-changed
    </button>
  ),
}));
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

  describe("after a filter changes (review of 2026-10-16)", () => {
    const crew = { id: "b1", name: "Crew", members: ["local:1"] };
    afterEach(() => setClockForTests(null));

    it("drops a group filter whose group no longer exists", async () => {
      vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
      vi.mocked(comparisonApi.people).mockResolvedValue({
        requests: [],
        people: [],
        boards: [crew],
      });
      render(<LeaderboardPage />);
      fireEvent.change(await screen.findByLabelText("board.label"), { target: { value: "b1" } });
      await waitFor(() => expect(comparisonApi.leaderboard).toHaveBeenLastCalledWith(null, "b1"));

      vi.mocked(comparisonApi.people).mockResolvedValue({ requests: [], people: [], boards: [] });
      fireEvent.click(screen.getByRole("button", { name: "people-changed" }));
      await waitFor(() =>
        expect(comparisonApi.leaderboard).toHaveBeenLastCalledWith(null, undefined)
      );
      await screen.findByTestId("metric-flightKm");
    });

    it("says the group shows nobody, rather than inviting, when only you are left in it", async () => {
      vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
      vi.mocked(comparisonApi.people).mockResolvedValue({
        requests: [],
        people: [],
        boards: [crew],
      });
      render(<LeaderboardPage />);
      await screen.findByTestId("metric-flightKm");
      vi.mocked(comparisonApi.leaderboard).mockResolvedValue({ year: null, rows: [two.rows[0]] });
      fireEvent.change(screen.getByLabelText("board.label"), { target: { value: "b1" } });
      expect(await screen.findByText("empty.boardTitle")).toBeInTheDocument();
      expect(screen.queryByText("empty.title")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "board.all" }));
      await waitFor(() =>
        expect(comparisonApi.leaderboard).toHaveBeenLastCalledWith(null, undefined)
      );
    });

    it("does not show the previous period's numbers while the new one loads", async () => {
      vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
      render(<LeaderboardPage />);
      await screen.findByTestId("metric-flightKm");
      let settle: (value: LeaderboardResponse) => void = () => undefined;
      vi.mocked(comparisonApi.leaderboard).mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const year = screen.getByLabelText("period.label") as HTMLSelectElement;
      fireEvent.change(year, { target: { value: year.options[1].value } });
      expect(await screen.findByText("common:loading.default")).toBeInTheDocument();
      expect(screen.queryByTestId("metric-flightKm")).toBeNull();
      settle(two);
      expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    });

    it("offers the years of the reader's zone, not the browser's", async () => {
      // 12:00 UTC on New Year's Eve is already 2027 in Kiritimati (UTC+14).
      setClockForTests("2026-12-31T12:00:00.000Z");
      const store = vi.mocked(useSettingsStore);
      const original = store.getMockImplementation();
      // The suite's stub state, with a zone added: the tiles read units from it too.
      const base = (store as unknown as { getState: () => { display: object } }).getState();
      const state = { ...base, display: { ...base.display, timezone: "Pacific/Kiritimati" } };
      store.mockImplementation(((select?: (s: typeof state) => unknown) =>
        select ? select(state) : state) as never);
      try {
        vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
        render(<LeaderboardPage />);
        await screen.findByTestId("metric-flightKm");
        const year = screen.getByLabelText("period.label") as HTMLSelectElement;
        expect(year.options[1].value).toBe("2027");
      } finally {
        store.mockImplementation(original!);
      }
    });
  });
});
