import { describe, it, expect } from "vitest";
import { sortCruises } from "./sortCruises";
import type { Cruise, CruiseStop, Port } from "../../types";

// Minimal Port stand-in — only `id` is read by countUniquePorts.
function port(id: number): Port {
  return {
    id,
    name: `Port ${id}`,
    city: null,
    country: null,
    unlocode: null,
    lat: 0,
    lon: 0,
    timezone: null,
    region: null,
    isUserAdded: false,
  };
}

// Minimal port-call stop stand-in — only `isAtSea`/`port` are read by countUniquePorts.
function stopAt(dayNumber: number, portId: number): CruiseStop {
  return {
    id: `stop-${dayNumber}-${portId}`,
    cruiseId: "x",
    portId,
    port: port(portId),
    dayNumber,
    date: null,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
  };
}

// Minimal Cruise stand-in — sortCruises only reads the fields below.
function c(over: Partial<Cruise>): Cruise {
  return {
    id: "x",
    userId: "user123",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: null,
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status: "scheduled",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(over as object),
  } as Cruise;
}

// A: 1 unique port, B: 3 unique ports, C: 0 unique ports (no stops).
const A = c({
  id: "a",
  startDate: "2024-01-01",
  price: 100,
  shipNameOverride: "Zebra",
  cruiseLine: "MSC",
  status: "flown",
  stops: [stopAt(1, 1)],
});
const B = c({
  id: "b",
  startDate: "2025-06-01",
  price: 300,
  shipNameOverride: "Alpha",
  cruiseLine: "AIDA",
  status: "scheduled",
  stops: [stopAt(1, 2), stopAt(2, 3), stopAt(3, 4)],
});
const C = c({
  id: "c",
  startDate: null,
  price: null,
  shipNameOverride: null,
  cruiseLine: null,
  status: "cancelled",
  stops: [],
});
const D = c({
  id: "d",
  startDate: "2026-07-10",
  price: 200,
  shipNameOverride: "Delta",
  cruiseLine: "TUI",
  status: "in_progress",
  stops: [],
});

describe("sortCruises", () => {
  it("sorts by date asc, nulls last", () => {
    expect(sortCruises([A, B, C], "date", "asc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by date desc (newest first), nulls last", () => {
    expect(sortCruises([A, B, C], "date", "desc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by price asc, nulls last", () => {
    expect(sortCruises([A, B, C], "price", "asc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by price desc, nulls last", () => {
    expect(sortCruises([A, B, C], "price", "desc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by ship name asc (case-insensitive), blanks last", () => {
    expect(sortCruises([A, B, C], "ship", "asc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by ship name desc, blanks last", () => {
    expect(sortCruises([A, B, C], "ship", "desc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by cruise line asc (case-insensitive), blanks last", () => {
    expect(sortCruises([A, B, C], "line", "asc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by cruise line desc, blanks last", () => {
    expect(sortCruises([A, B, C], "line", "desc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by unique port count asc", () => {
    expect(sortCruises([A, B, C], "ports", "asc").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by unique port count desc", () => {
    expect(sortCruises([A, B, C], "ports", "desc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by status rank (scheduled first when asc)", () => {
    expect(sortCruises([A, B, C], "status", "asc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by status rank desc (cancelled first when desc)", () => {
    expect(sortCruises([A, B, C], "status", "desc").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("ranks in_progress between scheduled and flown (#status-from-dates)", () => {
    expect(sortCruises([A, B, C, D], "status", "asc").map((x) => x.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [A, B, C];
    sortCruises(input, "date", "asc");
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
