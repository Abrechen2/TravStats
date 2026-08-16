import { describe, it, expect } from "@jest/globals";

import {
  buildAirportCoordinateIndex,
  resolveAirportCoordinate,
} from "../airportCoordinates";

/**
 * A flight row keeps its OWN copy of the departure/arrival coordinates,
 * written by whichever source created it — an e-mail parser, a boarding-pass
 * scan, a live provider update or the manual form. Nothing ever reconciled
 * those copies against the airport catalogue, so the same airport ends up at
 * slightly different points depending on which flight you look at.
 *
 * Measured on a real 347-flight account: 242 of 878 airport references
 * disagreed with the catalogue, across 30 airports, the worst by 1.6 km.
 *
 * The map made that visible because it derives the airport DOT from the
 * first-seen flight per airport and each ARC from the first-seen flight per
 * route — two different "first seen" on two different coordinates, so the arc
 * misses the dot. Resolving both through the catalogue is what keeps them
 * on top of each other.
 */
const zurich = {
  iata: "ZRH",
  icao: "LSZH",
  lat: 47.458056,
  lon: 8.548056,
  isClosed: false,
};

const munichActive = {
  iata: "MUC",
  icao: "EDDM",
  lat: 48.3538,
  lon: 11.7861,
  isClosed: false,
};

// The catalogue deliberately keeps closed predecessors under the code people
// remember them by — see airportCacheCollision.test.ts. A closed row must
// never supply the coordinate for a live flight.
const munichRiemClosed = {
  iata: "MUC",
  icao: "EDDM",
  lat: 48.1333,
  lon: 11.6833,
  isClosed: true,
};

describe("resolveAirportCoordinate", () => {
  it("prefers the catalogue over the coordinate stored on the flight", () => {
    const index = buildAirportCoordinateIndex([zurich]);

    // The divergent value actually found in production data.
    expect(resolveAirportCoordinate(index, "ZRH", "LSZH", 47.4647, 8.5492)).toEqual([
      8.548056, 47.458056,
    ]);
  });

  it("returns one and the same point for every flight touching that airport", () => {
    const index = buildAirportCoordinateIndex([zurich]);

    const fromFlownFlight = resolveAirportCoordinate(index, "ZRH", "LSZH", 47.4647, 8.5492);
    const fromScheduledFlight = resolveAirportCoordinate(
      index,
      "ZRH",
      "LSZH",
      47.458056,
      8.548056,
    );

    expect(fromFlownFlight).toEqual(fromScheduledFlight);
  });

  it("falls back to the flight's own coordinate when the airport is unknown", () => {
    const index = buildAirportCoordinateIndex([zurich]);

    // A user-added airfield that never made it into the catalogue still has to
    // render — dropping it would hide the flight entirely.
    expect(resolveAirportCoordinate(index, "XXX", "YYYY", 12.5, 34.75)).toEqual([34.75, 12.5]);
  });

  it("resolves by ICAO when the airport has no IATA code", () => {
    const index = buildAirportCoordinateIndex([{ ...zurich, iata: null }]);

    expect(resolveAirportCoordinate(index, null, "LSZH", 47.4647, 8.5492)).toEqual([
      8.548056, 47.458056,
    ]);
  });

  it("takes the active airport when a closed predecessor shares the code", () => {
    const index = buildAirportCoordinateIndex([munichRiemClosed, munichActive]);

    expect(resolveAirportCoordinate(index, "MUC", "EDDM", 48.3538, 11.7861)).toEqual([
      11.7861, 48.3538,
    ]);
  });

  it("ignores catalogue rows without coordinates", () => {
    const index = buildAirportCoordinateIndex([
      { iata: "ZRH", icao: "LSZH", lat: null, lon: null, isClosed: false },
    ]);

    expect(resolveAirportCoordinate(index, "ZRH", "LSZH", 47.4647, 8.5492)).toEqual([
      8.5492, 47.4647,
    ]);
  });
});
