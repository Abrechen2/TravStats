import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  settingsApi: {
    update: mocks.update,
    updateProfile: mocks.updateProfile,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The global setup.ts mocks `useSettingsStore` down to a fixed selector-only
// stub (so components using `useTranslation` don't need real store wiring).
// This file tests the store itself, so it must override that with the real
// implementation for this test file only.
vi.mock("../settingsStore", async () => {
  return vi.importActual("../settingsStore");
});

import { useSettingsStore } from "../settingsStore";
import { logger } from "../../lib/logger";

describe("settingsStore.saveRemoteSettings (#186)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      profile: { username: "u", email: "e@example.com", birthdate: "1990-01-01" },
    });
  });

  it("still runs the birthdate PUT when the general settings PUT fails", async () => {
    mocks.update.mockRejectedValue(new Error("general settings failed"));
    mocks.updateProfile.mockResolvedValue({ birthdate: "1990-01-01" });

    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toThrow();

    expect(mocks.updateProfile).toHaveBeenCalledWith({ birthdate: "1990-01-01" });
  });

  it("still calls the general settings PUT when the birthdate PUT fails", async () => {
    mocks.update.mockResolvedValue({});
    mocks.updateProfile.mockRejectedValue(new Error("birthdate save failed"));

    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toThrow();

    expect(mocks.update).toHaveBeenCalled();
  });

  it("surfaces a failure by throwing, not only logging a warning", async () => {
    const failure = new Error("boom");
    mocks.update.mockRejectedValue(failure);
    mocks.updateProfile.mockResolvedValue({ birthdate: "1990-01-01" });

    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toThrow("boom");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not throw when both writes succeed", async () => {
    mocks.update.mockResolvedValue({});
    mocks.updateProfile.mockResolvedValue({ birthdate: "1990-01-01" });

    await expect(useSettingsStore.getState().saveRemoteSettings()).resolves.toBeUndefined();
  });
});
