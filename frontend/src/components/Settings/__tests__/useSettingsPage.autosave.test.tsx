import { renderHook, act, waitFor } from "@testing-library/react";
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
vi.mock("../../../store/settingsStore", async () => vi.importActual("../../../store/settingsStore"));

import { useSettingsPage } from "../useSettingsPage";
import { useSettingsStore } from "../../../store/settingsStore";

describe("useSettingsPage — profile auto-save (#186)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      profile: { username: "admin", email: "", birthdate: undefined },
    });
  });

  /**
   * The reported repro: type a birthdate, leave the page, come back — it's gone.
   * It never persisted because the debounced save effect only watched `units`,
   * so editing the profile scheduled no write at all. The picture next to it
   * saves itself (own endpoint) and the page shows "auto-saved", which is why
   * the loss is invisible until you return.
   */
  it("persists a birthdate typed into the profile form, with no explicit save click", async () => {
    const { result } = renderHook(() => useSettingsPage());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    mocks.updateProfile.mockClear();

    act(() => {
      result.current.setProfile({ birthdate: "1985-03-14" });
    });

    await waitFor(
      () => expect(mocks.updateProfile).toHaveBeenCalledWith({ birthdate: "1985-03-14" }),
      { timeout: 2000 }
    );
  });

  /**
   * Mounting the page is not an edit. The effect fired on its very first run,
   * PUTting whatever the store happened to hold at that instant — `null` while
   * the real value was still in flight from the server.
   */
  it("writes nothing on mount", async () => {
    renderHook(() => useSettingsPage());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  /**
   * The half a unit test alone would have missed, and the browser caught:
   * `loadRemoteSettings` (App boot) mutates `profile`, which re-triggers the
   * effect. Without the snapshot guard that echoed the server's own values
   * straight back at it as a write on every single page load.
   */
  it("does not echo a server hydration back as a write", async () => {
    renderHook(() => useSettingsPage());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    await act(async () => {
      await useSettingsStore.getState().loadRemoteSettings();
      await new Promise((r) => setTimeout(r, 1200));
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  /** But a real edit after hydration must still be written. */
  it("still saves an edit made after hydration", async () => {
    const { result } = renderHook(() => useSettingsPage());
    await act(async () => {
      await useSettingsStore.getState().loadRemoteSettings();
      await new Promise((r) => setTimeout(r, 700));
    });
    mocks.updateProfile.mockClear();

    act(() => {
      result.current.setProfile({ birthdate: "1977-09-07" });
    });

    await waitFor(
      () => expect(mocks.updateProfile).toHaveBeenCalledWith({ birthdate: "1977-09-07" }),
      { timeout: 2000 }
    );
  });
});
