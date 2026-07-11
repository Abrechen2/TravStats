import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

// Use the real settingsStore so `setBaseCurrency` runs for real, rather than
// the global setup.ts mock's fixed defaults.
vi.unmock("../settingsStore");

// Imported after the unmock above so the module graph picks it up.
import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

describe("settingsStore.setBaseCurrency", () => {
  beforeEach(() => {
    useSettingsStore.setState({ baseCurrency: "EUR" });
    vi.restoreAllMocks();
  });

  it("updates local state immediately and persists via settingsApi.update — the settings API write, not units.currency", async () => {
    const updateSpy = vi
      .spyOn(settingsApi, "update")
      .mockResolvedValue({} as UserSettings);

    useSettingsStore.getState().setBaseCurrency("CHF");

    // Local state updates synchronously.
    expect(useSettingsStore.getState().baseCurrency).toBe("CHF");

    // The persist call is fire-and-forget; flush microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(updateSpy).toHaveBeenCalledWith({ baseCurrency: "CHF" });
    // Must never touch the unrelated units.currency display preference.
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ units: expect.anything() })
    );
  });

  it("logs a warning instead of throwing when the persist call fails", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("network down"));

    expect(() => useSettingsStore.getState().setBaseCurrency("GBP")).not.toThrow();
    expect(useSettingsStore.getState().baseCurrency).toBe("GBP");

    await Promise.resolve();
    await Promise.resolve();
  });
});
