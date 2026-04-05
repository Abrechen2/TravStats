import { describe, it, expect } from "vitest";
import { groupFlights } from "../../utils/groupFlights";
import type { Flight } from "../../types";

function flight(
  id: string,
  depIata: string,
  arrIata: string,
  depTime: string,
  arrTime: string,
  depLat = 48.0,
  depLon = 11.0,
  arrLat = 52.0,
  arrLon = 13.0
): Flight {
  return {
    id,
    userId: "u1",
    airline: "LH",
    flightNumber: id,
    depIata,
    arrIata,
    depLat,
    depLon,
    arrLat,
    arrLon,
    departureTime: depTime,
    arrivalTime: arrTime,
    status: "flown",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("groupFlights", () => {
  it("returns single group for one flight", () => {
    const f = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const result = groupFlights([f]);
    expect(result).toEqual([{ type: "single", flight: f }]);
  });

  it("groups two connecting flights into multileg", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
    if (result[0].type === "multileg") {
      expect(result[0].flights).toHaveLength(2);
      expect(result[0].label).toBe("MUC → FRA → JFK");
    }
  });

  it("does NOT group flights with different connecting airport", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "LHR", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("single");
    expect(result[1].type).toBe("single");
  });

  it("does NOT group flights with gap > 12h", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T23:30:00Z", "2024-03-15T02:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(2);
  });

  it("groups a three-leg chain", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T08:00:00Z", "2024-03-14T09:00:00Z");
    const leg2 = flight("f2", "FRA", "LHR", "2024-03-14T11:00:00Z", "2024-03-14T11:45:00Z");
    const leg3 = flight("f3", "LHR", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2, leg3]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
    if (result[0].type === "multileg") {
      expect(result[0].flights).toHaveLength(3);
      expect(result[0].label).toBe("MUC → FRA → LHR → JFK");
    }
  });

  it("sorts by departure time before grouping", () => {
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const result = groupFlights([leg2, leg1]); // intentionally reversed
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
  });

  it("returns empty array for empty input", () => {
    expect(groupFlights([])).toEqual([]);
  });

  it("handles mixed: connecting pair plus unrelated flight", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const unrelated = flight("f3", "LHR", "CDG", "2024-03-15T09:00:00Z", "2024-03-15T10:30:00Z");
    const result = groupFlights([leg1, leg2, unrelated]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("multileg");
    expect(result[1].type).toBe("single");
    if (result[1].type === "single") {
      expect(result[1].flight.id).toBe("f3");
    }
  });

  it("groups flights at exactly 12h gap boundary", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    // exactly 12h after arrival = 23:00
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T23:00:00Z", "2024-03-15T02:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
  });

  it("does NOT group flights just over 12h gap", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    // 12h + 1 minute after arrival = 23:01
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T23:01:00Z", "2024-03-15T02:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(2);
  });
});
