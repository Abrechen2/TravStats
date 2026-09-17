import {
  PHOTO_SCAN_MIN_PHOTOS,
  mostVisitedIata,
  placeHunches,
  rankReadings,
  stayHunches,
  tripHunches,
  whereItWas,
  type FlightEndpoints,
  type LocatedCluster,
  type PlaceWithVisits,
} from "../photoScan";

/**
 * The Foto-Spürhund's rule (forgejo#94) as a truth table. The Companion holds
 * the same rule; the owner settled the two copies on its version (2026-09-17),
 * so these cases are the Companion's behaviour, stated on the server.
 */
const DAY = 86_400_000;
const MAY_1 = Date.UTC(2024, 4, 1, 9);

const MUC = { lat: 48.35, lon: 11.79 };
const CAI = { lat: 30.12, lon: 31.41 };
const ASWAN = { lat: 24.09, lon: 32.9 };
const LISBON = { lat: 38.72, lon: -9.14 };

/** Munich is home: flown most, departures and arrivals counted. */
const FLIGHTS: FlightEndpoints[] = [
  {
    depIata: "MUC",
    depLat: MUC.lat,
    depLon: MUC.lon,
    arrIata: "CAI",
    arrLat: CAI.lat,
    arrLon: CAI.lon,
  },
  {
    depIata: "CAI",
    depLat: CAI.lat,
    depLon: CAI.lon,
    arrIata: "MUC",
    arrLat: MUC.lat,
    arrLon: MUC.lon,
  },
  {
    depIata: "MUC",
    depLat: MUC.lat,
    depLon: MUC.lon,
    arrIata: "LIS",
    arrLat: LISBON.lat,
    arrLon: LISBON.lon,
  },
];

const burst = (
  samples: { lat: number; lon: number }[],
  days = 0,
  startMs = MAY_1
): LocatedCluster => ({
  startMs,
  endMs: startMs + days * DAY,
  nights: days,
  photoIds: ["a", "b", "c", "d"],
  lat: samples[samples.length - 1].lat,
  lon: samples[samples.length - 1].lon,
  samples,
});

const place = (overrides: Partial<PlaceWithVisits> = {}): PlaceWithVisits => ({
  id: "cafe",
  name: "Café Norte",
  ...LISBON,
  visits: [],
  ...overrides,
});

describe("photoScan", () => {
  it("takes four photos for a journey — the owner's decision, not six", () => {
    expect(PHOTO_SCAN_MIN_PHOTOS).toBe(4);
  });

  it("counts arrivals as well as departures towards home", () => {
    expect(mostVisitedIata(FLIGHTS)).toBe("MUC");
    expect(mostVisitedIata([{ arrIata: "LIS" }, { arrIata: "LIS" }, { depIata: "MUC" }])).toBe(
      "LIS"
    );
  });

  it("shows a burst at its coordinate farthest from home, not at the departure gate", () => {
    expect(whereItWas([MUC, CAI, ASWAN], MUC)).toEqual(ASWAN);
    expect(whereItWas([MUC, CAI], null)).toEqual(CAI);
    expect(whereItWas([], MUC)).toBeNull();
  });

  describe("the place reading", () => {
    it("offers an own place within 2 km, with the distance", () => {
      const [hunch] = placeHunches([burst([{ lat: 38.725, lon: -9.14 }])], [place()]);
      expect(hunch.placeId).toBe("cafe");
      expect(hunch.distanceKm).toBeGreaterThan(0);
      expect(hunch.distanceKm).toBeLessThan(2);
    });

    it("stays silent when a visit is already recorded on one of the days", () => {
      const visited = place({ visits: [{ visitedAt: new Date(MAY_1 + 3 * 3_600_000) }] });
      expect(placeHunches([burst([LISBON])], [visited])).toEqual([]);
    });

    it("does not offer a place farther than 2 km", () => {
      expect(placeHunches([burst([{ lat: 38.8, lon: -9.14 }])], [place()])).toEqual([]);
    });
  });

  describe("the trip reading", () => {
    it("finds a Rundreise by ANY coordinate near an own airport, and measures its spread without home", () => {
      const [hunch] = tripHunches([burst([MUC, ASWAN, CAI], 12)], FLIGHTS, "MUC");
      expect(hunch.iata).toBe("CAI");
      // Aswan to Cairo, not Munich to Aswan.
      expect(hunch.spreadKm).toBeGreaterThan(600);
      expect(hunch.spreadKm).toBeLessThan(800);
    });

    it("drops a burst that only ever reaches the home airport — everyday photos", () => {
      expect(tripHunches([burst([MUC, { lat: 48.14, lon: 11.58 }])], FLIGHTS, "MUC")).toEqual([]);
    });

    it("drops a burst with no own airport within 300 km", () => {
      expect(tripHunches([burst([{ lat: -33.87, lon: 151.21 }])], FLIGHTS, "MUC")).toEqual([]);
    });
  });

  describe("the stay reading", () => {
    it("names nights away by an own place nearby", () => {
      const [hunch] = stayHunches([burst([LISBON], 2)], [], [place()]);
      expect(hunch.placeName).toBe("Café Norte");
    });

    it("needs a night, a place to name it by, and no dated stay across it", () => {
      expect(stayHunches([burst([LISBON], 0)], [], [place()])).toEqual([]);
      expect(stayHunches([burst([{ lat: 10, lon: 10 }], 2)], [], [place()])).toEqual([]);
      const stay = { checkIn: new Date(MAY_1 + DAY), checkOut: new Date(MAY_1 + 2 * DAY) };
      expect(stayHunches([burst([LISBON], 2)], [stay], [place()])).toEqual([]);
    });
  });

  it("asks one question per burst, strongest reading first", () => {
    // Two nights at an own place near an own airport fit all three readings.
    const lisbon = burst([LISBON], 2);
    const readings = rankReadings([lisbon], FLIGHTS, [place()], []);
    expect(readings.place).toHaveLength(1);
    expect(readings.trip).toEqual([]);
    expect(readings.stay).toEqual([]);

    // Without the place, the same burst is a trip — and still not also a stay.
    const withoutPlace = rankReadings([lisbon], FLIGHTS, [], []);
    expect(withoutPlace.trip).toHaveLength(1);
    expect(withoutPlace.stay).toEqual([]);
  });
});
