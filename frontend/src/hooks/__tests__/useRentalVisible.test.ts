import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useRentalOffered, useRentalVisible } from "../useRentalVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Rental answers to TWO conditions (rental spec §9): the instance beta switch
 * and the user's domain choice. "Unknown" hides chrome — it never flashes in.
 */
describe("useRentalVisible", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rental"], betaFeaturesEnabled: true });
  });

  it("shows rental when the instance allows it and the user wants it", () => {
    expect(renderHook(() => useRentalVisible()).result.current).toBe(true);
  });

  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("hides rental while the beta flag is %s, even with the domain on", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    expect(renderHook(() => useRentalVisible()).result.current).toBe(false);
  });

  it("hides rental when the user has the domain off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    expect(renderHook(() => useRentalVisible()).result.current).toBe(false);
  });

  it("offers the switch on a beta instance to a user who has not enabled it yet", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    expect(renderHook(() => useRentalOffered()).result.current).toBe(true);
  });

  it("does not offer the switch while the beta flag is off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(renderHook(() => useRentalOffered()).result.current).toBe(false);
  });
});
