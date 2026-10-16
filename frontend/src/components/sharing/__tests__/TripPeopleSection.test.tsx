import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripPeopleSection from "../TripPeopleSection";
import { sharingApi } from "../../../lib/api/sharing";
import { useTripSharingStore } from "../../../store/tripSharingStore";
import type { TripPerson, TripSharing } from "../../../types/sharing";

/**
 * "Reisende" is the one place a trip's people are (spec 2026-10-16, D9): a
 * row each, what is true about them as pills, and at most one action. A member
 * whose consent with the reader is missing says so — changes do not travel.
 */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi.fn(),
    shareTrip: vi.fn(),
    leaveGroup: vi.fn(),
    linkCompanion: vi.fn(),
    requestConsent: vi.fn(),
  },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const api = vi.mocked(sharingApi);

const account = (id: string) => ({ id: `u-${id}`, username: id, displayName: id });
const row = (over: Partial<TripPerson>): TripPerson => ({
  key: "c:x",
  companionId: "x",
  name: "x",
  account: null,
  consent: "none",
  member: false,
  receivesChanges: null,
  shareBlockedBy: "notLinked",
  ...over,
});
const view: TripSharing = {
  groupId: "g1",
  members: [],
  candidates: [],
  bookingTotals: [],
  linkableUsers: [account("ben")],
  people: [
    row({ key: "c:ilse", companionId: "ilse", name: "Ilse" }),
    row({
      key: "c:ben",
      companionId: "ben",
      name: "Ben",
      account: account("ben"),
      consent: "accepted",
      shareBlockedBy: null,
    }),
    row({
      key: "u:u-carl",
      companionId: null,
      name: "Carl",
      account: account("carl"),
      member: true,
      receivesChanges: false,
      shareBlockedBy: "alreadyMember",
    }),
    row({
      key: "c:dora",
      companionId: "dora",
      name: "Dora",
      account: account("dora"),
      member: true,
      receivesChanges: true,
      consent: "accepted",
      shareBlockedBy: "alreadyMember",
    }),
  ],
};

const renderSection = () =>
  render(
    <MemoryRouter>
      <TripPeopleSection tripId="t1" companionNames={["Ilse", "Ben", "Dora"]} />
    </MemoryRouter>
  );

describe("TripPeopleSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.tripSharing.mockResolvedValue(view);
  });

  it("shows the names at once, before the sharing state has loaded", () => {
    api.tripSharing.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByText("Ilse")).toBeTruthy();
    expect(screen.getByText("Dora")).toBeTruthy();
  });

  it("states each person's sharing state and offers one action each", async () => {
    renderSection();
    await screen.findByText("Carl");
    expect(screen.getByRole("button", { name: "sharing:people.actions.link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sharing:people.actions.share" })).toBeTruthy();
    expect(screen.getAllByText("sharing:people.badges.member")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows Zustimmung offen and the hint for a member without consent", async () => {
    renderSection();
    await screen.findByText("Carl");
    expect(screen.getByText("sharing:people.badges.consentPending")).toBeTruthy();
    expect(screen.getByText("sharing:people.noChangesHint")).toBeTruthy();
  });

  it("opens the share dialog for a row instead of sharing on click", async () => {
    renderSection();
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:people.actions.share" })
    );
    expect(api.shareTrip).not.toHaveBeenCalled();
    expect(screen.getByText("sharing:shareDialog.final")).toBeTruthy();
  });

  it("keeps the names when the trip's companions carry no person rows", async () => {
    // A trip whose companions are legacy names without companion entries has
    // names but no `people`; the section must not turn into an empty heading.
    api.tripSharing.mockResolvedValue({ ...view, people: [] });
    renderSection();
    await screen.findByRole("button", { name: "sharing:people.leave" });
    expect(screen.getByText("Ilse")).toBeTruthy();
    expect(screen.getByText("Dora")).toBeTruthy();
  });

  it("keeps the names and says so when the sharing state cannot load", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    renderSection();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("sharing:trip.errors.loadFailed")
    );
    expect(screen.getByText("Ilse")).toBeTruthy();
  });

  it("says the load failed even when the trip has no companion names", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    render(
      <MemoryRouter>
        <TripPeopleSection tripId="t1" companionNames={[]} />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("sharing:trip.errors.loadFailed")
    );
  });

  it("says so when a reload fails after a good load, instead of keeping stale rows silently", async () => {
    renderSection();
    await screen.findByText("Carl");
    api.tripSharing.mockRejectedValue(new Error("down"));
    act(() => useTripSharingStore.getState().bump("t1"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("sharing:trip.errors.loadFailed")
    );
  });

  it("does not show the previous trip's people after the trip changes", async () => {
    const { rerender } = renderSection();
    await screen.findByText("Carl");
    api.tripSharing.mockReturnValue(new Promise(() => {}));
    rerender(
      <MemoryRouter>
        <TripPeopleSection tripId="t2" companionNames={["Zora"]} />
      </MemoryRouter>
    );
    expect(screen.getByText("Zora")).toBeTruthy();
    expect(screen.queryByText("Carl")).toBeNull();
  });

  it("lets the newest response win when an older one arrives last", async () => {
    let resolveOld: (v: TripSharing) => void = () => {};
    let resolveNew: (v: TripSharing) => void = () => {};
    api.tripSharing
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockReturnValueOnce(new Promise((r) => (resolveNew = r)));
    renderSection();
    act(() => useTripSharingStore.getState().bump("t1"));
    await waitFor(() => expect(api.tripSharing).toHaveBeenCalledTimes(2));
    await act(async () => resolveNew(view));
    await screen.findByText("Carl");
    await act(async () =>
      resolveOld({ ...view, people: [row({ key: "c:old", companionId: "old", name: "Olaf" })] })
    );
    expect(screen.queryByText("Olaf")).toBeNull();
    expect(screen.getByText("Carl")).toBeTruthy();
  });

  it("keeps a legacy name beside a member who is no companion, and nobody twice", async () => {
    api.tripSharing.mockResolvedValue({
      ...view,
      people: [
        row({
          key: "u:u-carl",
          companionId: null,
          name: "Carl",
          account: account("carl"),
          member: true,
          receivesChanges: true,
          shareBlockedBy: "alreadyMember",
        }),
        row({
          key: "c:ben",
          companionId: "ben",
          name: "Ben",
          account: account("ben"),
          consent: "accepted",
          shareBlockedBy: null,
        }),
      ],
    });
    render(
      <MemoryRouter>
        <TripPeopleSection tripId="t1" companionNames={["Ilse", "Ben"]} />
      </MemoryRouter>
    );
    await screen.findByText("Carl");
    expect(screen.getByText("Ilse")).toBeTruthy();
    expect(screen.getAllByText("Ben")).toHaveLength(1);
  });

  it("says why nothing can be done for a deactivated account", async () => {
    api.tripSharing.mockResolvedValue({
      ...view,
      people: [
        row({
          key: "c:eva",
          companionId: "eva",
          name: "Eva",
          account: account("eva"),
          consent: "accepted",
          shareBlockedBy: "accountInactive",
        }),
      ],
    });
    renderSection();
    expect(await screen.findByText("sharing:shareDialog.blocked.accountInactive")).toBeTruthy();
  });

  it("draws no empty badge line for a person without pills", async () => {
    renderSection();
    await screen.findByText("Carl");
    const ilse = screen.getByText("Ilse").closest("li");
    expect(ilse?.querySelector(".flex-wrap")).toBeNull();
  });
});
