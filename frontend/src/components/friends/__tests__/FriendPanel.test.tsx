import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FriendPanel from "../FriendPanel";
import { friendsApi } from "../../../lib/api/friends";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import { travplanApi } from "../../../lib/api/travplan";
import { tripsApi } from "../../../lib/api/trips";
import { NO_SWITCHES } from "../../../types/sharingRemote";
import { person, friendOf, ALL_ON } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}|${o.name}` : k),
    i18n: { language: "de", exists: () => false },
  }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "rgb(1, 2, 3)" }),
}));
vi.mock("../CompareRows", () => ({ default: () => <div data-testid="compare-rows" /> }));
vi.mock("../AchievementGrid", () => ({ default: () => <div data-testid="achievement-grid" /> }));
vi.mock("../../Settings/ConnectionSwitchesForm", () => ({
  default: ({ onChange, value }: { onChange: (s: unknown) => void; value: unknown }) => (
    <button onClick={() => onChange({ ...(value as object), plans: false })}>toggle-plans</button>
  ),
  theirsSummary: () => null,
}));
vi.mock("../../comparison/ConsentDialog", () => ({
  default: ({ onConfirm }: { onConfirm: (s: unknown) => Promise<void> }) => (
    <button onClick={() => void onConfirm({ groups: ["time"], domains: [], year: null })}>
      scope-confirm
    </button>
  ),
}));
vi.mock("../../sharing/ShareTripDialog", () => ({
  default: ({ preselectedKey }: { preselectedKey?: string }) => (
    <div data-testid="share-dialog" data-preselected={preselectedKey} />
  ),
}));
vi.mock("../../../lib/api/friends", async (original) => ({
  ...(await original<typeof import("../../../lib/api/friends")>()),
  friendsApi: {
    trips: vi.fn(),
    plans: vi.fn(),
    setSwitches: vi.fn().mockResolvedValue({}),
    setScope: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: { offerTrip: vi.fn() } }));
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi.fn().mockResolvedValue({
      groupId: null,
      people: [{ key: "u:7", account: { username: "ben" } }],
      linkableUsers: [],
      bookingTotals: [],
    }),
  },
}));
vi.mock("../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { list: vi.fn(), invite: vi.fn(), inviteConnection: vi.fn() },
}));

const ben = person("11111111-1111-4111-8111-111111111111", "Ben");
const lena = person("22222222-2222-4222-8222-222222222222", "Lena", "https://far.example");
const self = { person: { key: "self" } } as never;

const panel = (friend = friendOf(ben), onChanged = vi.fn()) =>
  render(
    <MemoryRouter>
      <FriendPanel
        friend={friend}
        self={self}
        compareFailed={null}
        year={null}
        domains={null}
        isEnabled={() => true}
        catalogue={null}
        onChanged={onChanged}
      />
    </MemoryRouter>
  );

describe("FriendPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(friendsApi.trips).mockResolvedValue({
      toThem: [
        {
          id: "t1",
          title: "Lisbon",
          startDate: null,
          endDate: null,
          copyState: "linked",
          localTripId: null,
        },
      ],
      fromThem: [
        {
          id: "t2",
          title: "Oslo",
          startDate: null,
          endDate: null,
          copyState: "linked",
          localTripId: "trip-9",
        },
      ],
    });
    vi.mocked(friendsApi.plans).mockResolvedValue({
      plans: [
        {
          id: "trip-5",
          title: "Alps",
          startDate: null,
          endDate: null,
          owner: "me",
          role: "editor",
        },
      ],
    });
  });

  it("shows comparison, achievements, trips in both directions with links to the linked copy, and shared plans", async () => {
    panel();
    expect(screen.getByTestId("compare-rows")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-grid")).toBeInTheDocument();
    expect(await screen.findByText("Lisbon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oslo" })).toHaveAttribute("href", "/trips/trip-9");
    expect(await screen.findByRole("link", { name: "Alps" })).toHaveAttribute(
      "href",
      "/plan/trip-5"
    );
  });

  it("sections follow the data owner's switch and say so: comparison, trips (their offers switch) and plans (both sides)", async () => {
    panel(
      friendOf(ben, { theirs: { ...NO_SWITCHES, plans: false }, mine: { ...ALL_ON, plans: true } })
    );
    expect(screen.getByTestId("compare-off")).toHaveTextContent("friend.compareOff|Ben");
    expect(screen.queryByTestId("compare-rows")).toBeNull();
    expect(screen.getByTestId("achievements-off")).toBeInTheDocument();
    expect(await screen.findByTestId("trips-off")).toHaveTextContent("friend.trips.offersOff|Ben");
    expect(screen.queryByRole("button", { name: "friend.trips.share" })).toBeNull();
    expect(screen.getByTestId("plans-off")).toHaveTextContent("friend.plans.theirsOff|Ben");
    expect(screen.queryByRole("button", { name: "friend.plans.invite" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("trips-toThem")).toBeInTheDocument());
  });

  it("plans need both sides: my own switch off says to switch it on", async () => {
    panel(friendOf(ben, { mine: { ...ALL_ON, plans: false } }));
    expect(screen.getByTestId("plans-off")).toHaveTextContent("friend.plans.mineOff");
    await screen.findByText("Lisbon");
  });

  it("an older server is named, and the comparison-only friend still shows what exists", async () => {
    panel(friendOf(ben, { olderServer: true, theirs: NO_SWITCHES }));
    expect(screen.getByText("friend.olderServerPill")).toBeInTheDocument();
    // The sentence carries the friend's name (it once printed the raw "{{name}}").
    expect(screen.getByTestId("compare-off")).toHaveTextContent("friend.olderServer|Ben");
    await screen.findByText("Lisbon");
  });

  it("a failed trips load says so and offers a retry that reloads only that section", async () => {
    vi.mocked(friendsApi.trips).mockRejectedValueOnce(new Error("down"));
    panel();
    expect(await screen.findByText(/friend\.trips\.loadFailed/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Alps" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "friend.retry" }));
    expect(await screen.findByText("Lisbon")).toBeInTheDocument();
    expect(friendsApi.plans).toHaveBeenCalledTimes(1);
  });

  it("the gear saves switches without a scope, and a refused save shows its reason", async () => {
    const onChanged = vi.fn();
    panel(friendOf(ben), onChanged);
    await screen.findByText("Lisbon");
    fireEvent.click(screen.getByRole("button", { name: "friends.details|Ben" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-plans" }));
    vi.mocked(friendsApi.setSwitches).mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "friend.settings.save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("error.unknown");
    fireEvent.click(screen.getByRole("button", { name: "friend.settings.save" }));
    await waitFor(() =>
      expect(friendsApi.setSwitches).toHaveBeenLastCalledWith(ben.key, { ...ALL_ON, plans: false })
    );
    expect(friendsApi.setScope).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("the scope goes through its own call, and removing a friend asks first", async () => {
    panel();
    await screen.findByText("Lisbon");
    fireEvent.click(screen.getByRole("button", { name: "friends.details|Ben" }));
    fireEvent.click(screen.getByRole("button", { name: "friend.settings.scope" }));
    fireEvent.click(screen.getByRole("button", { name: "scope-confirm" }));
    await waitFor(() =>
      expect(friendsApi.setScope).toHaveBeenCalledWith(ben.key, {
        groups: ["time"],
        domains: [],
        year: null,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "detail.remove" }));
    expect(friendsApi.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "friend.settings.removeConfirm" }));
    await waitFor(() => expect(friendsApi.remove).toHaveBeenCalledWith(ben.key));
  });

  it("'Reise teilen' on a remote friend offers the chosen trip by connection id", async () => {
    vi.mocked(tripsApi.getAll).mockResolvedValue([{ id: "t9", name: "Rome" }] as never);
    vi.mocked(sharingRemoteApi.offerTrip).mockResolvedValue({} as never);
    panel(friendOf(lena, { key: "remote:lb-9", connectionId: "rc-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "friend.trips.share" }));
    fireEvent.change(await screen.findByLabelText("friend.trips.pick"), {
      target: { value: "t9" },
    });
    await screen.findByRole("option", { name: "Rome" });
    fireEvent.click(screen.getByRole("button", { name: "friend.trips.next" }));
    await waitFor(() =>
      expect(sharingRemoteApi.offerTrip).toHaveBeenCalledWith("t9", { remoteId: "rc-1" })
    );
  });

  it("'Reise teilen' on a local friend opens the existing share dialog with that friend preselected", async () => {
    vi.mocked(tripsApi.getAll).mockResolvedValue([{ id: "t9", name: "Rome" }] as never);
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "friend.trips.share" }));
    await screen.findByRole("option", { name: "Rome" });
    fireEvent.change(screen.getByLabelText("friend.trips.pick"), { target: { value: "t9" } });
    fireEvent.click(screen.getByRole("button", { name: "friend.trips.next" }));
    expect((await screen.findByTestId("share-dialog")).dataset.preselected).toBe("u:7");
  });

  it("a friend who is not a traveller on the trip is never replaced by someone else in the share dialog", async () => {
    vi.mocked(tripsApi.getAll).mockResolvedValue([{ id: "t9", name: "Rome" }] as never);
    panel(friendOf(person("33333333-3333-4333-8333-333333333333", "Zoe")));
    fireEvent.click(await screen.findByRole("button", { name: "friend.trips.share" }));
    await screen.findByRole("option", { name: "Rome" });
    fireEvent.change(screen.getByLabelText("friend.trips.pick"), { target: { value: "t9" } });
    fireEvent.click(screen.getByRole("button", { name: "friend.trips.next" }));
    expect((await screen.findByRole("alert")).textContent).toBe("friend.trips.notTraveller|Zoe");
    expect(screen.queryByTestId("share-dialog")).toBeNull();
  });

  it("a failed comparison offers a retry and the achievements say so instead of loading forever", async () => {
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <FriendPanel
          friend={friendOf(ben)}
          self={null}
          compareFailed="error.unknown"
          year={null}
          domains={null}
          isEnabled={() => true}
          catalogue={null}
          onChanged={onChanged}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("achievements-failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "friend.retry" }));
    expect(onChanged).toHaveBeenCalled();
    await screen.findByText("Lisbon");
  });

  it("'Zu Plan einladen' invites a local friend by username and a remote one by connection", async () => {
    vi.mocked(travplanApi.list).mockResolvedValue([
      { id: "p1", tripId: "trip-5", name: "Alps" },
    ] as never);
    vi.mocked(travplanApi.invite).mockResolvedValue({} as never);
    const { unmount } = panel();
    fireEvent.click(await screen.findByRole("button", { name: "friend.plans.invite" }));
    await screen.findByRole("option", { name: "Alps" });
    fireEvent.change(screen.getByLabelText("friend.plans.pick"), { target: { value: "trip-5" } });
    fireEvent.click(screen.getByRole("button", { name: "friend.plans.inviteConfirm" }));
    await waitFor(() => expect(travplanApi.invite).toHaveBeenCalledWith("trip-5", "ben"));
    unmount();
    vi.mocked(travplanApi.inviteConnection).mockRejectedValueOnce(new Error("nope"));
    panel(friendOf(lena, { key: "remote:lb-9", connectionId: "rc-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "friend.plans.invite" }));
    await screen.findByRole("option", { name: "Alps" });
    fireEvent.change(screen.getByLabelText("friend.plans.pick"), { target: { value: "trip-5" } });
    fireEvent.click(screen.getByRole("button", { name: "friend.plans.inviteConfirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe("error.unknown");
    expect(travplanApi.inviteConnection).toHaveBeenCalledWith("trip-5", "rc-1");
  });
});
