import { describe, it, expect } from "@jest/globals";
import { _internals } from "../services/tripDetectionService";
import type { HomeAirportEntry } from "../utils/homeAirport";

const {
  groupByPnr,
  dropCancelledDuplicates,
  spanDays,
  findHomeLoops,
  findContinuityClusters,
  chainCoherentSort,
} = _internals;

interface TestFlight {
  id: string;
  bookingReference: string | null;
  departureTime: Date | null;
  depIata: string | null;
  arrIata: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

const f = (overrides: Partial<TestFlight> & Pick<TestFlight, "id">): TestFlight => ({
  id: overrides.id,
  bookingReference: null,
  departureTime: null,
  depIata: null,
  arrIata: null,
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
  ...overrides,
});

describe("tripDetectionService heuristics", () => {
  describe("PNR clustering with 30-day span cap", () => {
    it("groups flights sharing a bookingReference", () => {
      const flights = [
        f({ id: "a", bookingReference: "ABC123" }),
        f({ id: "b", bookingReference: "ABC123" }),
        f({ id: "c", bookingReference: "XYZ789" }),
      ];
      const groups = groupByPnr(flights);
      expect(groups.get("ABC123")?.length).toBe(2);
      expect(groups.get("XYZ789")?.length).toBe(1);
    });

    it("computes span correctly for cap evaluation", () => {
      const flights = [
        f({ id: "a", departureTime: new Date("2024-01-01T00:00:00Z") }),
        f({ id: "b", departureTime: new Date("2024-02-15T00:00:00Z") }),
      ];
      // Jan 1 to Feb 15 ≈ 45 days → above 30-day cap
      expect(spanDays(flights)).toBeGreaterThan(30);
    });

    it("WITTKE-style frequent-flyer-id span exceeds 30 days", () => {
      // Reproduces the actual finding from the user's xlsx import:
      // 'WITTKE' on 10 unrelated flights spread across a year.
      const flights = [
        f({ id: "1", bookingReference: "WITTKE", departureTime: new Date("2024-03-07T00:00:00Z") }),
        f({ id: "2", bookingReference: "WITTKE", departureTime: new Date("2024-12-09T00:00:00Z") }),
      ];
      const group = groupByPnr(flights).get("WITTKE")!;
      expect(spanDays(group)).toBeGreaterThan(30);
    });
  });

  describe("Cancelled-duplicate suppression", () => {
    it("drops a second row with same (depIata, depDate)", () => {
      const flights = [
        f({ id: "a", depIata: "MUC", departureTime: new Date("2024-04-01T08:00:00Z") }),
        f({ id: "b", depIata: "MUC", departureTime: new Date("2024-04-01T15:00:00Z") }), // rebooked
        f({ id: "c", depIata: "FRA", departureTime: new Date("2024-04-01T10:00:00Z") }),
      ];
      const dedup = dropCancelledDuplicates(flights);
      expect(dedup.length).toBe(2);
      expect(dedup.map((x) => x.id).sort()).toEqual(["a", "c"]);
    });
  });

  describe("Home-loop detection", () => {
    const history: HomeAirportEntry[] = [
      { iata: "MUC", fromDate: "2010-01-01", toDate: null },
    ];

    it("groups a MUC → … → MUC sequence into one loop", () => {
      const flights = [
        f({ id: "1", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-04-01T00:00:00Z") }),
        f({ id: "2", depIata: "FRA", arrIata: "JFK", departureTime: new Date("2024-04-01T12:00:00Z") }),
        f({ id: "3", depIata: "JFK", arrIata: "MUC", departureTime: new Date("2024-04-15T00:00:00Z") }),
      ];
      const loops = findHomeLoops(flights, history);
      expect(loops.length).toBe(1);
      expect(loops[0].length).toBe(3);
    });

    it("skips a sequence that does not start at home", () => {
      const flights = [
        f({ id: "1", depIata: "FRA", arrIata: "JFK", departureTime: new Date("2024-04-01T00:00:00Z") }),
      ];
      expect(findHomeLoops(flights, history).length).toBe(0);
    });

    it("returns empty when home history is missing", () => {
      const flights = [
        f({ id: "1", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-04-01T00:00:00Z") }),
      ];
      expect(findHomeLoops(flights, null).length).toBe(0);
    });
  });

  describe("Continuity sliding window", () => {
    it("groups consecutive flights with matching IATA hops within 7 days", () => {
      const flights = [
        f({ id: "a", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-05-01T00:00:00Z"),
            depLat: 48.354, depLon: 11.786, arrLat: 50.033, arrLon: 8.570 }),
        f({ id: "b", depIata: "FRA", arrIata: "JFK", departureTime: new Date("2024-05-01T05:00:00Z"),
            depLat: 50.033, depLon: 8.570, arrLat: 40.640, arrLon: -73.779 }),
      ];
      const clusters = findContinuityClusters(flights);
      expect(clusters.length).toBe(1);
      expect(clusters[0].length).toBe(2);
    });

    it("breaks the cluster when ground gap exceeds 7 days", () => {
      const flights = [
        f({ id: "a", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-05-01T00:00:00Z"),
            arrLat: 50.033, arrLon: 8.570 }),
        f({ id: "b", depIata: "FRA", arrIata: "JFK", departureTime: new Date("2024-05-15T00:00:00Z"),
            depLat: 50.033, depLon: 8.570 }),
      ];
      expect(findContinuityClusters(flights).length).toBe(2);
    });

    it("allows open-jaw within 200 km (LHR → CDG via train)", () => {
      // LHR → CDG straight-line is ~344 km — too far. Use SXF (Berlin) → BER
      // (also Berlin) at ~25 km as a realistic open-jaw test.
      const flights = [
        f({ id: "a", depIata: "MUC", arrIata: "SXF", departureTime: new Date("2024-05-01T00:00:00Z"),
            arrLat: 52.380, arrLon: 13.522 }),
        f({ id: "b", depIata: "BER", arrIata: "MUC", departureTime: new Date("2024-05-03T00:00:00Z"),
            depLat: 52.366, depLon: 13.503 }),
      ];
      expect(findContinuityClusters(flights).length).toBe(1);
    });
  });

  describe("Chain-coherent same-day sort (Norbert RAK regression, issue #104)", () => {
    // DB sorts findMany() results by departureTime asc. For DATE_ONLY
    // round-trips entered manually, both endpoints get default 10:00 / 12:00
    // UTC stamps that don't reflect within-day chain order. Norberts
    // 2009-09-21 return-day has RAK→MAD (dep 12:00) ordered AFTER MAD→MUC
    // (dep 10:00) by raw timestamp, breaking the home-loop walk and
    // orphaning the return leg. chainCoherentSort re-sorts same-day
    // flights via Kahn's topo sort using arr→dep matches as chain edges.

    it("re-orders RAK→MAD before MAD→MUC on the same calendar day", () => {
      const flights = [
        f({ id: "anchor", depIata: "MAD", arrIata: "MUC", departureTime: new Date("2009-09-21T10:00:00Z") }),
        f({ id: "return", depIata: "RAK", arrIata: "MAD", departureTime: new Date("2009-09-21T12:00:00Z") }),
      ];
      const sorted = chainCoherentSort(flights);
      expect(sorted.map((x) => x.id)).toEqual(["return", "anchor"]);
    });

    it("preserves multi-day order while re-sorting within each day", () => {
      const flights = [
        f({ id: "out1", depIata: "MUC", arrIata: "MAD", departureTime: new Date("2009-09-14T10:00:00Z") }),
        f({ id: "out2", depIata: "MAD", arrIata: "RAK", departureTime: new Date("2009-09-14T10:00:00Z") }),
        f({ id: "anchor", depIata: "MAD", arrIata: "MUC", departureTime: new Date("2009-09-21T10:00:00Z") }),
        f({ id: "return", depIata: "RAK", arrIata: "MAD", departureTime: new Date("2009-09-21T12:00:00Z") }),
      ];
      const sorted = chainCoherentSort(flights);
      // Day 1 chain: MUC→MAD→RAK ; Day 2 chain: RAK→MAD→MUC
      expect(sorted.map((x) => x.id)).toEqual(["out1", "out2", "return", "anchor"]);
    });

    it("leaves single-flight days unchanged", () => {
      const flights = [
        f({ id: "solo", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-04-01T08:00:00Z") }),
      ];
      expect(chainCoherentSort(flights).map((x) => x.id)).toEqual(["solo"]);
    });

    it("keeps two unrelated chains on the same day stable by depTime", () => {
      // Two independent connections on the same day (rare but possible:
      // e.g. dropping a friend off then taking a separate trip later).
      const flights = [
        f({ id: "ax", depIata: "MUC", arrIata: "FRA", departureTime: new Date("2024-04-01T08:00:00Z") }),
        f({ id: "ay", depIata: "FRA", arrIata: "JFK", departureTime: new Date("2024-04-01T11:00:00Z") }),
        f({ id: "bx", depIata: "HEL", arrIata: "ARN", departureTime: new Date("2024-04-01T14:00:00Z") }),
        f({ id: "by", depIata: "ARN", arrIata: "OSL", departureTime: new Date("2024-04-01T17:00:00Z") }),
      ];
      const sorted = chainCoherentSort(flights);
      expect(sorted.map((x) => x.id)).toEqual(["ax", "ay", "bx", "by"]);
    });

    it("findHomeLoops captures all 4 legs of MUC↺RAK after chain-coherent sort (issue #104)", () => {
      const history: HomeAirportEntry[] = [
        { iata: "MUC", fromDate: "2009-01-01", toDate: null },
      ];
      // Order as findMany returns it (departureTime asc):
      const fromDb = [
        f({ id: "out1", depIata: "MUC", arrIata: "MAD", departureTime: new Date("2009-09-14T10:00:00Z") }),
        f({ id: "out2", depIata: "MAD", arrIata: "RAK", departureTime: new Date("2009-09-14T10:00:00Z") }),
        f({ id: "anchor", depIata: "MAD", arrIata: "MUC", departureTime: new Date("2009-09-21T10:00:00Z") }),
        f({ id: "return", depIata: "RAK", arrIata: "MAD", departureTime: new Date("2009-09-21T12:00:00Z") }),
      ];
      const loops = findHomeLoops(chainCoherentSort(fromDb), history);
      expect(loops.length).toBe(1);
      expect(loops[0].length).toBe(4);
      // The previously-orphaned return leg is now part of the loop.
      expect(loops[0].map((x) => x.id)).toContain("return");
    });
  });
});
