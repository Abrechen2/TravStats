// forgejo#352: while live playback runs, the arc data must NOT be rebuilt per
// cursor tick — that re-aggregation and re-tessellation was the cost.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGlobeTimeSlider } from "../useGlobeTimeSlider";
import { useTimeSliderStore } from "../../../store/timeSliderStore";
import type { GeoJSONFeature } from "../../../types";

const flight = (id: string, departureTime: string | null) =>
  ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: { id, departureTime, arrivalTime: null },
  }) as unknown as GeoJSONFeature;

const FLIGHTS = [
  flight("a", "2024-01-02T00:00:00Z"),
  flight("b", "2024-02-02T00:00:00Z"),
  flight("c", "2024-03-02T00:00:00Z"),
  flight("undated", null),
];

beforeEach(() => useTimeSliderStore.getState().reset());

describe("useGlobeTimeSlider arc input", () => {
  it("hands the arcs the same dated flights at every cursor tick, while the visible set still follows the cursor", () => {
    const { result } = renderHook(() => useGlobeTimeSlider(FLIGHTS, []));
    act(() => {
      useTimeSliderStore.getState().setMode("live");
      useTimeSliderStore.getState().setCurrentDate(new Date("2024-01-15T00:00:00Z"));
    });
    const first = result.current.arcFlights;
    expect(result.current.arcTimeline).toBe(true);
    expect(first.map((f) => f.properties.id)).toEqual(["a", "b", "c"]);
    expect(result.current.filteredFlights.map((f) => f.properties.id)).toEqual(["a"]);
    act(() => useTimeSliderStore.getState().setCurrentDate(new Date("2024-02-15T00:00:00Z")));
    expect(result.current.arcFlights).toBe(first);
    expect(result.current.filteredFlights.map((f) => f.properties.id)).toEqual(["a", "b"]);
  });

  it("outside live mode the arcs are exactly the filtered flights, as before", () => {
    const { result } = renderHook(() => useGlobeTimeSlider(FLIGHTS, []));
    expect(result.current.arcTimeline).toBe(false);
    expect(result.current.arcFlights).toBe(result.current.filteredFlights);
  });
});
