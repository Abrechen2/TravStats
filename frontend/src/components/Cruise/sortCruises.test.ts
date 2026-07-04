import { describe, it, expect } from "vitest";
import { sortCruises } from "./sortCruises";
import type { Cruise } from "../../types";

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

const A = c({
  id: "a",
  startDate: "2024-01-01",
  price: 100,
  shipNameOverride: "Zebra",
  cruiseLine: "MSC",
  status: "flown",
});
const B = c({
  id: "b",
  startDate: "2025-06-01",
  price: 300,
  shipNameOverride: "Alpha",
  cruiseLine: "AIDA",
  status: "scheduled",
});
const C = c({
  id: "c",
  startDate: null,
  price: null,
  shipNameOverride: null,
  cruiseLine: null,
  status: "cancelled",
});

describe("sortCruises", () => {
  it("sorts by date desc (newest first), nulls last", () => {
    expect(sortCruises([A, B, C], "date", "desc").map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("sorts by date asc, nulls last", () => {
    expect(sortCruises([A, B, C], "date", "asc").map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("sorts by price asc, nulls last", () => {
    expect(sortCruises([A, B, C], "price", "asc").map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("sorts by ship name asc (case-insensitive), blanks last", () => {
    expect(sortCruises([A, B, C], "ship", "asc").map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("sorts by status rank (scheduled first when asc)", () => {
    expect(sortCruises([A, B, C], "status", "asc").map((x) => x.id)).toEqual([
      "b",
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
