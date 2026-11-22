// Per domain: a planned-only marker carries the planned flag (drawn hollow,
// said "geplant"), a mixed one is solid, and a cancelled entry is on no map
// layer at all (owner report on rc.43, forgejo map-planned).
import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import { buildLodgingPins } from "../lodgingPinsLayer";
import { buildPlacePins } from "../placePinsLayer";
import { createCruisePortsLayer } from "../cruisePortsLayer";
import { buildRailPaths, buildRailStations } from "../railPathsLayer";
import { buildRentalLinks, buildRentalPoints, type RentalMapSource } from "../rentalLayer";
import { terminalPoints, busPaths } from "../../Trips/tripBusLayer";
import { buildPortPoints } from "../../Globe/globePointData";
import { makeRailJourney } from "../../rail/__tests__/railJourneyFixture";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import type { Cruise } from "../../../types";

const dataOf = (layers: Layer[] | null, id: string): Record<string, unknown>[] =>
  ((layers ?? []).find((l) => l.id === id)?.props as { data?: Record<string, unknown>[] })?.data ??
  [];

describe("lodging pins", () => {
  const lodging = (stays: { status: string; checkIn: string; checkOut: string }[]) =>
    ({
      id: "l1",
      name: "Hotel",
      type: "hotel",
      lat: 50,
      lon: 8,
      visited: true,
      stayCount: 0,
      nights: 0,
      amenities: [],
      stays,
    }) as unknown as Lodging;
  it("flags a house with only a future stay as planned-only", () => {
    const [d] = dataOf(
      buildLodgingPins([
        lodging([{ status: "confirmed", checkIn: "2099-09-01", checkOut: "2099-09-05" }]),
      ]),
      "lodging-pins"
    );
    expect(d).toMatchObject({ plannedOnly: true, plannedStays: 1 });
  });
  it("keeps a mixed house solid and counts both", () => {
    const [d] = dataOf(
      buildLodgingPins([
        lodging([
          { status: "confirmed", checkIn: "2020-01-01", checkOut: "2020-01-05" },
          { status: "confirmed", checkIn: "2099-09-01", checkOut: "2099-09-05" },
        ]),
      ]),
      "lodging-pins"
    );
    expect(d).toMatchObject({ plannedOnly: false, plannedStays: 1 });
  });
  it("draws no pin for a house whose only stay was cancelled", () => {
    expect(
      buildLodgingPins([
        lodging([{ status: "cancelled", checkIn: "2099-09-01", checkOut: "2099-09-05" }]),
      ])
    ).toBeNull();
  });
});

describe("place pins", () => {
  const place = (over: Partial<Place>) =>
    ({
      id: "p1",
      name: "P",
      category: "restaurant",
      lat: 50,
      lon: 8,
      visited: true,
      visitCount: 0,
      plannedVisitCount: 0,
      ...over,
    }) as Place;
  it("flags a logbook place with only planned visits, not a mixed one or a wishlist one", () => {
    const layers = buildPlacePins(
      [
        place({ id: "a", plannedVisitCount: 1 }),
        place({ id: "b", visitCount: 2, plannedVisitCount: 1 }),
        place({ id: "c", visited: false, plannedVisitCount: 1 }),
      ],
      1,
      8,
      {}
    ) as Layer[];
    const by = Object.fromEntries(
      dataOf(layers, "place-pins").map((d) => [d.placeId, d.plannedOnly])
    );
    expect(by).toEqual({ a: true, b: false, c: false });
  });
});

describe("cruise ports", () => {
  const port = {
    id: 1,
    name: "Kiel",
    city: "Kiel",
    country: "DE",
    unlocode: "DEKEL",
    lat: 54.3,
    lon: 10.1,
    timezone: null,
    region: null,
    isUserAdded: false,
  };
  const cruise = (status: string) =>
    ({
      id: "c1",
      status,
      startDate: null,
      endDate: null,
      departurePort: null,
      arrivalPort: null,
      ship: null,
      shipNameOverride: null,
      stops: [
        {
          id: "s1",
          portId: 1,
          port,
          dayNumber: 1,
          isAtSea: false,
          arrivalTime: null,
          departureTime: null,
        },
      ],
    }) as unknown as Cruise;
  it("marks the port of a scheduled cruise planned-only", () => {
    const [d] = dataOf(createCruisePortsLayer([cruise("scheduled")]), "cruise-ports");
    expect(d).toMatchObject({ plannedOnly: true, plannedVisits: 1, visits: 0 });
  });
  it("draws a sailed port solid and a cancelled cruise's port not at all", () => {
    const [d] = dataOf(createCruisePortsLayer([cruise("completed")]), "cruise-ports");
    expect(d).toMatchObject({ plannedOnly: false, visits: 1 });
    expect(createCruisePortsLayer([cruise("cancelled")])).toBeNull();
  });
  it("the globe's port dot carries the same split", () => {
    const [g] = buildPortPoints([cruise("scheduled")], new Map(), {
      mode: "off",
      current: null,
      filterStart: null,
      filterEnd: null,
    } as never);
    expect([g.flownCount, g.plannedCount]).toEqual([0, 1]);
    expect(
      buildPortPoints([cruise("cancelled")], new Map(), {
        mode: "off",
        current: null,
        filterStart: null,
        filterEnd: null,
      } as never)
    ).toHaveLength(0);
  });
});

describe("rail stations", () => {
  it("flags planned-only stations, keeps a station a ridden train touches solid, drops cancelled", () => {
    const stations = buildRailStations([
      makeRailJourney({ id: "a", status: "scheduled" }),
      makeRailJourney({
        id: "b",
        status: "cancelled",
        depStationName: "X",
        depLon: 1,
        depLat: 1,
        arrLon: 2,
        arrLat: 2,
      }),
    ]);
    expect(stations.map((s) => s.plannedOnly)).toEqual([true, true]);
    expect(stations).toHaveLength(2);
    const mixed = buildRailStations([
      makeRailJourney({ id: "a", status: "scheduled" }),
      makeRailJourney({ id: "c", status: "completed" }),
    ]);
    expect(mixed.every((s) => !s.plannedOnly)).toBe(true);
    expect(buildRailPaths([makeRailJourney({ status: "cancelled" })])).toHaveLength(0);
  });
});

describe("bus and ferry terminals", () => {
  const ride = (status: string) => ({
    id: "r",
    status,
    depLat: 1,
    depLon: 1,
    arrLat: 2,
    arrLon: 2,
    geometry: null,
  });
  it("flags planned-only terminals and drops cancelled rides", () => {
    expect(terminalPoints([ride("scheduled")]).every((p) => p.plannedOnly)).toBe(true);
    expect(
      terminalPoints([ride("scheduled"), ride("completed")]).every((p) => !p.plannedOnly)
    ).toBe(true);
    expect(terminalPoints([ride("cancelled")])).toHaveLength(0);
    expect(busPaths([ride("cancelled")])).toHaveLength(0);
  });
});

describe("rental points", () => {
  const rental = (status: string): RentalMapSource => ({
    id: "r1",
    provider: "P",
    pickupStationName: "A",
    returnStationName: "A",
    pickupLat: 50,
    pickupLon: 8,
    returnLat: 50,
    returnLon: 8,
    oneWay: false,
    routeId: null,
    status: status as RentalMapSource["status"],
  });
  it("flags a booked rental planned-only and draws a cancelled one nowhere", () => {
    expect(buildRentalPoints([rental("scheduled")]).map((p) => p.plannedOnly)).toEqual([true]);
    expect(buildRentalPoints([rental("completed")]).map((p) => p.plannedOnly)).toEqual([false]);
    expect(buildRentalPoints([rental("cancelled")])).toHaveLength(0);
    expect(buildRentalLinks([{ ...rental("cancelled"), oneWay: true }])).toHaveLength(0);
  });
});
