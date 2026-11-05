import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRoadtripWeather } from "../useRoadtripWeather";
import { roadtripsApi } from "../../lib/api/roadtrips";
import type { RoadtripStation, StationWeather } from "../../types/roadtrip";

vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { stationWeather: vi.fn() } }));

const station = (id: string, day: string | null, lat: number | null = 50): RoadtripStation =>
  ({
    id,
    title: id,
    lat,
    lon: lat === null ? null : 8,
    startDate: day ? `${day}T00:00:00.000Z` : null,
    state: "pass",
  }) as RoadtripStation;

const measured = (day: string): StationWeather => ({
  code: 3,
  tMaxC: 20,
  tMinC: 12,
  precipMm: 0,
  day,
  lat: 50,
  lon: 8,
  source: "open-meteo",
  fetchedAt: "2026-11-05T00:00:00Z",
});

const STATIONS = [
  station("a", "2026-07-01"),
  station("b", "2026-07-02"),
  station("c", "2026-07-03"),
  station("today", "2026-11-05"),
  station("unplaced", "2026-07-04", null),
];

describe("useRoadtripWeather", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only placed stations whose arrival day is past", async () => {
    vi.mocked(roadtripsApi.stationWeather).mockImplementation(async (_r, id) => ({
      outcome: "observed",
      weather: measured(id),
    }));
    const { result } = renderHook(() => useRoadtripWeather("r", STATIONS, "2026-11-05"));
    expect(result.current.eligible).toBe(3);
    await act(async () => result.current.load());
    expect(vi.mocked(roadtripsApi.stationWeather).mock.calls.map((c) => c[1])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.current.byStation.get("a")?.weather?.tMaxC).toBe(20);
  });

  it("keeps a measurement when the reload fails, and stops asking once rate limited", async () => {
    const api = vi.mocked(roadtripsApi.stationWeather);
    api.mockImplementation(async (_r, id) => ({ outcome: "observed", weather: measured(id) }));
    const { result } = renderHook(() => useRoadtripWeather("r", STATIONS, "2026-11-05"));
    await act(async () => result.current.load());

    api.mockReset();
    api
      .mockResolvedValueOnce({ outcome: "timeout", weather: null })
      .mockResolvedValueOnce({ outcome: "rateLimited", weather: null });
    await act(async () => result.current.load());

    // a: timeout, b: 429, c: not asked any more — none lost its measurement.
    expect(api).toHaveBeenCalledTimes(2);
    for (const id of ["a", "b", "c"]) {
      expect(result.current.byStation.get(id)?.weather?.tMaxC).toBe(20);
    }
    expect(result.current.byStation.get("a")?.problem).toBe("timeout");
    expect(result.current.byStation.get("c")?.problem).toBe("rateLimited");
  });

  it("reads a thrown request as the weather service not answering, not as no weather", async () => {
    vi.mocked(roadtripsApi.stationWeather).mockRejectedValue(new Error("Network Error"));
    const { result } = renderHook(() => useRoadtripWeather("r", [STATIONS[0]], "2026-11-05"));
    await act(async () => result.current.load());
    expect(result.current.byStation.get("a")).toMatchObject({
      weather: null,
      problem: "unavailable",
    });
  });

  it("stops at the first 'disabled': the instance switch is off for every station", async () => {
    vi.mocked(roadtripsApi.stationWeather).mockResolvedValue({
      outcome: "disabled",
      weather: null,
    });
    const { result } = renderHook(() => useRoadtripWeather("r", STATIONS, "2026-11-05"));
    await act(async () => result.current.load());
    expect(roadtripsApi.stationWeather).toHaveBeenCalledTimes(1);
  });

  it("does not show or keep a measurement for a station whose day or place was edited since", async () => {
    const api = vi.mocked(roadtripsApi.stationWeather);
    api.mockImplementation(async (_r, id) => ({ outcome: "observed", weather: measured(id) }));
    const { result, rerender } = renderHook(
      ({ stations }) => useRoadtripWeather("r", stations, "2026-11-05"),
      { initialProps: { stations: [STATIONS[0]] } }
    );
    await act(async () => result.current.load());
    expect(result.current.byStation.get("a")?.weather).not.toBeNull();

    const moved = [{ ...STATIONS[0], startDate: "2026-07-09T00:00:00.000Z" }];
    rerender({ stations: moved });
    expect(result.current.byStation.get("a")).toBeUndefined();

    // A failed reload must not resurrect the old day's value either.
    api.mockResolvedValueOnce({ outcome: "timeout", weather: null });
    await act(async () => result.current.load());
    expect(result.current.byStation.get("a")).toMatchObject({ weather: null, problem: "timeout" });
  });

  it("stops asking when the app's own limiter answers 429", async () => {
    vi.mocked(roadtripsApi.stationWeather).mockRejectedValue(
      Object.assign(new Error("429"), { response: { status: 429 } })
    );
    const { result } = renderHook(() => useRoadtripWeather("r", STATIONS, "2026-11-05"));
    await act(async () => result.current.load());
    expect(roadtripsApi.stationWeather).toHaveBeenCalledTimes(1);
    expect(result.current.byStation.get("c")?.problem).toBe("rateLimited");
  });
});
