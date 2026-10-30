import { describe, it, expect, beforeEach, vi } from "vitest";

vi.unmock("../settingsStore");

import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

describe("settingsStore.loadRemoteSettings — a failed read (forgejo#372)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      remoteSnapshot: null,
      remoteLoadFailed: false,
      enabledDomainsLoaded: false,
    });
    vi.spyOn(settingsApi, "getProfile").mockResolvedValue({ birthdate: null } as never);
  });

  it("flags the failure and stamps no snapshot from the local defaults", async () => {
    vi.spyOn(settingsApi, "get").mockRejectedValue(new Error("Network Error"));

    await useSettingsStore.getState().loadRemoteSettings();

    const state = useSettingsStore.getState();
    expect(state.remoteLoadFailed).toBe(true);
    expect(state.remoteSnapshot).toBeNull();
    expect(state.enabledDomainsLoaded).toBe(false);
    // Local defaults are not the account's values: nothing may auto-save them.
    expect(state.hasPendingChanges()).toBe(false);
  });

  it("clears the failure and records the snapshot when a retry succeeds", async () => {
    vi.spyOn(settingsApi, "get").mockRejectedValueOnce(new Error("Network Error"));
    await useSettingsStore.getState().loadRemoteSettings();
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      enabledDomains: ["flight", "cruise"],
    } as never);

    await useSettingsStore.getState().loadRemoteSettings();

    const state = useSettingsStore.getState();
    expect(state.remoteLoadFailed).toBe(false);
    expect(state.enabledDomainsLoaded).toBe(true);
    expect(state.remoteSnapshot).not.toBeNull();
  });
});
