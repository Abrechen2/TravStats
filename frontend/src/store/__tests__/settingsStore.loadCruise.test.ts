import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

// The real store, not the global setup.ts mock: the thing under test is what
// `loadRemoteSettings` merges, which a mock cannot show.
vi.unmock("../settingsStore");

import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

/**
 * The cruise slice comes back from the server like every other group.
 *
 * It was the one that did not. The server stored and returned it correctly, and
 * this merge skipped it — so a second browser started on the built-in defaults:
 * no cruise line, no cabin type, and the cruise arcs switched back on for
 * somebody who had turned them off. Worse than losing the preference: the next
 * unrelated save sent those defaults back and overwrote the good server values
 * (audit finding AUD-016). Matching localStorage on the same machine hid it.
 */
describe("settingsStore.loadRemoteSettings — cruise slice", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      cruise: { defaultLine: "", defaultCabinType: null, showCruiseArcs: true },
    });
    vi.restoreAllMocks();
  });

  it("takes the cruise defaults from the server answer", async () => {
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      cruise: {
        defaultLine: "AIDA",
        defaultCabinType: "balcony",
        showCruiseArcs: false,
      },
    } as unknown as UserSettings);

    await useSettingsStore.getState().loadRemoteSettings();

    const { cruise } = useSettingsStore.getState();
    expect(cruise.defaultLine).toBe("AIDA");
    expect(cruise.defaultCabinType).toBe("balcony");
    // The one that is not merely a preference: an arc layer switching itself
    // back on looks like the app ignoring the user.
    expect(cruise.showCruiseArcs).toBe(false);
  });

  it("leaves the local values alone when the server sends no cruise block", async () => {
    useSettingsStore.setState({
      cruise: { defaultLine: "TUI", defaultCabinType: "suite", showCruiseArcs: false },
    });
    vi.spyOn(settingsApi, "get").mockResolvedValue({} as unknown as UserSettings);

    await useSettingsStore.getState().loadRemoteSettings();

    expect(useSettingsStore.getState().cruise.defaultLine).toBe("TUI");
    expect(useSettingsStore.getState().cruise.showCruiseArcs).toBe(false);
  });
});
