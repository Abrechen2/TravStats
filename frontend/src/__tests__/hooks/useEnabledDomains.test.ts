import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";

// The global setup (src/__tests__/setup.ts) replaces `useSettingsStore` with
// a static mock. For this test we need the real Zustand store so we can call
// `.setState` on it.
vi.unmock("../../store/settingsStore");

describe("useEnabledDomains", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("returns currently enabled domains", () => {
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.enabled).toEqual(["flight"]);
    expect(result.current.isEnabled("flight")).toBe(true);
    expect(result.current.isEnabled("cruise")).toBe(false);
  });

  it("reacts to store updates", () => {
    const { result } = renderHook(() => useEnabledDomains());
    act(() => {
      useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    });
    expect(result.current.isEnabled("cruise")).toBe(true);
  });
});
