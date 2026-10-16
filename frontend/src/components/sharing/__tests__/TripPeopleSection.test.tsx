import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripPeopleSection from "../TripPeopleSection";
import { sharingApi } from "../../../lib/api/sharing";
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
});
