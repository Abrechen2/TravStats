import { describe, it, expect, beforeEach, vi } from "vitest";

vi.unmock("../settingsStore");

import { useSettingsStore } from "../settingsStore";
import { useRemoteSettingsStatus } from "../remoteSettingsStatus";
import { settingsApi } from "../../lib/api";

describe("settingsStore.loadRemoteSettings — a failed read (forgejo#372)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useRemoteSettingsStatus.setState({ failed: false });
    useSettingsStore.setState({
      remoteSnapshot: null,
      enabledDomainsLoaded: false,
    });
    vi.spyOn(settingsApi, "getProfile").mockResolvedValue({ birthdate: null } as never);
  });

  it("flags the failure and stamps no snapshot from the local defaults", async () => {
    vi.spyOn(settingsApi, "get").mockRejectedValue(new Error("Network Error"));

    await useSettingsStore.getState().loadRemoteSettings();

    const state = useSettingsStore.getState();
    expect(useRemoteSettingsStatus.getState().failed).toBe(true);
    expect(state.remoteSnapshot).toBeNull();
    expect(state.enabledDomainsLoaded).toBe(false);
  });

  it("clears the failure and records the snapshot when a retry succeeds", async () => {
    vi.spyOn(settingsApi, "get").mockRejectedValueOnce(new Error("Network Error"));
    await useSettingsStore.getState().loadRemoteSettings();
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      enabledDomains: ["flight", "cruise"],
    } as never);

    await useSettingsStore.getState().loadRemoteSettings();

    const state = useSettingsStore.getState();
    expect(useRemoteSettingsStatus.getState().failed).toBe(false);
    expect(state.enabledDomainsLoaded).toBe(true);
    expect(state.remoteSnapshot).not.toBeNull();
  });
});
