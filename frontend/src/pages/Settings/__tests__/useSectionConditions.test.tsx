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
vi.mock("../../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: vi.fn() },
}));

import { dawarichSourceHeld, useSectionConditions } from "../useSectionConditions";
import { useLocationProviderStore } from "../../../store/locationProviderStore";

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
