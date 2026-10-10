import { describe, expect, it } from "vitest";
import { busPaths, buildBusLayers } from "../tripBusLayer";
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
    expect(chord).toEqual({
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
