import { describe, it, expect, beforeEach, vi } from "vitest";

// These tests exercise real persistence via zustand's `persist` middleware
// writing to jsdom's localStorage. `vi.resetModules()` + a fresh dynamic
// `import()` simulates a page reload: the store module is re-evaluated
// from scratch, exactly like navigating away from /stats and back —
// which is the actual bug reported in issue #188 (state reset on every
// visit instead of being remembered).
describe("statsCompareStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults to compareEnabled=false, compareYear=null, no preference set", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    const state = useStatsCompareStore.getState();
    expect(state.compareEnabled).toBe(false);
    expect(state.compareYear).toBeNull();
    expect(state.hasSetPreference).toBe(false);
  });

  it("remembers the toggle switched OFF across a simulated page reload", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    // Simulate: auto-pick turned comparison on, user then explicitly
    // turns it off.
    useStatsCompareStore.getState().setCompare(true, 2023);
    useStatsCompareStore.getState().setCompareEnabled(false);

    vi.resetModules();
    const { useStatsCompareStore: reloaded } = await import("../statsCompareStore");
    const state = reloaded.getState();
    expect(state.compareEnabled).toBe(false);
    expect(state.hasSetPreference).toBe(true);
  });

  it("remembers the toggle switched ON across a simulated page reload", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    useStatsCompareStore.getState().setCompareEnabled(true);

    vi.resetModules();
    const { useStatsCompareStore: reloaded } = await import("../statsCompareStore");
    expect(reloaded.getState().compareEnabled).toBe(true);
  });

  it("remembers the chosen comparison year across a simulated page reload", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    useStatsCompareStore.getState().setCompareYear(2022);

    vi.resetModules();
    const { useStatsCompareStore: reloaded } = await import("../statsCompareStore");
    expect(reloaded.getState().compareYear).toBe(2022);
  });

  it("setCompareEnabled and setCompareYear each mark hasSetPreference", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    expect(useStatsCompareStore.getState().hasSetPreference).toBe(false);
    useStatsCompareStore.getState().setCompareEnabled(false);
    expect(useStatsCompareStore.getState().hasSetPreference).toBe(true);
  });

  it("setCompareYear alone also marks hasSetPreference", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    expect(useStatsCompareStore.getState().hasSetPreference).toBe(false);
    useStatsCompareStore.getState().setCompareYear(2021);
    expect(useStatsCompareStore.getState().hasSetPreference).toBe(true);
  });

  it("reset restores factory defaults", async () => {
    const { useStatsCompareStore } = await import("../statsCompareStore");
    useStatsCompareStore.getState().setCompare(true, 2020);
    useStatsCompareStore.getState().reset();
    const state = useStatsCompareStore.getState();
    expect(state.compareEnabled).toBe(false);
    expect(state.compareYear).toBeNull();
    expect(state.hasSetPreference).toBe(false);
  });
});
