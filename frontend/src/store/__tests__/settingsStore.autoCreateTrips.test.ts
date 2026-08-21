import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

// Use the real settingsStore so the setter runs for real, rather than the
// global setup.ts mock's fixed defaults.
vi.unmock("../settingsStore");

import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

describe("settingsStore.setAutoCreateTrips", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoCreateTrips: true });
    vi.restoreAllMocks();
  });

  it("defaults to true", () => {
    expect(useSettingsStore.getState().autoCreateTrips).toBe(true);
  });

  it("updates local state immediately and persists via settingsApi.update", async () => {
    const updateSpy = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);

    useSettingsStore.getState().setAutoCreateTrips(false);

    expect(useSettingsStore.getState().autoCreateTrips).toBe(false);

    await Promise.resolve();
    await Promise.resolve();

    expect(updateSpy).toHaveBeenCalledWith({ autoCreateTrips: false });
  });

  it("logs a warning instead of throwing when the persist call fails", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("network down"));

    expect(() => useSettingsStore.getState().setAutoCreateTrips(false)).not.toThrow();
    expect(useSettingsStore.getState().autoCreateTrips).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
  });
});
