import { describe, it, expect } from "vitest";
import {
  pinnedFromAirport,
  pinnedFromCruise,
  pinnedFromFlightSelection,
  pinnedFromSpecialFlight,
} from "../buildFlatPinned";
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

    const pinned = pinnedFromSpecialFlight(flight, "Rundflug");
    expect(pinned?.kind).toBe("specialFlight");
    if (pinned?.kind !== "specialFlight") throw new Error("expected a special-flight card");
    expect(pinned.data.routeLabel).toBe("INN");
    expect(pinned.data.typeLabel).toBe("Rundflug");
  });

  it("answers nothing for an ordinary flight", () => {
    expect(pinnedFromSpecialFlight({ id: "x" } as unknown as Flight, "—")).toBeNull();
  });
});
