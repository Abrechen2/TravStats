// forgejo#312 — the map's flights pick up their recorded lines only while the
// user switched on „Aufgezeichnete Flugwege zeigen" AND the `flightTrackUpload`
// beta key is open; by default the dashboard neither fetches nor draws them.
// A failed fetch is said, not passed off as "no flight was recorded".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { GeoJSONFeature } from "../../types";

const getTrackLinesMock = vi.fn();
vi.mock("../../lib/api", () => ({
  flightsApi: { getTrackLines: (...args: unknown[]) => getTrackLinesMock(...args) },
}));
let betaOn = true;
vi.mock("../useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOn,
    isFeatureVisible: (key: string) => betaOn && key === "flightTrackUpload",
  }),
}));
const addToastMock = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: typeof addToastMock }) => unknown) =>
    select({ addToast: addToastMock }),
}));

import { useRecordedFlightPaths } from "../useRecordedFlightPaths";
import { useRecordedFlightPathsStore } from "../../store/recordedFlightPathsStore";

const feature = (id: string): GeoJSONFeature =>
  ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [11, 48],
        [8, 50],
      ],
    },
    properties: { id },
  }) as unknown as GeoJSONFeature;

const LINE = {
  flightId: "a",
  geometry: [
    [11, 48],
    [9, 49],
    [8, 50],
  ],
  segmentStarts: [0],
};

describe("useRecordedFlightPaths", () => {
  beforeEach(() => {
    getTrackLinesMock.mockReset();
    addToastMock.mockReset();
    betaOn = true;
    useRecordedFlightPathsStore.setState({ show: true });
  });

  it("asks for nothing by default — the dashboard shows routes, not single flights", () => {
    useRecordedFlightPathsStore.setState({ show: false });
    const flights = [feature("a")];
    const { result } = renderHook(() => useRecordedFlightPaths(flights));
    expect(result.current).toBe(flights);
    expect(getTrackLinesMock).not.toHaveBeenCalled();
  });

  it("loads the lines once the option is switched on", async () => {
    useRecordedFlightPathsStore.setState({ show: false });
    getTrackLinesMock.mockResolvedValue([LINE]);
    const flights = [feature("a")];
    const { result } = renderHook(() => useRecordedFlightPaths(flights));
    expect(getTrackLinesMock).not.toHaveBeenCalled();
    act(() => useRecordedFlightPathsStore.getState().setShow(true));
    await waitFor(() => expect(result.current[0].properties.recordedTrack).toBeDefined());
    expect(getTrackLinesMock).toHaveBeenCalledTimes(1);
  });

  it("attaches each recorded line to its flight", async () => {
    getTrackLinesMock.mockResolvedValue([LINE]);
    const flights = [feature("a"), feature("b")];
    const { result } = renderHook(() => useRecordedFlightPaths(flights));
    await waitFor(() =>
      expect(result.current[0].properties.recordedTrack).toEqual({
        solid: [LINE.geometry],
        gaps: [],
      })
    );
    expect(result.current[1]).toBe(flights[1]);
  });

  it("asks for nothing while the beta key is closed", async () => {
    betaOn = false;
    const flights = [feature("a")];
    const { result } = renderHook(() => useRecordedFlightPaths(flights));
    expect(result.current).toBe(flights);
    expect(getTrackLinesMock).not.toHaveBeenCalled();
  });

  it("says when the lines could not be loaded and keeps the great circles", async () => {
    getTrackLinesMock.mockRejectedValue(new Error("503"));
    const flights = [feature("a")];
    const { result } = renderHook(() => useRecordedFlightPaths(flights));
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith("warning", "flights:track.linesLoadError")
    );
    expect(result.current).toBe(flights);
  });
});
