import { __clearRailHttpCache } from "../../rail/lookup/railHttp";
import {
  encodePolyline,
  mockFetch,
  type FetchMock,
} from "../../rail/lookup/__tests__/railFetchMock";
import { lineLabelMatches, lookupBusLine } from "../transitousBusLine";

jest.mock("../../tour/routing/resolveProvider", () => ({ resolveRouteProvider: jest.fn() }));
jest.mock("../../../utils/sharedDemo", () => ({
  isSharedDemoUser: jest.fn().mockResolvedValue(false),
}));
jest.mock("../../rail/lookup", () => ({
  railProviderSwitches: jest.fn().mockResolvedValue({ transitous: true, dbRest: true }),
}));
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import { railProviderSwitches } from "../../rail/lookup";
import { fetchBusLine } from "../busRouting";

// Augsburg-ish: Hbf -> Koenigsplatz -> Uni, the shape wiggles between the stops.
const HBF = { name: "Hbf", lat: 48.3654, lon: 10.8858 };
const MID = { name: "Konigsplatz", lat: 48.3665, lon: 10.8975 };
const UNI = { name: "Uni", lat: 48.3335, lon: 10.8975 };
const SHAPE: Array<[number, number]> = [
  [HBF.lon, HBF.lat],
  [10.89, 48.3662],
  [MID.lon, MID.lat],
  [10.9, 48.35],
  [UNI.lon, UNI.lat],
];
const DEPARTS = "2026-11-02T07:00:00Z";
const ride = {
  lineName: "48",
  departureTime: new Date(DEPARTS),
  depLat: HBF.lat,
  depLon: HBF.lon,
  arrLat: UNI.lat,
  arrLon: UNI.lon,
};

const stopTimes = (label: string, tripId = "t1", at = DEPARTS) => ({
  stopTimes: [
    {
      place: { scheduledDeparture: at },
      tripId,
      routeShortName: label,
      displayName: label,
    },
  ],
});
const place = (p: { name: string; lat: number; lon: number }) => ({ ...p });
const trip = (from = HBF, mid = MID, to = UNI, shape = SHAPE) => ({
  legs: [
    {
      from: place(from),
      to: place(to),
      intermediateStops: [place(mid)],
      legGeometry: { points: encodePolyline(shape), precision: 6 },
    },
  ],
});

describe("bus line from Transitous", () => {
  let mock: FetchMock | null = null;
  beforeEach(() => {
    __clearRailHttpCache();
    (resolveRouteProvider as jest.Mock).mockResolvedValue(null);
  });
  afterEach(() => mock?.restore());

  it("matches whole line tokens only", () => {
    expect(lineLabelMatches("Bus 48", ["48"])).toBe(true);
    expect(lineLabelMatches("N17", ["N17"])).toBe(true);
    expect(lineLabelMatches("48", ["148"])).toBe(false);
    expect(lineLabelMatches("4", ["48"])).toBe(false);
  });

  it("matches a bus fixture to the MOTIS trip geometry, clipped to its stops, with a contact User-Agent", async () => {
    mock = mockFetch([
      [/stoptimes/, stopTimes("48")],
      [/api\/v6\/trip/, trip()],
    ]);
    const result = await lookupBusLine({
      lineName: "48",
      departureTime: new Date(DEPARTS),
      dep: { lat: HBF.lat, lon: HBF.lon },
      arr: { lat: UNI.lat, lon: UNI.lon },
    });
    expect(result).toMatchObject({ ok: true, tripId: "t1" });
    if (result.ok) {
      expect(result.geometry.length).toBeGreaterThanOrEqual(4);
      expect(result.geometry[0]).toEqual([HBF.lon, HBF.lat]);
      expect(result.geometry.at(-1)).toEqual([UNI.lon, UNI.lat]);
    }
    expect(mock.userAgents.every((ua) => ua?.startsWith("TravStats"))).toBe(true);
  });

  it("fetchBusLine stores the timetable line as transitous with its length, no road provider needed", async () => {
    mock = mockFetch([
      [/stoptimes/, stopTimes("48")],
      [/api\/v6\/trip/, trip()],
    ]);
    const line = await fetchBusLine("u1", ride);
    expect(line).toMatchObject({ geometrySource: "transitous", fallback: null, lineMiss: null });
    expect(line.routedKm).toBeGreaterThan(3);
  });

  it("asks Transitous nothing when the admin switched it or the internet off (Codex, rc.29 review)", async () => {
    (railProviderSwitches as jest.Mock).mockResolvedValueOnce({ transitous: false, dbRest: true });
    mock = mockFetch([
      [/stoptimes/, stopTimes("48")],
      [/api\/v6\/trip/, trip()],
    ]);
    const line = await fetchBusLine("u1", ride);
    expect(mock.userAgents).toHaveLength(0);
    expect(line).toMatchObject({
      geometrySource: "straight",
      fallback: "no_provider",
      lineMiss: null,
    });
  });

  it("another line, another time or the opposite direction is no match and falls back to the road path with the reason", async () => {
    mock = mockFetch([[/stoptimes/, stopTimes("49")]]);
    const wrongLine = await fetchBusLine("u1", ride);
    expect(wrongLine).toMatchObject({ geometrySource: "straight", lineMiss: "no_match" });

    __clearRailHttpCache();
    mock.restore();
    mock = mockFetch([[/stoptimes/, stopTimes("48", "t1", "2026-11-02T12:00:00Z")]]);
    expect((await fetchBusLine("u1", ride)).lineMiss).toBe("no_match");

    __clearRailHttpCache();
    mock.restore();
    // The trip runs Uni -> Hbf: the alighting terminal is not after the boarding stop.
    mock = mockFetch([
      [/stoptimes/, stopTimes("48")],
      [/api\/v6\/trip/, trip(UNI, MID, HBF, [...SHAPE].reverse())],
    ]);
    expect((await fetchBusLine("u1", ride)).lineMiss).toBe("no_match");
  });

  it("a 429 reads as rate_limited and a stored road line is kept, never a silent chord", async () => {
    mock = mockFetch([[/stoptimes/, { error: "slow down" }, 429]]);
    const line = await fetchBusLine("u1", ride);
    expect(line).toMatchObject({ geometrySource: "straight", lineMiss: "rate_limited" });
    expect(mock.calls.length).toBe(1);
  });

  it("a 5xx is unavailable, a trip without shape is no_shape, no line name asks nothing and says nothing", async () => {
    mock = mockFetch([[/stoptimes/, {}, 503]]);
    expect((await fetchBusLine("u1", ride)).lineMiss).toBe("unavailable");

    __clearRailHttpCache();
    mock.restore();
    const noShape = trip();
    delete (noShape.legs[0] as { legGeometry?: unknown }).legGeometry;
    mock = mockFetch([
      [/stoptimes/, stopTimes("48")],
      [/api\/v6\/trip/, noShape],
    ]);
    expect((await fetchBusLine("u1", ride)).lineMiss).toBe("no_shape");

    mock.restore();
    mock = mockFetch([]);
    expect((await fetchBusLine("u1", { ...ride, lineName: null })).lineMiss).toBeNull();
    expect(
      await lookupBusLine({
        lineName: " ",
        departureTime: ride.departureTime,
        dep: { lat: 1, lon: 1 },
        arr: { lat: 2, lon: 2 },
      })
    ).toEqual({ ok: false, miss: "no_line" });
    expect(mock.calls).toHaveLength(0);
  });
});
