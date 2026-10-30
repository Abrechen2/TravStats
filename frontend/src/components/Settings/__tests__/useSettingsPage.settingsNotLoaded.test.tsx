import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  settingsApi: {
    update: mocks.update,
    updateProfile: mocks.updateProfile,
    getApiKeys: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue(null),
    getProfile: vi.fn().mockResolvedValue({ birthdate: null }),
  },
  authApi: { me: vi.fn().mockResolvedValue(null) },
  backupApi: { getInfo: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1", username: "admin", isAdmin: false } }),
}));

// setup.ts globally stubs `useSettingsStore` down to a selector-only mock. This
// file drives the real store through the hook, so it needs the real thing.
vi.mock("../../../store/settingsStore", async () =>
  vi.importActual("../../../store/settingsStore")
);

import { useSettingsPage } from "../useSettingsPage";

import { useSettingsStore } from "../../../store/settingsStore";
import { useRemoteSettingsStatus } from "../../../store/remoteSettingsStatus";

describe("useSettingsPage — settings that never loaded (forgejo#372)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRemoteSettingsStatus.setState({ failed: false });
  });

  it("writes nothing and reports a failed auto-save instead of overwriting the account", async () => {
    const { result } = renderHook(() => useSettingsPage());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    useRemoteSettingsStatus.setState({ failed: true });

    act(() => {
      useSettingsStore.getState().setFeatures({ enableCostTracking: true });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.autoSaveState).toBe("failed");
  });
});
