import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShareTripDialog from "../ShareTripDialog";
import { sharingApi } from "../../../lib/api/sharing";
import { tripsApi } from "../../../lib/api/trips";
import type { TripPerson, TripSharing } from "../../../types/sharing";
import type { Trip } from "../../../types";
import de from "../../../i18n/resources/de/sharing.json";
import en from "../../../i18n/resources/en/sharing.json";

/**
 * Browser finding (2026-10-16): an account that agreed to sharing but is not a
 * traveller on this trip left the dialog at "Gerade kannst du diese Reise mit
 * niemandem teilen". The dialog now offers the direct path — add the account's
 * name as a traveller, link it, then the ordinary confirmation. Nothing is
 * copied before "Reise teilen", and a failure of either step is said, never a
 * silent half state.
 */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { shareTrip: vi.fn(), tripSharing: vi.fn(), linkCompanion: vi.fn() },
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getById: vi.fn(), update: vi.fn() },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
const api = vi.mocked(sharingApi);
const trips = vi.mocked(tripsApi);

const carlAccount = { id: "u-carl", username: "carl", displayName: "Carl" };
const ilse: TripPerson = {
  key: "c:c-ilse",
  companionId: "c-ilse",
  name: "Ilse",
  account: null,
  consent: "none",
  member: false,
  receivesChanges: null,
  shareBlockedBy: "notLinked",
};
const carl = (over: Partial<TripPerson>): TripPerson => ({
  key: "c:c-carl",
  companionId: "c-carl",
  name: "Carl",
  account: null,
  consent: "accepted",
  member: false,
  receivesChanges: null,
  shareBlockedBy: "notLinked",
  ...over,
});
const view = (people: TripPerson[]): TripSharing => ({
  groupId: null,
  bookingTotals: [],
  linkableUsers: [carlAccount],
  people,
});

const renderDialog = (onPeopleChanged = vi.fn()) => {
  render(
    <ShareTripDialog
      open
      onClose={vi.fn()}
      tripId="t1"
      people={[ilse]}
      linkableUsers={[carlAccount]}
      onShared={vi.fn()}
      onPeopleChanged={onPeopleChanged}
    />
  );
  return onPeopleChanged;
};
const addCarl = () =>
  userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.add.actionLabel" }));

describe("ShareTripDialog — adding a consenting account as a traveller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trips.getById.mockResolvedValue({ id: "t1", companions: ["Ilse"] } as Trip);
    trips.update.mockResolvedValue({ id: "t1", companions: ["Ilse", "Carl"] } as Trip);
  });

  it("offers the account instead of a dead end", () => {
    renderDialog();
    expect(screen.queryByText("sharing:shareDialog.nobody")).toBeNull();
    expect(screen.getByText("sharing:shareDialog.add.title")).toBeTruthy();
    expect(screen.getByText("Carl (@carl)")).toBeTruthy();
  });

  it("adds, links, then asks — and copies nothing before the confirm", async () => {
    api.tripSharing
      .mockResolvedValueOnce(view([ilse, carl({})]))
      .mockResolvedValueOnce(view([ilse, carl({ account: carlAccount, shareBlockedBy: null })]));
    api.linkCompanion.mockResolvedValue({} as never);
    api.shareTrip.mockResolvedValue({ groupId: "g", tripCreated: true, created: {} as never });
    const changed = renderDialog();

    await addCarl();

    expect(trips.update).toHaveBeenCalledWith("t1", { companions: ["Ilse", "Carl"] });
    expect(api.linkCompanion).toHaveBeenCalledWith("c-carl", "u-carl");
    expect(await screen.findByText("sharing:shareDialog.copied")).toBeTruthy();
    expect(api.shareTrip).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect(api.shareTrip).toHaveBeenCalledWith("t1", "c-carl");
  });

  it("says so when adding fails, and changes nothing else", async () => {
    trips.update.mockRejectedValue(new Error("boom"));
    const changed = renderDialog();
    await addCarl();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "sharing:shareDialog.add.addFailed"
    );
    expect(api.linkCompanion).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("says so when linking fails after adding, and leaves the new traveller visible", async () => {
    api.tripSharing.mockResolvedValue(view([ilse, carl({})]));
    api.linkCompanion.mockRejectedValue(new Error("boom"));
    const changed = renderDialog();
    await addCarl();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "sharing:shareDialog.add.linkFailed"
    );
    // Carl is a traveller now (not linked): listed with his reason, and the page reloads.
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(screen.getAllByText("sharing:shareDialog.blocked.notLinked")).toHaveLength(2);
    expect(api.shareTrip).not.toHaveBeenCalled();
  });

  it("has German and English copy for the path", () => {
    for (const bundle of [de, en]) {
      const add = (bundle.shareDialog as Record<string, unknown>).add as Record<string, string>;
      for (const key of [
        "title",
        "action",
        "actionLabel",
        "addFailed",
        "linkFailed",
        "reloadFailed",
      ]) {
        expect(add?.[key], key).toBeTruthy();
      }
    }
  });
});
