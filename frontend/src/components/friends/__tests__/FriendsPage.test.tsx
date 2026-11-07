import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FriendsPage from "../FriendsPage";
import { comparisonApi } from "../../../lib/api/comparison";
import type {
  CompareResponse,
  LeaderboardRow,
  PeopleResponse,
} from "../../../lib/comparison/types";
import { person, friendView } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de", exists: () => false } }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: (d: string) => d === "flight" }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "rgb(1, 2, 3)" }),
}));
vi.mock("../../ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../comparison/BoardsSection", () => ({ default: () => null }));
vi.mock("../../../lib/api/achievements", () => ({
  achievementsApi: { getAll: vi.fn().mockResolvedValue({ achievements: [] }) },
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: { people: vi.fn(), compare: vi.fn(), listAdmissions: vi.fn() },
}));

const ben = person("11111111-1111-4111-8111-111111111111", "Ben");
const cleo = person("22222222-2222-4222-8222-222222222222", "Cleo");
const dan = person("33333333-3333-4333-8333-333333333333", "Dan");
const eli = person("44444444-4444-4444-8444-444444444444", "Eli");
const snap = (metrics: Record<string, number>) => ({
  schema: "travstats-leaderboard" as const,
  version: 2 as const,
  asOf: "2026-11-07T00:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics,
  partial: [],
});
const rowOf = (p: ReturnType<typeof person> | "self", km: number): LeaderboardRow => ({
  person:
    p === "self"
      ? { key: "self", kind: "self", username: "me", displayName: "Me", origin: null }
      : p,
  status: "ok",
  snapshot: snap({ flightKm: km }),
  achievements: { catalogue: "1".repeat(16), items: [] },
  sharedYear: null,
});
const people = (...friends: ReturnType<typeof person>[]): PeopleResponse => ({
  requests: [],
  people: friends.map((f) => friendView(f)),
  boards: [],
});
const answer = (friends: LeaderboardRow[]): CompareResponse => ({
  year: null,
  self: rowOf("self", 1000),
  friends,
});

describe("FriendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(comparisonApi.listAdmissions).mockResolvedValue([]);
  });

  it("compares the first friend at once and fetches exactly the picked keys", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people(ben, cleo));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    render(<FriendsPage />);
    await screen.findByTestId("cell-flightKm-self");
    expect(comparisonApi.compare).toHaveBeenCalledWith([ben.key], "all");
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    await waitFor(() =>
      expect(comparisonApi.compare).toHaveBeenLastCalledWith([ben.key, cleo.key], "all")
    );
  });

  it("a friend who withdrew while the page is open reads 'teilt nicht mehr', difference empty, not 0", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people(ben, cleo));
    // The server no longer lists Cleo (she stopped sharing back): her row is absent.
    vi.mocked(comparisonApi.compare)
      .mockResolvedValueOnce(answer([rowOf(ben, 400)]))
      .mockResolvedValue(answer([rowOf(ben, 400)]));
    render(<FriendsPage />);
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    await waitFor(() =>
      expect(screen.getByTestId(`cell-flightKm-${cleo.key}`).textContent).toBe("status.withdrawn")
    );
    expect(screen.getByTestId(`diff-flightKm-${cleo.key}`).textContent).toBe("");
    expect(screen.getByTestId(`diff-flightKm-${ben.key}`).textContent).toMatch(/^\+/);
  });

  it("refuses a fourth friend and says why", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people(ben, cleo, dan, eli));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    render(<FriendsPage />);
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dan" }));
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.click(screen.getByRole("button", { name: "Eli" }));
    expect(screen.getByRole("status").textContent).toBe("friends.limit");
    expect(screen.getByRole("button", { name: "Eli" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a failed comparison says so with a retry instead of an empty table", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people(ben));
    vi.mocked(comparisonApi.compare).mockRejectedValueOnce(new Error("down"));
    render(<FriendsPage />);
    expect(await screen.findByText("friends.loadFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-flightKm-self")).toBeNull();
    expect(screen.getByText("error.unknown")).toBeInTheDocument();
  });

  it("a failed people load says so, and a missing admission list is reported, not hidden", async () => {
    vi.mocked(comparisonApi.people).mockRejectedValue(new Error("down"));
    vi.mocked(comparisonApi.listAdmissions).mockRejectedValue(new Error("down"));
    render(<FriendsPage />);
    expect(await screen.findByText("peopleLoadFailed")).toBeInTheDocument();
    expect(screen.getByText("friends.admissionsFailed")).toBeInTheDocument();
  });

  it("with no friend yet it offers to add one instead of an empty table", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people());
    render(<FriendsPage />);
    expect(await screen.findByText("friends.noFriends")).toBeInTheDocument();
    expect(comparisonApi.compare).not.toHaveBeenCalled();
  });

  it("a year other than 'all' asks for that year", async () => {
    vi.mocked(comparisonApi.people).mockResolvedValue(people(ben));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    render(<FriendsPage />);
    await screen.findByTestId("cell-flightKm-self");
    const select = screen.getByLabelText("period.label");
    const year = (select as HTMLSelectElement).options[1].value;
    fireEvent.change(select, { target: { value: year } });
    await waitFor(() =>
      expect(comparisonApi.compare).toHaveBeenLastCalledWith([ben.key], Number(year))
    );
  });
});
