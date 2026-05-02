import { describe, it, expect } from "vitest";
import { getFlightDuration } from "./flightDuration";
import type { Flight } from "../types";

const baseFlight = {
  id: "f1",
  userId: "u1",
  airline: "Lufthansa",
  flightNumber: "LH123",
  status: "flown" as const,
  createdAt: "2026-01-01T00:00:00Z",
  // MUC -> JFK coords
  depLat: 48.354, depLon: 11.786,
  arrLat: 40.640, arrLon: -73.779,
} satisfies Partial<Flight> as Flight;

describe("getFlightDuration", () => {
  it("returns the real wall-clock duration when semantics is UTC and times are present", () => {
    const flight: Flight = {
      ...baseFlight,
      departureTime: "2024-04-15T20:35:00Z",
      arrivalTime: "2024-04-16T05:25:00Z",
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
    };
    const d = getFlightDuration(flight);
    expect(d).toEqual({ minutes: 530, estimated: false });
  });

  it("falls back to a great-circle estimate when semantics is DATE_ONLY", () => {
    const flight: Flight = {
      ...baseFlight,
      // 12:00 UTC noon-placeholder collapsed to same instant
      departureTime: "2013-03-23T12:00:00Z",
      arrivalTime: "2013-03-23T12:00:00Z",
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
    };
    const d = getFlightDuration(flight);
    expect(d?.estimated).toBe(true);
    // MUC -> JFK is roughly 8h
    expect(d?.minutes).toBeGreaterThan(7 * 60);
    expect(d?.minutes).toBeLessThan(10 * 60);
  });

  it("estimates when arrival/departure are missing but coords are present", () => {
    const flight: Flight = {
      ...baseFlight,
      departureTime: null,
      arrivalTime: null,
      depTimeSemantics: "UNKNOWN",
      arrTimeSemantics: "UNKNOWN",
    };
    const d = getFlightDuration(flight);
    expect(d?.estimated).toBe(true);
    expect(d?.minutes).toBeGreaterThan(0);
  });

  it("guards against negative durations from corrupt rows by falling back to estimate", () => {
    const flight: Flight = {
      ...baseFlight,
      departureTime: "2024-04-15T05:00:00Z",
      arrivalTime: "2024-04-15T03:00:00Z", // arrival before departure
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
    };
    const d = getFlightDuration(flight);
    expect(d?.estimated).toBe(true);
  });
});
