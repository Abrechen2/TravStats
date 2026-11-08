import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FriendsPage from "../FriendsPage";
import { comparisonApi } from "../../../lib/api/comparison";
import { friendsApi } from "../../../lib/api/friends";
import type { CompareResponse, LeaderboardRow } from "../../../lib/comparison/types";
import type { Friend, FriendsResponse } from "../../../lib/friends/types";
import { NO_SWITCHES } from "../../../types/sharingRemote";
import { person, friendOf } from "./fixtures";

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
  comparisonApi: { people: vi.fn(), compare: vi.fn() },
}));
vi.mock("../../../lib/api/friends", async (original) => ({
  ...(await original<typeof import("../../../lib/api/friends")>()),
  friendsApi: { list: vi.fn(), trips: vi.fn(), plans: vi.fn(), remove: vi.fn() },
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
const listOf = (...friends: Friend[]): FriendsResponse => ({
  friends,
  requests: [],
  admissions: [],
  federationAvailable: true,
});
const groups = (boards: { id: string; name: string; members: string[] }[] = []) => ({
  requests: [],
  people: [],
  boards,
});
const answer = (friends: LeaderboardRow[]): CompareResponse => ({
  year: null,
  self: rowOf("self", 1000),
  friends,
});

const panelOf = (key: string) => within(screen.getByTestId(`friend-panel-${key}`));

describe("FriendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(comparisonApi.people).mockResolvedValue(groups());
    vi.mocked(friendsApi.trips).mockResolvedValue({ toThem: [], fromThem: [] });
    vi.mocked(friendsApi.plans).mockResolvedValue({ plans: [] });
  });
  const mount = () =>
    render(
      <MemoryRouter>
        <FriendsPage />
      </MemoryRouter>
    );

  it("lists friends from /friends, compares the first at once and fetches exactly the picked keys", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben), friendOf(cleo)));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    await screen.findByTestId("cell-flightKm-self");
    expect(comparisonApi.compare).toHaveBeenCalledWith([ben.key], "all");
    expect(comparisonApi.people).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    await waitFor(() =>
      expect(comparisonApi.compare).toHaveBeenLastCalledWith([ben.key, cleo.key], "all")
    );
    expect(screen.getByTestId(`friend-panel-${cleo.key}`)).toBeInTheDocument();
  });

  it("a friend who gives no comparison is never fetched and the panel says so in one line", async () => {
    const quiet = friendOf(ben, { theirs: { ...NO_SWITCHES, tripOffers: true } });
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(quiet));
    mount();
    await screen.findByTestId(`friend-panel-${ben.key}`);
    const panel = panelOf(ben.key);
    expect(await panel.findByTestId("compare-off")).toHaveTextContent("friend.compareOff");
    expect(panel.getByTestId("achievements-off")).toHaveTextContent(
      "achievements.unavailable.notShared"
    );
    expect(comparisonApi.compare).not.toHaveBeenCalled();
  });

  it("a friend who withdrew while the page is open reads 'teilt nicht mehr' and draws no bar for them", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben), friendOf(cleo)));
    // The server no longer lists Cleo (she stopped sharing back): her row is absent.
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    const cleoPanel = panelOf(cleo.key);
    await waitFor(() =>
      expect(cleoPanel.getByTestId("cell-flightKm-friend").textContent).toBe("status.withdrawn")
    );
    expect(cleoPanel.getByTestId("bar-flightKm-them").style.width).toBe("0%");
    expect(panelOf(ben.key).getByTestId("metric-flightKm")).toHaveAttribute("data-lead", "you");
  });

  it("refuses a fourth friend and says why", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(
      listOf(friendOf(ben), friendOf(cleo), friendOf(dan), friendOf(eli))
    );
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    await screen.findByTestId(`friend-panel-${ben.key}`);
    fireEvent.click(screen.getByRole("button", { name: "Cleo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dan" }));
    fireEvent.click(screen.getByRole("button", { name: "Eli" }));
    await waitFor(() => expect(screen.getAllByTestId("trips-toThem")).toHaveLength(3));
    expect(screen.getByRole("status").textContent).toBe("friends.limit");
    expect(screen.getByRole("button", { name: "Eli" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a failed comparison says so instead of an empty panel", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben)));
    vi.mocked(comparisonApi.compare).mockRejectedValueOnce(new Error("down"));
    mount();
    expect(await screen.findByText("friends.loadFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-flightKm-self")).toBeNull();
    expect(screen.getByText("error.unknown")).toBeInTheDocument();
  });

  it("a failed friends load says so with a retry", async () => {
    vi.mocked(friendsApi.list).mockRejectedValue(new Error("down"));
    mount();
    expect(await screen.findByText("peopleLoadFailed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common:buttons.retry" })).toBeInTheDocument();
  });

  it("with no friend yet it offers to add one", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf());
    mount();
    expect(await screen.findByText("friends.noFriends")).toBeInTheDocument();
    expect(comparisonApi.compare).not.toHaveBeenCalled();
  });

  it("a year other than 'all' asks for that year", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben)));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    await screen.findByTestId("cell-flightKm-self");
    const select = screen.getByLabelText("period.label");
    const year = (select as HTMLSelectElement).options[1].value;
    fireEvent.change(select, { target: { value: year } });
    await waitFor(() =>
      expect(comparisonApi.compare).toHaveBeenLastCalledWith([ben.key], Number(year))
    );
  });

  it("a group that no longer exists leaves the filter instead of hiding every friend", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben)));
    vi.mocked(comparisonApi.people)
      .mockResolvedValueOnce(groups([{ id: "b1", name: "Crew", members: [ben.key] }]))
      .mockResolvedValue(groups());
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.change(await screen.findByLabelText("board.label"), { target: { value: "b1" } });
    expect(screen.getByRole("button", { name: "Ben" })).toBeInTheDocument();
  });

  it("an unanswered request can be withdrawn, and a refusal is said", async () => {
    const waiting = friendOf(cleo, { state: "pending_out" });
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben), waiting));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    vi.mocked(friendsApi.remove)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ removed: true });
    mount();
    await screen.findByTestId("cell-flightKm-self");
    fireEvent.click(screen.getByRole("button", { name: "friend.withdraw" }));
    expect(await screen.findByRole("status")).toHaveTextContent("error.unknown");
    fireEvent.click(screen.getByRole("button", { name: "friend.withdraw" }));
    await waitFor(() => expect(friendsApi.remove).toHaveBeenLastCalledWith(cleo.key));
    await waitFor(() => expect(friendsApi.list).toHaveBeenCalledTimes(2));
  });

  it("the friend list survives a failed group load", async () => {
    vi.mocked(friendsApi.list).mockResolvedValue(listOf(friendOf(ben)));
    vi.mocked(comparisonApi.people).mockRejectedValue(new Error("down"));
    vi.mocked(comparisonApi.compare).mockResolvedValue(answer([rowOf(ben, 400)]));
    mount();
    expect(await screen.findByTestId("cell-flightKm-self")).toBeInTheDocument();
  });
});
