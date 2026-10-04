import { beforeEach, describe, expect, it } from "vitest";
import { useOverlayAppearanceStore } from "../overlayAppearanceStore";
import { DEFAULT_OVERLAY_APPEARANCE } from "../../lib/overlayAppearance";

const KEY = "mapAppearance.v2";

/**
 * The store is what both the panel slider and the tab's layer builder read
 * (forgejo#198). A change must reach both at once and survive a reload.
 */
describe("useOverlayAppearanceStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOverlayAppearanceStore.setState({ appearance: DEFAULT_OVERLAY_APPEARANCE });
  });

  it("updates the value and persists only that key into the shared blob", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ styleId: "dark" }));
    useOverlayAppearanceStore.getState().setValue("railStationSize", 0);
    expect(useOverlayAppearanceStore.getState().appearance.railStationSize).toBe(0);
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(stored).toEqual({ styleId: "dark", railStationSize: 0 });
  });

  it("persists the rental line switch as a boolean", () => {
    useOverlayAppearanceStore.getState().setValue("rentalShowLine", false);
    expect(useOverlayAppearanceStore.getState().appearance.rentalShowLine).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}").rentalShowLine).toBe(false);
  });

  it("leaves the other fields as they were", () => {
    useOverlayAppearanceStore.getState().setValue("tourLineWidth", 1.7);
    const { appearance } = useOverlayAppearanceStore.getState();
    expect(appearance).toEqual({ ...DEFAULT_OVERLAY_APPEARANCE, tourLineWidth: 1.7 });
  });
});
