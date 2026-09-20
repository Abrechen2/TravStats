import { describe, it, expect } from "vitest";
import {
  pinnedFromAirport,
  pinnedFromCruise,
  pinnedFromFlightSelection,
  pinnedFromSpecialFlight,
} from "../buildFlatPinned";
import { geoFromFlightRow } from "../buildFlatPinned";
import type { Flight, GeoJSONFeature } from "../../../../types";
import type { Cruise } from "../../../../types/cruise";

/**
 * The flat map's half of the owner's 2026-09-20 ruling. Its selection is a
 * list of `Flight` ids in a Zustand store, and the card wants a route or a
 * marker — this is where the one becomes the other, so this is where the
 * "route = the airport pair" rule is actually decided.
 */

function leg(
  id: string,
  dep: { iata: string; lon: number; lat: number },
  arr: { iata: string; lon: number; lat: number }
): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [dep.lon, dep.lat],
        [arr.lon, arr.lat],
      ],
    },
    properties: {
      id,
      airline: "Delta Air Lines",
      flightNumber: "DL1",
      departureAirport: { iata: dep.iata, name: `${dep.iata} Airport`, country: "NO" },
      arrivalAirport: { iata: arr.iata, name: `${arr.iata} Airport`, country: "ES" },
      departureTime: "2021-06-05T08:00:00Z",
      arrivalTime: "2021-06-05T12:00:00Z",
      status: "flown",
      distance: 1000,
    },
  } as unknown as GeoJSONFeature;
}

const TOS = { iata: "TOS", lon: 18.9, lat: 69.7 };
const AGP = { iata: "AGP", lon: -4.5, lat: 36.7 };
const OSL = { iata: "OSL", lon: 11.1, lat: 60.2 };

const ACCENT: [number, number, number] = [240, 169, 71];

describe("pinnedFromFlightSelection", () => {
  it("makes ONE route card out of several flights on the same airport pair", () => {
    const geo = [leg("a", TOS, AGP), leg("b", AGP, TOS)];
    const pinned = pinnedFromFlightSelection(["a", "b"], geo, ACCENT);

    expect(pinned?.kind).toBe("arc");
    if (pinned?.kind !== "arc") throw new Error("expected a route card");
    expect(pinned.data.departure.iata).toBe("TOS");
    expect(pinned.data.arrival.iata).toBe("AGP");
    expect(pinned.data.flightIds).toEqual(["a", "b"]);
    expect(pinned.data.count).toBe(2);
  });

  it("makes a TRIP card when the selection spans more than one airport pair", () => {
    const geo = [leg("a", TOS, AGP), leg("b", AGP, OSL)];
    const pinned = pinnedFromFlightSelection(["a", "b"], geo, ACCENT);

    expect(pinned?.kind).toBe("trip");
    if (pinned?.kind !== "trip") throw new Error("expected a trip card");
    expect(pinned.data.flightIds).toEqual(["a", "b"]);
  });

  it("anchors a route between its endpoints, not at one of them", () => {
    const pinned = pinnedFromFlightSelection(["a"], [leg("a", TOS, AGP)], ACCENT);
    expect(pinned?.anchorLngLat[0]).toBeCloseTo((18.9 + -4.5) / 2, 5);
    expect(pinned?.anchorLngLat[1]).toBeCloseTo((69.7 + 36.7) / 2, 5);
  });

  it("answers nothing when no selected id is in the rendered set", () => {
    expect(pinnedFromFlightSelection(["ghost"], [leg("a", TOS, AGP)], ACCENT)).toBeNull();
  });
});

describe("pinnedFromAirport", () => {
  it("counts every flight touching the airport and takes its identity from /geo", () => {
    const geo = [leg("a", TOS, AGP), leg("b", AGP, TOS), leg("c", OSL, AGP)];
    const pinned = pinnedFromAirport("TOS", TOS.lon, TOS.lat, geo);

    expect(pinned.kind).toBe("airport");
    if (pinned.kind !== "airport") throw new Error("expected an airport card");
    expect(pinned.data.size).toBe(2);
    expect(pinned.data.name).toBe("TOS Airport");
    expect(pinned.anchorLngLat).toEqual([TOS.lon, TOS.lat]);
  });
});

describe("pinnedFromCruise", () => {
  const port = (id: number, name: string, lon: number, lat: number) => ({
    id,
    name,
    city: null,
    country: "IT",
    unlocode: null,
    lat,
    lon,
    timezone: null,
    region: null,
    isUserAdded: false,
  });

  it("anchors on the middle of the itinerary, not on the click point", () => {
    const cruise = {
      id: "c1",
      stops: [
        { port: port(1, "A", 0, 40), isAtSea: false },
        { port: port(2, "B", 20, 40), isAtSea: false },
      ],
      ship: { name: "AIDAnova" },
    } as unknown as Cruise;

    const pinned = pinnedFromCruise(cruise);
    expect(pinned.kind).toBe("cruise");
    expect(pinned.anchorLngLat).toEqual([10, 40]);
    if (pinned.kind !== "cruise") throw new Error("expected a cruise card");
    expect(pinned.data.cruiseLabel).toBe("AIDAnova");
  });
});

describe("pinnedFromSpecialFlight", () => {
  it("says the single airport for a loop type rather than a dep → arr that is a lie", () => {
    const flight = {
      id: "s1",
      specialType: "sightseeing",
      depIata: "INN",
      arrIata: "INN",
      depLon: 11.3,
      depLat: 47.2,
      arrLon: 11.3,
      arrLat: 47.2,
      departureTime: "2024-05-01T10:00:00Z",
    } as unknown as Flight;

    const pinned = pinnedFromSpecialFlight(flight);
    expect(pinned?.kind).toBe("specialFlight");
    if (pinned?.kind !== "specialFlight") throw new Error("expected a special-flight card");
    expect(pinned.data.routeLabel).toBe("INN");
    expect(pinned.data.specialType).toBe("sightseeing");
  });

  it("answers nothing for an ordinary flight", () => {
    expect(pinnedFromSpecialFlight({ id: "x" } as unknown as Flight)).toBeNull();
  });
});

describe("geoFromFlightRow — the Reise view has no /geo set at all", () => {
  /**
   * `AllTab`'s journey branch passes `flights={[]}`: it draws ONE trip through
   * `extraLayers` and lets the map render nothing of its own. The card built
   * its route, its stats and its flight list out of that empty array, so
   * selecting a flight row there produced no card and no camera move — while
   * the `MapTooltip` this card replaced read the selection store and never
   * touched /geo at all.
   */
  const row = {
    id: "f9",
    airline: "Delta Air Lines",
    flightNumber: "DL6287",
    aircraft: "B767-400ER",
    depIata: "TOS",
    depName: "Tromsø",
    depLon: 18.9,
    depLat: 69.7,
    arrIata: "AGP",
    arrName: "Málaga",
    arrLon: -4.5,
    arrLat: 36.7,
    departureTime: "2021-06-05T08:00:00Z",
    arrivalTime: "2021-06-05T12:00:00Z",
    status: "flown",
    routeDistance: 3931,
  } as unknown as Flight;

  it("carries the identity, the geometry and the distance the card needs", () => {
    const f = geoFromFlightRow(row);
    expect(f.properties.id).toBe("f9");
    expect(f.properties.departureAirport.iata).toBe("TOS");
    expect(f.properties.arrivalAirport.iata).toBe("AGP");
    expect(f.properties.distance).toBe(3931);
    expect(f.geometry.coordinates).toEqual([
      [18.9, 69.7],
      [-4.5, 36.7],
    ]);
  });

  it("estimates the distance when the row has none, rather than reporting zero", () => {
    const f = geoFromFlightRow({ ...row, routeDistance: undefined } as unknown as Flight);
    expect(f.properties.distance).toBeGreaterThan(3000);
  });

  it("lets the route card be built from the store alone", () => {
    const pinned = pinnedFromFlightSelection(["f9"], [geoFromFlightRow(row)], ACCENT);
    expect(pinned?.kind).toBe("arc");
    if (pinned?.kind !== "arc") throw new Error("expected a route card");
    expect(pinned.data.departure.iata).toBe("TOS");
  });
});

describe("the card anchors across the antimeridian", () => {
  const LAX = { iata: "LAX", lon: -118.4, lat: 33.9 };
  const NRT = { iata: "NRT", lon: 140.4, lat: 35.8 };
  const HNL = { iata: "HNL", lon: -157.9, lat: 21.3 };

  /**
   * `centreOf` averaged the raw min/max longitude, so a transpacific set
   * straddling ±180 came out on the OTHER side of the planet: LAX→NRT→HNL
   * anchored its trip card over central Europe, where nothing on the map is.
   * `midpoint` already had the wrap rule for a single leg; the trip and cruise
   * anchors did not.
   */
  it("anchors a transpacific trip over the Pacific, not over Europe", () => {
    const geo = [leg("a", LAX, NRT), leg("b", NRT, HNL)];
    const pinned = pinnedFromFlightSelection(["a", "b"], geo, ACCENT);
    expect(pinned?.kind).toBe("trip");
    // Somewhere in the Pacific: past the dateline either way, never near 0°.
    expect(Math.abs(pinned!.anchorLngLat[0])).toBeGreaterThan(120);
  });

  it("still centres an ordinary spread the obvious way", () => {
    const geo = [leg("a", { iata: "A", lon: 0, lat: 40 }, { iata: "B", lon: 20, lat: 50 })];
    const pinned = pinnedFromFlightSelection(["a"], geo, ACCENT);
    expect(pinned?.anchorLngLat[0]).toBeCloseTo(10, 5);
  });
});
