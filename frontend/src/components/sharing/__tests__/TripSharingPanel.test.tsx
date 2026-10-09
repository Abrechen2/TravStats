import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripSharingPanel from "../TripSharingPanel";
import { sharingApi } from "../../../lib/api/sharing";
import type { TripSharing } from "../../../types/sharing";

/**
 * The share tick on a trip (S1): one per linked companion; ticking copies the
 * trip; a companion without consent cannot be ticked and the panel says why;
 * a refused share is said by its code, not swallowed.
 */

vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { tripSharing: vi.fn(), shareTrip: vi.fn(), leaveGroup: vi.fn() },
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const api = vi.mocked(sharingApi);
const ben = { id: "u-ben", username: "ben", displayName: "Ben" };
const carl = { id: "u-carl", username: "carl", displayName: "Carl" };

const unshared: TripSharing = {
  groupId: null,
  members: [],
  candidates: [
    { companionId: "c-ben", name: "Ben", user: ben, consenting: true, shared: false },
    { companionId: "c-carl", name: "Carl", user: carl, consenting: false, shared: false },
  ],
};

function renderPanel(onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <TripSharingPanel tripId="t1" onChanged={onChanged} />
    </MemoryRouter>
  );
  return onChanged;
}

describe("TripSharingPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.tripSharing.mockResolvedValue(unshared);
  });

  it("draws a tick per linked companion, disabled without consent", async () => {
    renderPanel();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((boxes[0] as HTMLInputElement).disabled).toBe(false);
    expect((boxes[1] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("sharing:trip.noConsent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "sharing:trip.leave" })).toBeNull();
  });

  it("shares on tick, then shows the member and the leave action", async () => {
    api.shareTrip.mockResolvedValue({
      groupId: "g1",
      tripCreated: true,
      created: { flights: 1, lodgingStays: 0, cruises: 0, railJourneys: 0, rentals: 0, stops: 0 },
    });
    const onChanged = renderPanel();
    const [benBox] = await screen.findAllByRole("checkbox");
    api.tripSharing.mockResolvedValue({
      groupId: "g1",
      members: [ben],
      candidates: [{ ...unshared.candidates[0], shared: true }, unshared.candidates[1]],
    });
    await userEvent.click(benBox);
    expect(api.shareTrip).toHaveBeenCalledWith("t1", "c-ben");
    await waitFor(() => expect(screen.getByTestId("share-members").textContent).toContain("Ben"));
    const [after] = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(after.checked).toBe(true);
    expect(after.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "sharing:trip.leave" })).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("says why a share was refused", async () => {
    api.shareTrip.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "SHARE_CONSENT_REQUIRED" } },
    });
    renderPanel();
    const [benBox] = await screen.findAllByRole("checkbox");
    await userEvent.click(benBox);
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "sharing:errors.consentRequired")
    );
  });

  it("shows a failed load as a failure", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    renderPanel();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("sharing:trip.errors.loadFailed")).toBeTruthy();
  });

  it("leaves the group after confirming", async () => {
    api.tripSharing.mockResolvedValue({
      groupId: "g1",
      members: [ben],
      candidates: [{ ...unshared.candidates[0], shared: true }],
    });
    api.leaveGroup.mockResolvedValue(undefined);
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "sharing:trip.leave" }));
    // The confirm dialog's own button carries the same label.
    const buttons = await screen.findAllByRole("button", { name: "sharing:trip.leave" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.leaveGroup).toHaveBeenCalledWith("t1"));
    expect(addToast).toHaveBeenCalledWith("success", "sharing:trip.left");
  });
});
