import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

vi.unmock("../settingsStore");

import { useSuggestionSwitchesStore } from "../suggestionSwitchesStore";
import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

/** The inbox suggestion switches (forgejo#306) as the web holds them. */
describe("suggestionSwitchesStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSuggestionSwitchesStore.setState({ trips: true, stays: true });
  });

  it("learns both switches from the settings response", () => {
    useSuggestionSwitchesStore
      .getState()
      .noteRemote({ tripSuggestions: { enabled: false }, staySuggestions: { enabled: false } });
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: false });
  });

  it("keeps the default when an older server sends no switch", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ autoCreateTrips: true });
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: true, stays: true });
  });

  it("is fed by loadRemoteSettings, from the same response", async () => {
    vi.spyOn(settingsApi, "getProfile").mockResolvedValue({ birthdate: null } as never);
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      tripSuggestions: { enabled: false },
      staySuggestions: { enabled: true },
    } as UserSettings);
    await useSettingsStore.getState().loadRemoteSettings();
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: true });
  });

  it("a flip persists the nested key at once", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    useSuggestionSwitchesStore.getState().setTrips(false);
    useSuggestionSwitchesStore.getState().setStays(false);
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: false });
    expect(update).toHaveBeenCalledWith({ tripSuggestions: { enabled: false } });
    expect(update).toHaveBeenCalledWith({ staySuggestions: { enabled: false } });
  });

  it("a failed save puts the switch back", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("offline"));
    useSuggestionSwitchesStore.getState().setStays(false);
    await vi.waitFor(() => expect(useSuggestionSwitchesStore.getState().stays).toBe(true));
  });
});
