import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: { capabilities: mocks.capabilities },
}));

const authState: { user: { id: string; isAdmin: boolean } | null } = {
  user: { id: "u1", isAdmin: false },
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.unmock("../../store/settingsStore");

import { useTravPlanOffered, useTravPlanVisible } from "../useTravPlanVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * TravPlan used to be open to every logged-in user with no beta key: the
 * routes rendered for anyone and the header swapped itself for a mode
 * switcher whenever the server switch was on. It now answers to the instance
 * beta switch first and to `travel_plan_config.enabled` second.
 */
describe("useTravPlanVisible", () => {
  beforeEach(() => {
    authState.user = { id: "u1", isAdmin: false };
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    mocks.capabilities.mockReset().mockResolvedValue({ enabled: true });
  });

  it("shows the planning mode when the beta switch and the server switch are both on", async () => {
    const { result } = renderHook(() => useTravPlanVisible());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("hides it while the beta switch is %s, and never asks the server", (_l, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    expect(renderHook(() => useTravPlanVisible()).result.current).toBe(false);
    expect(renderHook(() => useTravPlanOffered()).result.current).toBe(false);
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("hides it from a normal user while the server switch is off", async () => {
    mocks.capabilities.mockResolvedValue({ enabled: false });
    const { result } = renderHook(() => useTravPlanVisible());
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("fails closed when the server cannot be asked", async () => {
    mocks.capabilities.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTravPlanVisible());
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("shows it to an admin with the server switch off — the admin page is where it is turned on", () => {
    authState.user = { id: "a1", isAdmin: true };
    expect(renderHook(() => useTravPlanVisible()).result.current).toBe(true);
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("shows nothing without a session", () => {
    authState.user = null;
    expect(renderHook(() => useTravPlanVisible()).result.current).toBe(false);
  });
});
