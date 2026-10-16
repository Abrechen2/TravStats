import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TripShareMenu, { placeMenu } from "../TripShareMenu";
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

  it("ArrowUp from the first item wraps to the last", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "sharing:menu.link" })
    );
  });

  it("closes on an outside click but not on a click inside the panel", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.click(screen.getByRole("menu"));
    expect(screen.queryByRole("menu")).not.toBeNull();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when Tab leaves the menu", async () => {
    render(
      <div>
        <TripShareMenu tripId="t1" />
        <button type="button">elsewhere</button>
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // Focus moving to another element in the page closes it as well.
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("hands focus back to the trigger when Tab closes the menu", async () => {
    render(<TripShareMenu tripId="t1" />);
    const trigger = screen.getByRole("button", { name: "sharing:menu.button" });
    await userEvent.click(trigger);
    const first = screen.getByRole("menuitem", { name: "sharing:menu.companions" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the trigger scrolls fully out of the viewport", async () => {
    render(<TripShareMenu tripId="t1" />);
    const trigger = screen.getByRole("button", { name: "sharing:menu.button" });
    const rectAt = (top: number) => ({
      top,
      bottom: top + 40,
      left: 4,
      right: 90,
      width: 86,
      height: 40,
      x: 4,
      y: top,
      toJSON: () => ({}),
    });
    const spy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rectAt(100));
    await userEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeNull();
    // Still partly visible: the menu follows the trigger and stays open.
    spy.mockReturnValue(rectAt(-20));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("menu")).not.toBeNull();
    // Fully above the viewport: nothing left to anchor to.
    spy.mockReturnValue(rectAt(-80));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders the panel in a portal, outside the clipping container, and inside the viewport", async () => {
    const { container } = render(<TripShareMenu tripId="t1" />);
    const trigger = screen.getByRole("button", { name: "sharing:menu.button" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 140,
      left: 4,
      right: 90,
      width: 86,
      height: 40,
      x: 4,
      y: 100,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    await userEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.style.left).toBe("16px");
    expect(menu.style.visibility).toBe("visible");
  });
});

describe("placeMenu", () => {
  const viewport = { width: 375, height: 700 };

  it("keeps a panel for a trigger near the left edge inside the gutter", () => {
    const p = placeMenu({ top: 100, bottom: 140, right: 90 }, 100, viewport);
    expect(p.left).toBe(16);
    expect(p.left + p.width).toBeLessThanOrEqual(375 - 16);
  });

  it("clamps a trigger at the right edge to the right gutter", () => {
    const p = placeMenu({ top: 100, bottom: 140, right: 400 }, 100, viewport);
    expect(p.left + p.width).toBe(375 - 16);
  });

  it("opens above when there is no room below and more above", () => {
    const p = placeMenu({ top: 640, bottom: 680, right: 300 }, 100, viewport);
    expect(p.top).toBe(640 - 6 - 100);
  });

  it("narrows on a very narrow viewport", () => {
    const p = placeMenu({ top: 0, bottom: 40, right: 300 }, 100, { width: 200, height: 700 });
    expect(p.width).toBe(168);
  });
});
