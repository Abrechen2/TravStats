/**
 * The network derivation.
 *
 * The pairing rule is the one thing here that CANNOT be seen on a real account
 * unless somebody flew both directions, so it is written down: a return trip is
 * ONE route with a count of two. An account of one-way flights would pass every
 * assertion a directed implementation makes, which is exactly how a globe ends
 * up disagreeing with the top-routes list beside it.
 */

import { buildFlightNetwork, type NetworkFlight } from "../network";

const AIRPORTS: Record<string, { iata: string; icao: string; lat: number; lon: number }> = {
  FRA: { iata: "FRA", icao: "EDDF", lat: 50.0379, lon: 8.5622 },
  WAW: { iata: "WAW", icao: "EPWA", lat: 52.1657, lon: 20.9671 },
  JFK: { iata: "JFK", icao: "KJFK", lat: 40.6398, lon: -73.7789 },
};

/** The catalogue as the route handler hands it over: keyed by IATA and ICAO. */
const catalogue = new Map(
  Object.values(AIRPORTS).flatMap((a) => [
    [a.iata, { iata: a.iata, lat: a.lat, lon: a.lon }] as const,
    [a.icao, { iata: a.iata, lat: a.lat, lon: a.lon }] as const,
  ])
);

interface FlightOpts {
  from: keyof typeof AIRPORTS;
  to: keyof typeof AIRPORTS;
  status?: string;
  /** Emulate an import that never resolved coordinates: the schema stores 0/0. */
  originless?: boolean;
  /** Emulate an old row that carries an ICAO but no IATA. */
  icaoOnly?: boolean;
}

function flight(opts: FlightOpts): NetworkFlight {
  const dep = AIRPORTS[opts.from];
  const arr = AIRPORTS[opts.to];
  return {
    depIata: opts.icaoOnly ? null : dep.iata,
    depIcao: dep.icao,
    depLat: opts.originless ? 0 : dep.lat,
    depLon: opts.originless ? 0 : dep.lon,
    arrIata: arr.iata,
    arrIcao: arr.icao,
    arrLat: arr.lat,
    arrLon: arr.lon,
    status: opts.status ?? "flown",
  };
}

describe("buildFlightNetwork", () => {
  it("counts a return trip as ONE route flown twice, not two directions", () => {
    const network = buildFlightNetwork(
      [flight({ from: "FRA", to: "WAW" }), flight({ from: "WAW", to: "FRA" })],
      catalogue
    );

    expect(network.routes).toHaveLength(1);
    expect(network.routes[0]).toMatchObject({ aIata: "FRA", bIata: "WAW", count: 2 });
    // The pair is sorted, so the key does not depend on which way it was flown
    // first — a client can join it against a route list without normalising.
    expect(network.routes[0].aIata < network.routes[0].bIata).toBe(true);
  });

  it("keys the pair the same way whichever direction is seen first", () => {
    const outbound = buildFlightNetwork([flight({ from: "WAW", to: "FRA" })], catalogue);
    expect(outbound.routes[0]).toMatchObject({ aIata: "FRA", bIata: "WAW", count: 1 });
  });

  it("lists each airport once, with its visits from both ends added up", () => {
    const network = buildFlightNetwork(
      [
        flight({ from: "FRA", to: "WAW" }),
        flight({ from: "WAW", to: "FRA" }),
        flight({ from: "FRA", to: "JFK" }),
      ],
      catalogue
    );

    expect(network.airports.map((a) => a.iata).sort()).toEqual(["FRA", "JFK", "WAW"]);
    const fra = network.airports.find((a) => a.iata === "FRA");
    expect(fra?.visits).toBe(3);
    expect(fra?.lat).toBeCloseTo(AIRPORTS.FRA.lat, 4);
    expect(fra?.lon).toBeCloseTo(AIRPORTS.FRA.lon, 4);
    // Busiest first, so a client can draw the important nodes last.
    expect(network.airports[0].iata).toBe("FRA");
  });

  it("measures the distance between the two nodes it returns", () => {
    const network = buildFlightNetwork([flight({ from: "FRA", to: "WAW" })], catalogue);
    // FRA-WAW is roughly 900 km; the point is that the number describes the
    // very coordinates in the same payload, not a per-flight re-measurement.
    expect(network.routes[0].distanceKm).toBeGreaterThan(850);
    expect(network.routes[0].distanceKm).toBeLessThan(950);
  });

  it("counts only flown and historical flights", () => {
    const network = buildFlightNetwork(
      [
        flight({ from: "FRA", to: "WAW", status: "scheduled" }),
        flight({ from: "FRA", to: "JFK", status: "cancelled" }),
        flight({ from: "FRA", to: "JFK", status: "historical" }),
      ],
      catalogue
    );

    expect(network.routes).toEqual([
      expect.objectContaining({ aIata: "FRA", bIata: "JFK", count: 1 }),
    ]);
    expect(network.airports.map((a) => a.iata).sort()).toEqual(["FRA", "JFK"]);
  });

  it("folds an ICAO-only row onto the same node as its IATA siblings", () => {
    const network = buildFlightNetwork(
      [flight({ from: "FRA", to: "WAW" }), flight({ from: "FRA", to: "WAW", icaoOnly: true })],
      catalogue
    );

    expect(network.airports.map((a) => a.iata).sort()).toEqual(["FRA", "WAW"]);
    expect(network.airports.find((a) => a.iata === "FRA")?.visits).toBe(2);
    expect(network.routes).toHaveLength(1);
    expect(network.routes[0].count).toBe(2);
  });

  it("recovers a coordinate-less row from the catalogue rather than dropping it", () => {
    const network = buildFlightNetwork(
      [flight({ from: "FRA", to: "WAW", originless: true })],
      catalogue
    );

    const fra = network.airports.find((a) => a.iata === "FRA");
    expect(fra?.lat).toBeCloseTo(AIRPORTS.FRA.lat, 4);
    expect(network.routes).toHaveLength(1);
  });

  it("omits an airport nothing can position, and every route touching it", () => {
    // No catalogue: 0/0 stays 0/0, and Null Island is not where the traveller
    // went. The node is left out entirely — never emitted with null coordinates.
    const network = buildFlightNetwork(
      [flight({ from: "FRA", to: "WAW", originless: true }), flight({ from: "WAW", to: "JFK" })],
      new Map()
    );

    expect(network.airports.map((a) => a.iata).sort()).toEqual(["JFK", "WAW"]);
    expect(network.airports.every((a) => a.lat !== 0 || a.lon !== 0)).toBe(true);
    expect(network.routes).toEqual([
      expect.objectContaining({ aIata: "JFK", bIata: "WAW", count: 1 }),
    ]);
  });

  it("does not draw a flight that returns to its departure airport", () => {
    const network = buildFlightNetwork([flight({ from: "FRA", to: "FRA" })], catalogue);

    expect(network.routes).toEqual([]);
    // It still happened, so the airport is still visited — twice, the way
    // airportStats counts the two ends of any flight.
    expect(network.airports).toEqual([expect.objectContaining({ iata: "FRA", visits: 2 })]);
  });

  it("returns empty arrays for an account with nothing flown", () => {
    expect(buildFlightNetwork([], catalogue)).toEqual({ airports: [], routes: [] });
  });
});
