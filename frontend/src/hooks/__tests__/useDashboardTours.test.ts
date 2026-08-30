import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  geometryBatch: vi.fn(),
}));

vi.mock("../../lib/api/tourIndex", () => ({
  tourIndexApi: {
    list: mocks.list,
    geometryBatch: mocks.geometryBatch,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useDashboardTours } from "../useDashboardTours";

const TOUR_A = {
  id: "tour-a",
  tripId: "trip-1",
  tripName: "Norway Road Trip",
  name: "Fjord loop",
  mode: "road",
  distanceKm: 420,
  stopCount: 4,
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-05T00:00:00.000Z",
};

const TOUR_B = { ...TOUR_A, id: "tour-b", name: "Coastal leg" };

const geometryFor = (routeId: string) => ({
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [8.0, 58.15],
          [8.1, 58.3],
        ],
      },
      properties: {
        legId: `${routeId}-leg-1`,
        source: "straight" as const,
        mode: "road" as const,
        confidence: "low",
        distanceKm: 12,
      },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.geometryBatch.mockResolvedValue(new Map());
});

describe("useDashboardTours", () => {
  it("does not fetch anything while disabled", () => {
    renderHook(() => useDashboardTours(false));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.geometryBatch).not.toHaveBeenCalled();
  });

  it("loads the list then batches geometry for every returned id", async () => {
    mocks.list.mockResolvedValue([TOUR_A, TOUR_B]);
    mocks.geometryBatch.mockResolvedValue(
      new Map([
        ["tour-a", geometryFor("tour-a")],
        ["tour-b", geometryFor("tour-b")],
      ])
    );

    const { result } = renderHook(() => useDashboardTours(true));
    expect(result.current.toursLoading).toBe(true);

    await waitFor(() => expect(result.current.toursLoading).toBe(false));

    expect(mocks.geometryBatch).toHaveBeenCalledWith(["tour-a", "tour-b"]);
    expect(result.current.tours).toEqual([TOUR_A, TOUR_B]);
    expect(result.current.geometries).toHaveLength(2);
    expect(result.current.toursLoadError).toBe(false);
  });

  // The case that matters most: a failed load must surface as an error
  // state, never as an empty list that looks identical to "no tours yet".
  // A zero rendered over a failed request is a lie the user cannot see
  // through — the exact defect this feature's own briefs already name.
  it("surfaces a failed list load as an error state, not an empty list", async () => {
    mocks.list.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useDashboardTours(true));
    await waitFor(() => expect(result.current.toursLoading).toBe(false));

    expect(result.current.toursLoadError).toBe(true);
    expect(result.current.tours).toEqual([]);
    expect(result.current.geometries).toEqual([]);
  });

  it("surfaces a failed geometry batch as an error state too", async () => {
    mocks.list.mockResolvedValue([TOUR_A]);
    mocks.geometryBatch.mockRejectedValue(new Error("geometry endpoint down"));

    const { result } = renderHook(() => useDashboardTours(true));
    await waitFor(() => expect(result.current.toursLoading).toBe(false));

    expect(result.current.toursLoadError).toBe(true);
    expect(result.current.tours).toEqual([]);
    expect(result.current.geometries).toEqual([]);
  });

  it("resolves to an empty, non-error state when the caller genuinely has no tours", async () => {
    mocks.list.mockResolvedValue([]);

    const { result } = renderHook(() => useDashboardTours(true));
    await waitFor(() => expect(result.current.toursLoading).toBe(false));

    expect(result.current.toursLoadError).toBe(false);
    expect(result.current.tours).toEqual([]);
    expect(result.current.geometries).toEqual([]);
    // Zero tours must never even call the batch endpoint — nothing to
    // ask for, and it would otherwise 400 on `ids: []` (min 1).
    expect(mocks.geometryBatch).not.toHaveBeenCalled();
  });

  it("re-runs the fetch from scratch on reload()", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([TOUR_A]);
    mocks.geometryBatch.mockResolvedValue(new Map([["tour-a", geometryFor("tour-a")]]));

    const { result } = renderHook(() => useDashboardTours(true));
    await waitFor(() => expect(result.current.toursLoading).toBe(false));
    expect(result.current.tours).toEqual([]);

    result.current.reload();

    await waitFor(() => expect(result.current.tours).toEqual([TOUR_A]));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
