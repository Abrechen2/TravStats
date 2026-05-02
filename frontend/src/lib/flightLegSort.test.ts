import { describe, it, expect } from "vitest";
import { sortFlightsByLegOrder } from "./flightLegSort";
import type { Flight } from "../types";

const f = (overrides: Partial<Flight> & Pick<Flight, "id">): Flight =>
  ({
    departureTime: null,
    arrivalTime: null,
    depIata: null,
    arrIata: null,
    status: "flown",
    ...overrides,
  }) as Flight;

describe("sortFlightsByLegOrder", () => {
  it("preserves correct chronological order for timed flights", () => {
    const flights = [
      f({ id: "b", departureTime: "2024-04-01T15:00:00Z" }),
      f({ id: "a", departureTime: "2024-04-01T10:00:00Z" }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("repairs reversed chain on the same day (DATE_ONLY → timed)", () => {
    // Real-world case: HNL→SFO is DATE_ONLY (12:00 placeholder), OGG→HNL is
    // 20:58 UTC. Pure timestamp sort puts HNL→SFO first. The chain check
    // says it should be reversed — OGG→HNL must come before HNL→SFO.
    const flights = [
      f({
        id: "hnl-sfo",
        depIata: "HNL",
        arrIata: "SFO",
        departureTime: "2024-01-12T12:00:00Z",
      }),
      f({
        id: "ogg-hnl",
        depIata: "OGG",
        arrIata: "HNL",
        departureTime: "2024-01-12T20:58:00Z",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["ogg-hnl", "hnl-sfo"]);
  });

  it("does not swap when neither order chains", () => {
    const flights = [
      f({
        id: "x",
        depIata: "MUC",
        arrIata: "SFO",
        departureTime: "2024-01-12T08:00:00Z",
      }),
      f({
        id: "y",
        depIata: "JFK",
        arrIata: "LHR",
        departureTime: "2024-01-12T20:00:00Z",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["x", "y"]);
  });

  it("does not swap when current order already chains", () => {
    const flights = [
      f({
        id: "a",
        depIata: "MUC",
        arrIata: "FRA",
        departureTime: "2024-01-12T08:00:00Z",
      }),
      f({
        id: "b",
        depIata: "FRA",
        arrIata: "JFK",
        departureTime: "2024-01-12T20:00:00Z",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("only repairs same-day pairs (different days stay timestamp-sorted)", () => {
    const flights = [
      f({
        id: "early-but-different-day",
        depIata: "HNL",
        arrIata: "SFO",
        departureTime: "2024-01-12T12:00:00Z",
      }),
      f({
        id: "later-day",
        depIata: "OGG",
        arrIata: "HNL",
        departureTime: "2024-01-13T08:00:00Z",
      }),
    ];
    // Different days: keep timestamp order even though chain reversed.
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual([
      "early-but-different-day",
      "later-day",
    ]);
  });
});
