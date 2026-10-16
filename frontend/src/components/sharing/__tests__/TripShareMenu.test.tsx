import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TripShareMenu from "../TripShareMenu";
import { sharingApi } from "../../../lib/api/sharing";

/**
 * "Teilen" is ONE entry point with two meanings kept apart (spec 2026-10-16,
 * D10/D11): a copy for travel companions, or a public link.
 */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { tripSharing: vi.fn(), shareTrip: vi.fn() },
}));
vi.mock("../../shareLinks/ShareLinkDialog", () => ({
  default: ({ kind, targetId }: { kind: string; targetId: string }) => (
    <div>
      link-dialog {kind} {targetId}
    </div>
  ),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
const demo = { value: false };
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
const api = vi.mocked(sharingApi);

describe("TripShareMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo.value = false;
    api.tripSharing.mockResolvedValue({
      groupId: null,
      members: [],
      candidates: [],
      bookingTotals: [],
      people: [],
      linkableUsers: [],
    });
  });

  it("offers the companions copy and the public link", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    expect(screen.getByRole("menuitem", { name: "sharing:menu.companions" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "sharing:menu.link" }));
    expect(screen.getByText("link-dialog trip t1")).toBeTruthy();
  });

  it("opens the share dialog with a person picker", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "sharing:menu.companions" }));
    expect(await screen.findByText("sharing:shareDialog.nobody")).toBeTruthy();
  });

  it("is absent for the shared demo account", () => {
    demo.value = true;
    render(<TripShareMenu tripId="t1" />);
    expect(screen.queryByRole("button", { name: "sharing:menu.button" })).toBeNull();
  });

  it("says so when the sharing state cannot be loaded, instead of a dialog that looks empty", async () => {
    api.tripSharing.mockRejectedValue(new Error("boom"));
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "sharing:menu.companions" }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "sharing:trip.errors.loadFailed")
    );
    expect(screen.queryByText("sharing:shareDialog.nobody")).toBeNull();
    // The menu is still there for another try.
    expect(screen.getByRole("button", { name: "sharing:menu.button" })).toBeTruthy();
  });

  it("is operable by keyboard: focus moves into the menu, Escape closes it and returns focus", async () => {
    render(<TripShareMenu tripId="t1" />);
    const trigger = screen.getByRole("button", { name: "sharing:menu.button" });
    await userEvent.click(trigger);
    const first = screen.getByRole("menuitem", { name: "sharing:menu.companions" });
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "sharing:menu.link" })
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
