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

  it("repairs a 3-flight same-day chain (DATE_ONLY interleaved with timed)", () => {
    // Real-world: a same-day Hawaii hop A→B→C→D where the timestamps put
    // them in the wrong order because of the 12:00 placeholder. Pairwise
    // swap can't surface the head; we need a full chain rebuild.
    const flights = [
      f({
        id: "C-D",
        depIata: "C",
        arrIata: "D",
        departureTime: "2024-01-12T08:00:00Z", // earliest by clock — but middle leg
      }),
      f({
        id: "A-B",
        depIata: "A",
        arrIata: "B",
        departureTime: "2024-01-12T12:00:00Z",
      }),
      f({
        id: "B-C",
        depIata: "B",
        arrIata: "C",
        departureTime: "2024-01-12T20:00:00Z",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["A-B", "B-C", "C-D"]);
  });

  it("keeps timestamp order for two disjoint chains on the same day", () => {
    // No unique head (both A and X have depIatas not used as anyone's
    // arrival) → fall back to timestamp order rather than re-shuffle.
    const flights = [
      f({
        id: "x",
        depIata: "A",
        arrIata: "B",
        departureTime: "2024-01-12T08:00:00Z",
      }),
      f({
        id: "y",
        depIata: "X",
        arrIata: "Y",
        departureTime: "2024-01-12T20:00:00Z",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["x", "y"]);
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

  it("windows by the LOCAL day, so a placeholder and a timed flight of one Auckland day are repaired together (forgejo#273)", () => {
    // AKL→ZQN is date-only for 15 January: the form's 12:00 local is 23:00Z on
    // the 14th. WLG→AKL leaves at 14:00 local on the 15th (01:00Z). By UTC date
    // they are two days and the timestamp order (AKL→ZQN first) stood.
    const flights = [
      f({
        id: "akl-zqn",
        depIata: "AKL",
        arrIata: "ZQN",
        departureTime: "2026-01-14T23:00:00Z",
        depTimezone: "Pacific/Auckland",
        depTimeSemantics: "DATE_ONLY",
      }),
      f({
        id: "wlg-akl",
        depIata: "WLG",
        arrIata: "AKL",
        departureTime: "2026-01-15T01:00:00Z",
        depTimezone: "Pacific/Auckland",
        depTimeSemantics: "UTC",
      }),
    ];
    expect(sortFlightsByLegOrder(flights).map((x) => x.id)).toEqual(["wlg-akl", "akl-zqn"]);
  });
});
