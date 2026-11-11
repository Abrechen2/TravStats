import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TravTrackCapabilities } from "../../../lib/api/travtrack";
import type { LocationProviderSettings } from "../../../lib/api/locationProvider";

const caps = vi.hoisted(() => ({ current: null as TravTrackCapabilities | null }));
vi.mock("../../../hooks/useTravTrackVisible", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/useTravTrackVisible")>()),
  useTravTrackCapabilities: () => caps.current,
}));
vi.mock("../../../hooks/useTravPlanVisible", () => ({ useTravPlanInstanceOn: () => false }));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
const getProvider = vi.hoisted(() => vi.fn());
const federation = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../lib/api/federationAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: federation,
}));
vi.mock("../../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: vi.fn() },
}));

import { dawarichSourceHeld, useSectionConditions } from "../useSectionConditions";
import { useLocationProviderStore } from "../../../store/locationProviderStore";
import { useAuthStore } from "../../../store/authStore";
import { useFederationStatus } from "../../../store/federationStatusStore";

const provider = (
  kind: LocationProviderSettings["kind"],
  dawarich: boolean
): LocationProviderSettings => ({
  kind,
  rev: 0,
  status: "ok",
  choices: { none: true, travtrack: false, dawarich },
});
const NOT_OFFERED: TravTrackCapabilities = {
  version: 1,
  offered: false,
  enabled: false,
  active: false,
  hasData: false,
};

describe("dawarichSourceHeld", () => {
  it("holds for a chosen Dawarich and for an own Dawarich connection, not for a bare account", () => {
    expect(dawarichSourceHeld(provider("dawarich", false))).toBe(true);
    expect(dawarichSourceHeld(provider("none", true))).toBe(true);
    expect(dawarichSourceHeld(provider("none", false))).toBe(false);
    expect(dawarichSourceHeld(provider("travtrack", false))).toBe(false);
  });

  it("does not hold while the choice is unknown (not loaded, or the read failed)", () => {
    expect(dawarichSourceHeld(null)).toBe(false);
  });
});

describe("useSectionConditions: the TravTrack area for an account on Dawarich alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo.current = false;
    caps.current = NOT_OFFERED;
    useLocationProviderStore.getState().reset();
  });
  afterEach(() => cleanup());

  it("keeps the location source reachable when the server does not offer TravTrack but the source is Dawarich", async () => {
    getProvider.mockResolvedValue(provider("dawarich", true));
    const { result } = renderHook(() => useSectionConditions());
    expect(result.current.locationSourceHeld).toBe(false); // not known yet
    await waitFor(() => expect(result.current.locationSourceHeld).toBe(true));
    expect(result.current.travTrackHeld).toBe(false);
  });

  it("keeps it for an account that only has its own Dawarich connection", async () => {
    getProvider.mockResolvedValue(provider("none", true));
    const { result } = renderHook(() => useSectionConditions());
    await waitFor(() => expect(result.current.locationSourceHeld).toBe(true));
  });

  it("offers nothing to an account without TravTrack and without Dawarich", async () => {
    getProvider.mockResolvedValue(provider("none", false));
    const { result } = renderHook(() => useSectionConditions());
    await act(async () => {});
    expect(getProvider).toHaveBeenCalled();
    expect(result.current.locationSourceHeld).toBe(false);
  });

  it("holds wherever TravTrack is held, with no read of the source needed", async () => {
    caps.current = { ...NOT_OFFERED, hasData: true };
    getProvider.mockResolvedValue(provider("none", false));
    const { result } = renderHook(() => useSectionConditions());
    await act(async () => {});
    expect(result.current.travTrackHeld).toBe(true);
    expect(result.current.locationSourceHeld).toBe(true);
  });

  it("does not ask the server for the demo account", async () => {
    demo.current = true;
    renderHook(() => useSectionConditions());
    await act(async () => {});
    expect(getProvider).not.toHaveBeenCalled();
  });
});

describe("useSectionConditions: Server-Verbindungen waits for the federation switch (settings v3 S5)", () => {
  const signIn = (isAdmin: boolean): void => {
    useAuthStore.setState({ user: { id: "u1", username: "u", isAdmin } as never });
  };
  beforeEach(() => {
    vi.clearAllMocks();
    demo.current = false;
    caps.current = NOT_OFFERED;
    getProvider.mockResolvedValue(provider("none", false));
    useLocationProviderStore.getState().reset();
    useFederationStatus.setState({ enabled: null });
  });
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ user: null });
  });

  it("is closed until the admin's answer is in, then follows it", async () => {
    signIn(true);
    federation.get.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useSectionConditions());
    expect(result.current.federationOn).toBe(false);
    await waitFor(() => expect(result.current.federationOn).toBe(true));
  });

  it("stays closed when the switch is off", async () => {
    signIn(true);
    federation.get.mockResolvedValue({ enabled: false });
    const { result } = renderHook(() => useSectionConditions());
    await waitFor(() => expect(federation.get).toHaveBeenCalled());
    expect(result.current.federationOn).toBe(false);
  });

  it("stays closed, and does not ask the admin's endpoint, for an account that is no admin", async () => {
    signIn(false);
    useFederationStatus.setState({ enabled: true });
    const { result } = renderHook(() => useSectionConditions());
    await waitFor(() => expect(getProvider).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.federationOn).toBe(false);
    expect(federation.get).not.toHaveBeenCalled();
  });

  it("stays closed when the answer could not be read: unknown is not on", async () => {
    signIn(true);
    federation.get.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useSectionConditions());
    await waitFor(() => expect(federation.get).toHaveBeenCalled());
    expect(result.current.federationOn).toBe(false);
  });

  it("follows the switch at once when it is turned off on Funktionen", async () => {
    signIn(true);
    federation.get.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useSectionConditions());
    await waitFor(() => expect(result.current.federationOn).toBe(true));
    act(() => useFederationStatus.getState().set(false));
    expect(result.current.federationOn).toBe(false);
  });
});
