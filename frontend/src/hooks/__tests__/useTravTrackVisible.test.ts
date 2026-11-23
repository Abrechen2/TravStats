import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock("../../lib/api/travtrack", () => ({
  travTrackApi: { capabilities: mocks.capabilities },
}));

const authState: { user: { id: string; isAdmin: boolean } | null } = {
  user: { id: "u1", isAdmin: false },
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.unmock("../../store/settingsStore");

import { travTrackSettingsVisible, useTravTrackVisible } from "../useTravTrackVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Who sees `/track` and its menu entry (TravTrack plan T6): the `travTrack`
 * beta key, the instance showing TravTrack, and an account recording into it
 * or holding data. Settings is wider: data held stays reachable there with
 * TravTrack switched off (review focus 14).
 */

const caps = (over: object) => ({
  version: 1,
  offered: true,
  enabled: true,
  active: false,
  hasData: false,
  ...over,
});

describe("useTravTrackVisible", () => {
  beforeEach(() => {
    authState.user = { id: "u1", isAdmin: false };
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    mocks.capabilities.mockReset();
  });

  it("the menu entry appears with the beta key, the instance on and provider travtrack", async () => {
    mocks.capabilities.mockResolvedValue(caps({ active: true }));
    const { result } = renderHook(() => useTravTrackVisible());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("…or with the instance on and data held, whatever the provider", async () => {
    mocks.capabilities.mockResolvedValue(caps({ hasData: true }));
    const { result } = renderHook(() => useTravTrackVisible());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("also for an account that neither records into TravTrack nor holds data, once the instance is on (owner 2026-10-26)", async () => {
    mocks.capabilities.mockResolvedValue(caps({}));
    const { result } = renderHook(() => useTravTrackVisible());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("the menu entry is hidden with TravTrack off, even with data", async () => {
    mocks.capabilities.mockResolvedValue(caps({ enabled: false, hasData: true, active: false }));
    const { result } = renderHook(() => useTravTrackVisible());
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("is visible with the beta flag off or unknown — TravTrack is out of beta (2.8)", async () => {
    for (const flag of [false, null]) {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      mocks.capabilities.mockResolvedValue(caps({ active: true }));
      const { result } = renderHook(() => useTravTrackVisible());
      await waitFor(() => expect(result.current).toBe(true));
    }
  });

  it("fails closed while pending and when the server cannot be asked", async () => {
    mocks.capabilities.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTravTrackVisible());
    expect(result.current).toBe(false);
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("Settings shows TravTrack whenever data is held or the instance shows it", () => {
    expect(travTrackSettingsVisible(caps({ enabled: false, hasData: true }) as never)).toBe(true);
    expect(travTrackSettingsVisible(caps({ enabled: true }) as never)).toBe(true);
    expect(travTrackSettingsVisible(caps({ enabled: false }) as never)).toBe(false);
    expect(travTrackSettingsVisible(null)).toBe(false);
  });
});
