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
      data: { name: string; count: number }[];
      color: number[];
    };
    expect(props.color).toEqual([16, 32, 48]);
    expect(props.data.map((d) => [d.name, d.count])).toEqual([
      ["Seoul", 1],
      ["Sokcho", 1],
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
