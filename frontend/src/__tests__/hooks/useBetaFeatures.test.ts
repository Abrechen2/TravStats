import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useSettingsStore } from "../../store/settingsStore";

// The global setup (src/__tests__/setup.ts) replaces `useSettingsStore` with a
// static mock. We need the real Zustand store so we can flip the flag.
vi.unmock("../../store/settingsStore");

describe("useBetaFeatures", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null });
  });

  it("hides everything while the flag is unknown (not loaded yet)", () => {
    const { result } = renderHook(() => useBetaFeatures());
    expect(result.current.betaFeaturesEnabled).toBeNull();
    expect(result.current.isFeatureVisible("poiDomain")).toBe(false);
    expect(result.current.isFeatureVisible("tripAiSummary")).toBe(false);
    expect(result.current.isFeatureVisible("passport")).toBe(false);
  });

  it("hides everything when the flag is off", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const { result } = renderHook(() => useBetaFeatures());
    expect(result.current.isFeatureVisible("poiDomain")).toBe(false);
  });

  it("shows registered features when the flag is on", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    const { result } = renderHook(() => useBetaFeatures());
    expect(result.current.isFeatureVisible("poiDomain")).toBe(true);
    expect(result.current.isFeatureVisible("tripAiSummary")).toBe(true);
    expect(result.current.isFeatureVisible("passport")).toBe(true);
  });

  it("reacts to the flag arriving from the settings request", () => {
    const { result } = renderHook(() => useBetaFeatures());
    expect(result.current.isFeatureVisible("tripAiSummary")).toBe(false);
    act(() => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
    });
    expect(result.current.isFeatureVisible("tripAiSummary")).toBe(true);
  });

  it("never persists the flag to localStorage", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    const raw = window.localStorage.getItem("settings-storage") ?? "";
    expect(raw).not.toContain("betaFeaturesEnabled");
  });
});
