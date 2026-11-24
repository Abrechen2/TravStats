import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  settingsApi: { update: mocks.update, updateProfile: mocks.updateProfile },
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../settingsStore", async () => vi.importActual("../settingsStore"));

import { snapshotOf, useSettingsStore } from "../settingsStore";
import { SettingsNotLoadedError } from "../settingsPatch";

/** Pretend the server answered with the store's current values. */
const markLoaded = () =>
  useSettingsStore.setState({ remoteSnapshot: snapshotOf(useSettingsStore.getState()) });

describe("settings save is a patch, never a default object (UAT rc.45 B1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.updateProfile.mockResolvedValue({});
    useSettingsStore.setState({
      remoteSnapshot: null,
      profile: {
        username: "u",
        email: "u@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        birthdate: "1990-01-01",
      },
      display: { ...useSettingsStore.getState().display, language: "de", theme: "dark" },
      enabledDomains: ["flight", "lodging", "bus"],
    });
  });

  it("reports nothing pending and sends nothing before the first load", async () => {
    expect(useSettingsStore.getState().hasPendingChanges()).toBe(false);
    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toBeInstanceOf(
      SettingsNotLoadedError
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("sends only the changed display field, no names, no domains, no birthdate", async () => {
    markLoaded();
    useSettingsStore.getState().setDisplay({ theme: "light" });
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toEqual({ display: { theme: "light" } });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("names every domain a shrinking list switches off", async () => {
    markLoaded();
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.update.mock.calls[0][0]).toEqual({
      enabledDomains: ["flight"],
      removedDomains: ["lodging", "bus"],
    });
  });

  it("sends a changed name alone and the birthdate only when it changed", async () => {
    markLoaded();
    useSettingsStore.getState().setProfile({ lastName: "Byron" });
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.update.mock.calls[0][0]).toEqual({ profile: { lastName: "Byron" } });
    expect(mocks.updateProfile).not.toHaveBeenCalled();

    useSettingsStore.getState().setProfile({ birthdate: "1991-02-02" });
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.updateProfile).toHaveBeenCalledWith({ birthdate: "1991-02-02" });
    const profile = mocks.update.mock.calls[1][0].profile;
    expect(profile).not.toHaveProperty("firstName");
    expect(profile).not.toHaveProperty("lastName");
  });

  it("sends nothing at all when nothing changed", async () => {
    markLoaded();
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
