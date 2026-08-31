import { buildTravelRecords, type RecordFlightInput } from "../records";

/**
 * Forgejo #41, and the principle in #42: every counting rule belongs to the
 * server. These seven records existed only in the Companion
 * (`records-adapters.ts`), and its edge cases were decided against real data.
 *
 * What is pinned here is those edge cases, not the arithmetic. Getting one of
 * them subtly different is how one account ends up with two answers to "what
 * was my longest flight" — the drift #42 was filed about. Every case below
 * corresponds to a decision in the Companion's adapter.
 */
const flight = (over: Partial<RecordFlightInput> = {}): RecordFlightInput => ({
  id: "f1",
  flightNumber: "LH117",
  depIata: "MUC",
  arrIata: "FRA",
  depLat: 48.35,
  depLon: 11.78,
  arrLat: 50.03,
  arrLon: 8.57,
  departureTime: new Date("2024-04-12T08:00:00Z"),
  durationMinutes: 60,
  delayMinutes: null,
  routeDistance: null,
  status: "flown",
  ...over,
});

const byId = (records: ReturnType<typeof buildTravelRecords>, id: string) =>
  records.find((r) => r.id === id);

describe("travel records", () => {
  it("counts only flights that happened", () => {
    const records = buildTravelRecords([
      flight({ id: "booked", status: "scheduled", routeDistance: 99999 }),
    ]);
    expect(records).toEqual([]);
  });

  describe("longest flight", () => {
    it("falls back to the great circle when no distance is stored", () => {
      // Most real rows carry no stored distance. Judging only over the few that
      // do misses the actual longest leg.
      const records = buildTravelRecords([flight({ routeDistance: null })]);
      expect(byId(records, "longest-flight")?.value).toBeGreaterThan(250);
    });

    it("prefers the stored distance over the chord", () => {
      const records = buildTravelRecords([flight({ routeDistance: 5000 })]);
      expect(byId(records, "longest-flight")?.value).toBe(5000);
    });

    it("abstains when a row has neither a distance nor two ends", () => {
      const records = buildTravelRecords([
        flight({ routeDistance: null, depLat: null, arrLat: null }),
      ]);
      expect(byId(records, "longest-flight")).toBeUndefined();
    });

    it("gives a tie to the more recent flight", () => {
      const records = buildTravelRecords([
        flight({ id: "old", routeDistance: 5000, departureTime: new Date("2020-01-01T00:00:00Z") }),
        flight({ id: "new", routeDistance: 5000, departureTime: new Date("2024-01-01T00:00:00Z") }),
      ]);
      expect(byId(records, "longest-flight")?.flightId).toBe("new");
    });
  });

  describe("shortest flight", () => {
    it("ignores a zero-length leg that would otherwise win forever", () => {
      const records = buildTravelRecords([
        flight({ id: "zero", routeDistance: 0, depLat: null, arrLat: null }),
        flight({ id: "real", routeDistance: 300 }),
      ]);
      expect(byId(records, "shortest-flight")?.flightId).toBe("real");
    });
  });

  describe("longest aloft", () => {
    it("abstains for a placeholder row with no real duration", () => {
      // A DATE_ONLY row comes back from the enrichment with a null duration.
      // Reporting it as a flight that took no time would be worse than silence.
      const records = buildTravelRecords([flight({ durationMinutes: null })]);
      expect(byId(records, "longest-aloft")).toBeUndefined();
    });

    it("is a different record from the longest by distance", () => {
      // A headwind does not add kilometres.
      const records = buildTravelRecords([
        flight({ id: "far", routeDistance: 9000, durationMinutes: 100 }),
        flight({ id: "slow", routeDistance: 500, durationMinutes: 400 }),
      ]);
      expect(byId(records, "longest-flight")?.flightId).toBe("far");
      expect(byId(records, "longest-aloft")?.flightId).toBe("slow");
    });
  });

  describe("biggest delay", () => {
    it("does not treat a missing delay as punctual", () => {
      // "No delay recorded" and "on time" are different facts.
      const records = buildTravelRecords([flight({ delayMinutes: null })]);
      expect(byId(records, "biggest-delay")).toBeUndefined();
    });

    it("ignores an early arrival", () => {
      const records = buildTravelRecords([flight({ delayMinutes: -20 })]);
      expect(byId(records, "biggest-delay")).toBeUndefined();
    });
  });

  describe("northernmost", () => {
    it("takes either end of any flight, and names the airport not the flight", () => {
      const records = buildTravelRecords([
        flight({ depLat: 10, depIata: "AAA", arrLat: 63.46, arrIata: "KEF" }),
      ]);
      const rec = byId(records, "northernmost");
      expect(rec?.airportIata).toBe("KEF");
      expect(rec?.flightId).toBeUndefined();
      // Unrounded: how many decimals a latitude deserves is the client's call.
      expect(rec?.value).toBeCloseTo(63.46, 2);
    });

    it("ignores a row the server never geocoded", () => {
      // An IATA code is not a position.
      const records = buildTravelRecords([
        flight({ depLat: null, depLon: null, arrLat: null, arrLon: null }),
      ]);
      expect(byId(records, "northernmost")).toBeUndefined();
    });
  });

  describe("busiest day and streak", () => {
    const day = (d: string, id: string) =>
      flight({ id, departureTime: new Date(`${d}T08:00:00Z`) });

    it("counts legs per calendar day and lists them in order", () => {
      const records = buildTravelRecords([
        day("2024-04-12", "a"),
        flight({ id: "b", departureTime: new Date("2024-04-12T14:00:00Z"), arrIata: "JFK" }),
        day("2024-04-14", "c"),
      ]);
      const rec = byId(records, "busiest-day");
      expect(rec?.value).toBe(2);
      expect(rec?.date).toBe("2024-04-12");
      expect(rec?.legs).toEqual(["MUC", "FRA", "JFK"]);
    });

    it("measures a run of consecutive days", () => {
      const records = buildTravelRecords([
        day("2024-04-12", "a"),
        day("2024-04-13", "b"),
        day("2024-04-14", "c"),
        day("2024-05-01", "d"),
      ]);
      const rec = byId(records, "longest-streak");
      expect(rec?.value).toBe(3);
      expect(rec?.startDate).toBe("2024-04-12");
      expect(rec?.endDate).toBe("2024-04-14");
    });

    it("gives a tied streak to the more recent one", () => {
      const records = buildTravelRecords([
        day("2024-01-01", "a"),
        day("2024-01-02", "b"),
        day("2024-06-01", "c"),
        day("2024-06-02", "d"),
      ]);
      expect(byId(records, "longest-streak")?.startDate).toBe("2024-06-01");
    });
  });

  it("returns a short list rather than a grid of dashes for a young account", () => {
    // Every record abstains except the ones a single dateless, distance-less
    // flight can still answer.
    const records = buildTravelRecords([
      flight({
        routeDistance: null,
        depLat: null,
        depLon: null,
        arrLat: null,
        arrLon: null,
        departureTime: null,
        durationMinutes: null,
        delayMinutes: null,
      }),
    ]);
    expect(records).toEqual([]);
  });

  it("carries numbers and units, never a formatted string", () => {
    // A German decimal comma in a JSON body is a bug waiting for an English
    // reader; formatting belongs to whoever is drawing the screen.
    const records = buildTravelRecords([flight({ routeDistance: 5000 })]);
    for (const record of records) {
      expect(typeof record.value).toBe("number");
      expect(typeof record.unit).toBe("string");
    }
  });
});
