import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  pullDawarich: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../lib/api/tours", () => ({
  toursApi: {
    tracks: {
      list: mocks.list,
      get: mocks.get,
      upload: mocks.upload,
      remove: mocks.remove,
      pullDawarich: mocks.pullDawarich,
    },
  },
}));

vi.mock("../../lib/api/dawarich", () => ({
  dawarichApi: { getSettings: mocks.getSettings },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useTourTracks } from "../useTourTracks";

const TRACK_A = {
  id: "track-a",
  routeId: "route-1",
  source: "gpx" as const,
  name: "Day 1",
  startedAt: "2026-06-01T08:00:00.000Z",
  endedAt: "2026-06-01T16:00:00.000Z",
  pointCount: 500,
  distanceKm: 120,
  truncated: false,
  createdAt: "2026-06-02T00:00:00.000Z",
};

const TRACK_B = { ...TRACK_A, id: "track-b", name: "Day 2" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue({ ...TRACK_A, geometry: [[8.0, 58.15], [8.1, 58.3]] });
  mocks.getSettings.mockResolvedValue({
    baseUrl: null,
    hasKey: false,
    source: null,
    isShared: false,
    hasAccess: false,
  });
});

describe("useTourTracks", () => {
  it("loads tracks on mount", async () => {
    mocks.list.mockResolvedValue([TRACK_A]);
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    expect(result.current.tracksLoading).toBe(true);
    await waitFor(() => expect(result.current.tracksLoading).toBe(false));

    expect(mocks.list).toHaveBeenCalledWith("trip-1", "route-1");
    expect(result.current.tracks).toEqual([TRACK_A]);
    expect(result.current.tracksLoadError).toBe(false);
  });

  it("refreshes the list after a successful upload", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([TRACK_A]);
    mocks.upload.mockResolvedValue({ ...TRACK_A, geometry: [] });
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));
    await waitFor(() => expect(result.current.tracksLoading).toBe(false));
    expect(result.current.tracks).toEqual([]);

    const file = new File(["<gpx/>"], "track.gpx");
    await result.current.uploadTrack(file);

    expect(mocks.upload).toHaveBeenCalledWith("trip-1", "route-1", file);
    await waitFor(() => expect(result.current.tracks).toEqual([TRACK_A]));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("refreshes the list after a successful delete", async () => {
    mocks.list.mockResolvedValueOnce([TRACK_A, TRACK_B]).mockResolvedValueOnce([TRACK_B]);
    mocks.remove.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));
    await waitFor(() => expect(result.current.tracks).toEqual([TRACK_A, TRACK_B]));

    await result.current.deleteTrack("track-a");

    expect(mocks.remove).toHaveBeenCalledWith("trip-1", "route-1", "track-a");
    await waitFor(() => expect(result.current.tracks).toEqual([TRACK_B]));
  });

  // The case that matters most: a failed load must surface as an error
  // state, never as an empty list that looks identical to "no tracks yet".
  // A zero rendered over a failed request is a lie the user cannot see
  // through.
  it("surfaces a failed load as an error state, not an empty list", async () => {
    mocks.list.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    await waitFor(() => expect(result.current.tracksLoading).toBe(false));
    expect(result.current.tracksLoadError).toBe(true);
    expect(result.current.tracks).toEqual([]);
  });

  it("resolves Dawarich availability from the settings endpoint", async () => {
    mocks.getSettings.mockResolvedValue({
      baseUrl: "https://dawarich.lan",
      hasKey: true,
      source: "user",
      isShared: false,
      hasAccess: true,
    });
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));
    await waitFor(() => expect(result.current.dawarichAvailable).toBe(true));
  });

  it("refreshes the list after a successful Dawarich pull", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([TRACK_A]);
    mocks.pullDawarich.mockResolvedValue({ ...TRACK_A, geometry: [] });
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));
    await waitFor(() => expect(result.current.tracksLoading).toBe(false));

    await result.current.pullDawarichTrack();

    expect(mocks.pullDawarich).toHaveBeenCalledWith("trip-1", "route-1", {});
    await waitFor(() => expect(result.current.tracks).toEqual([TRACK_A]));
  });

  it("resolves each track's geometry lazily for coverage gating", async () => {
    mocks.list.mockResolvedValue([TRACK_A]);
    mocks.get.mockResolvedValue({
      ...TRACK_A,
      geometry: [
        [8.0, 58.15],
        [8.1, 58.3],
      ],
    });
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));
    await waitFor(() => expect(result.current.tracksWithGeometry).toHaveLength(1));

    expect(mocks.get).toHaveBeenCalledWith("trip-1", "route-1", "track-a");
    expect(result.current.tracksWithGeometry[0]).toEqual({
      id: "track-a",
      geometry: [
        [8.0, 58.15],
        [8.1, 58.3],
      ],
    });
  });

  // Coordinator follow-up on b6829bf5, item 2: `tracksKnown` must reflect
  // BOTH the list-level state and each track's own geometry resolution —
  // a list that loaded fine is not enough if one of its tracks is still an
  // unknown quantity.
  it("tracksKnown is true once the list loaded and every track's geometry resolved", async () => {
    mocks.list.mockResolvedValue([TRACK_A]);
    mocks.get.mockResolvedValue({ ...TRACK_A, geometry: [[8.0, 58.15], [8.1, 58.3]] });
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    expect(result.current.tracksKnown).toBe(false);
    await waitFor(() => expect(result.current.tracksKnown).toBe(true));
  });

  it("tracksKnown stays false while the list loaded fine but a track's own geometry fetch failed", async () => {
    mocks.list.mockResolvedValue([TRACK_A]);
    mocks.get.mockRejectedValue(new Error("geometry fetch failed"));
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    await waitFor(() => expect(result.current.tracksLoading).toBe(false));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    // The list itself is fine — no load error — but the one track's
    // geometry never resolved, so coverage cannot be trusted yet.
    expect(result.current.tracksLoadError).toBe(false);
    expect(result.current.tracksWithGeometry).toHaveLength(0);
    expect(result.current.tracksKnown).toBe(false);
  });

  it("tracksKnown is true (vacuously) once a genuinely empty list has loaded", async () => {
    mocks.list.mockResolvedValue([]);
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    await waitFor(() => expect(result.current.tracksLoading).toBe(false));
    expect(result.current.tracksKnown).toBe(true);
  });

  it("tracksKnown is false while the list itself failed to load", async () => {
    mocks.list.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useTourTracks("trip-1", "route-1"));

    await waitFor(() => expect(result.current.tracksLoadError).toBe(true));
    expect(result.current.tracksKnown).toBe(false);
  });
});
