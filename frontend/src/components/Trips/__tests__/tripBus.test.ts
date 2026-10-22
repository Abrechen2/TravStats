import { describe, expect, it } from "vitest";
import { busPaths, busPathPoints, buildBusLayers } from "../tripBusLayer";
import { buildTimelineEvents } from "../../../lib/tripTimelineEvents";
import { busSheet } from "../../../lib/xlsx/busSheet";
import type { Trip } from "../../../types";
import type { TripBusJourney } from "../../../types/bus";

const ride = (over: Partial<TripBusJourney> = {}): TripBusJourney => ({
  id: "r1",
  operator: "Kobus",
  lineName: "Premium",
  rideKind: "intercity",
  depStationName: "Seoul",
  arrStationName: "Sokcho",
  depLat: 37.5,
  depLon: 127.0,
  arrLat: 38.2,
  arrLon: 128.6,
  depTimezone: "Asia/Seoul",
  arrTimezone: "Asia/Seoul",
  departureTime: "2026-10-07T01:00:00.000Z",
  arrivalTime: "2026-10-07T03:30:00.000Z",
  distanceKm: 157,
  distanceSource: "great_circle",
  geometry: null,
  geometrySource: "straight",
  status: "completed",
  delayMinutes: null,
  price: null,
  currency: null,
  bookingId: null,
  ...over,
});

/** forgejo#180: bus rides on the trip map and timeline, and in the workbook. */
describe("bus rides on the trip (forgejo#180)", () => {
  it("draws the chord between the terminals, or the frozen road line where there is one", () => {
    const [chord] = busPaths([ride()]);
    expect(chord).toMatchObject({
      id: "r1",
      path: [
        [127.0, 37.5],
        [128.6, 38.2],
      ],
      routed: false,
    });
    const road: [number, number][] = [
      [127.0, 37.5],
      [127.9, 37.9],
      [128.6, 38.2],
    ];
    expect(busPaths([ride({ geometry: road })])[0]).toMatchObject({ path: road, routed: true });
  });

  it("gives the camera every point of every line, the road geometry where there is one", () => {
    const road: [number, number][] = [
      [127.0, 37.5],
      [127.9, 37.9],
      [128.6, 38.2],
    ];
    expect(busPathPoints([ride({ geometry: road })])).toEqual(road);
    expect(busPathPoints([ride()])).toEqual([
      [127.0, 37.5],
      [128.6, 38.2],
    ]);
    expect(busPathPoints([ride({ depLat: Number.NaN })])).toEqual([]);
  });

  it("leaves out a ride without coordinates and draws nothing for none", () => {
    expect(busPaths([ride({ depLat: Number.NaN })])).toEqual([]);
    expect(buildBusLayers([], "#123456")).toEqual([]);
  });

  it("draws in the colour it is handed — the domain colour store's, not a constant", () => {
    const [layer] = buildBusLayers([ride()], "#102030");
    const getColor = (layer.props as unknown as { getColor: (d: { routed: boolean }) => number[] })
      .getColor;
    expect(getColor({ routed: true })).toEqual([16, 32, 48, 230]);
    expect(getColor({ routed: false })).toEqual([16, 32, 48, 150]);
  });

  it("names the terminals on the trip map in the bus colour (forgejo#320)", () => {
    const layers = buildBusLayers([ride(), ride({ id: "r2", status: "cancelled" })], "#102030");
    const labels = layers.find((l) => l.id === "trip-bus-station-labels");
    const props = labels?.props as unknown as {
      data: { name: string; count: number; color: number[] }[];
    };
    expect(props.data.map((d) => [d.name, d.count, d.color])).toEqual([
      ["Seoul", 1, [16, 32, 48]],
      ["Sokcho", 1, [16, 32, 48]],
    ]);
  });

  it("places a ride on the timeline at its departure, on the terminal's clock", () => {
    const trip = { id: "t", busJourneys: [ride()] } as unknown as Trip;
    const events = buildTimelineEvents(trip, []);
    const bus = events.find((e) => e.kind === "bus");
    expect(bus?.id).toBe("bus-r1");
    expect(bus?.when.local?.slice(0, 16)).toBe("2026-10-07T10:00");
  });

  it("writes a bus sheet whose keys the importer reads", () => {
    const keys = busSheet((k) => k).columns.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "depStationName",
        "depLat",
        "depLon",
        "arrStationName",
        "arrLat",
        "arrLon",
        "departureTime",
        "arrivalTime",
        "tripId",
      ])
    );
  });
});

it("draws repeated bus geometry once, excluding cancellations and retaining actual variants", () => {
  const rides = Array.from({ length: 10 }, (_, i) => ride({ id: `bus-${i}` }));
  expect(busPaths(rides)).toHaveLength(1);
  expect(busPaths(rides)[0]).toMatchObject({ count: 10, memberIds: rides.map((r) => r.id) });
  expect(busPaths([ride({ status: "cancelled" })])).toEqual([]);
  expect(busPathPoints([ride({ status: "cancelled" })])).toEqual([]);
  expect(
    busPaths([
      ...rides,
      ride({
        id: "detour",
        geometry: [
          [127, 37.5],
          [128, 38],
          [128.6, 38.2],
        ],
      }),
    ])
  ).toHaveLength(2);
});

// beta.23 UAT before 2.7.0-rc.20: on the trip map's globe the København →
// Hamburg ZOB chord showed only two stubs at its terminals. A two-point line
// is a straight segment through the sphere, so its middle sank under the
// surface and was clipped; the trip map also never lifted the bus line at all.
describe("bus rides on the globe", () => {
  const kbhHamburg = ride({
    depStationName: "København",
    depLat: 55.6729,
    depLon: 12.5646,
    arrStationName: "Hamburg ZOB",
    arrLat: 53.5522,
    arrLon: 10.0136,
  });
  const pathOf = (layers: ReturnType<typeof buildBusLayers>, id: string): number[][] => {
    const layer = layers.find((l) => l.id === id);
    const props = layer?.props as unknown as {
      data: { path: [number, number][] }[];
      getPath: (d: unknown) => number[][];
    };
    return props.getPath(props.data[0]);
  };

  it("follows the great circle above the surface on the globe, flat on the flat map", () => {
    const flat = pathOf(buildBusLayers([kbhHamburg], "#aa5500"), "trip-bus-rides");
    expect(flat).toHaveLength(2);
    const globe = pathOf(buildBusLayers([kbhHamburg], "#aa5500", true), "trip-bus-rides");
    expect(globe.length).toBeGreaterThan(2);
    expect(globe.every((p) => typeof p[2] === "number" && p[2] > 0)).toBe(true);
    expect(globe[0].slice(0, 2)).toEqual([12.5646, 55.6729]);
    expect(globe[globe.length - 1].slice(0, 2)).toEqual([10.0136, 53.5522]);
  });

  it("lifts the terminals on the globe too", () => {
    const layer = buildBusLayers([kbhHamburg], "#aa5500", true).find(
      (l) => l.id === "trip-bus-terminals"
    );
    const props = layer?.props as unknown as {
      data: unknown[];
      getPosition: (d: unknown) => number[];
    };
    expect(props.data.map((d) => props.getPosition(d)[2])).toEqual([5000, 5000]);
  });
});
