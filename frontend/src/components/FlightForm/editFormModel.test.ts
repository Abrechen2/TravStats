import { describe, it, expect } from "vitest";
import { buildEditFormData, editFormGaps, editFormSnapshot } from "./editFormModel";
import { airportLocalInputs } from "./editModalDatetime";
import { stableSnapshot } from "../form/useDirtyGuard";
import type { Flight } from "../../types";

const flight = {
  id: "f1",
  airline: "LH",
  flightNumber: "LH1",
  depIata: "FRA",
  arrIata: "JFK",
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T18:30:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Flight;

const airports = { departure: null, arrival: null };
const t = (k: string): string => k;

/** forgejo#248 — opening a flight is not a change, whatever clock its inputs show. */
describe("editFormSnapshot", () => {
  it("reads the seed and the airport-local rendering of the stored times as untouched", () => {
    const seed = buildEditFormData(flight);
    const local = { ...seed, ...airportLocalInputs(flight, "Europe/Berlin", "America/New_York") };
    const stored = [seed, local];
    const base = stableSnapshot(editFormSnapshot(seed, stored, airports, {}));
    expect(stableSnapshot(editFormSnapshot(local, stored, airports, {}))).toBe(base);
    expect(
      stableSnapshot(editFormSnapshot({ ...local, departureTime: "13:15" }, stored, airports, {}))
    ).not.toBe(base);
  });
});

describe("editFormGaps", () => {
  it("names a cleared scheduled time, but never asks for an airport", () => {
    const data = { ...buildEditFormData(flight), arrivalTime: "" };
    expect(editFormGaps(data, t)).toEqual([
      { field: "editArrivalTime", label: "flights:form.missing.arrivalTime" },
    ]);
  });
});
