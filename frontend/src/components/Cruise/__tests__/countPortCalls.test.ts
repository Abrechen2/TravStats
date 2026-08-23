/**
 * Port CALLS, not places — and not raw stop rows either.
 *
 * The delete dialog got this wrong on its first day in the browser: it said
 * "7 Hafenanläufe" for a cruise whose own row said "5 Häfen", because it
 * counted `stops.length` and swept a sea day in with them. Three numbers for
 * one cruise on one screen is exactly what this module's header warns about.
 */
import { describe, it, expect } from "vitest";
import { countPortCalls, countUniquePorts } from "../cruisePorts";
import type { Cruise, CruiseStop } from "../../../types";

function stop(over: Partial<CruiseStop>): CruiseStop {
  return {
    id: "s",
    cruiseId: "c",
    dayNumber: 1,
    isAtSea: false,
    portId: null,
    port: null,
    unresolvedPortName: null,
    ...over,
  } as CruiseStop;
}

function cruise(stops: CruiseStop[], extra: Partial<Cruise> = {}): Cruise {
  return { id: "c", stops, ...extra } as Cruise;
}

const kiel = { id: 1 } as NonNullable<CruiseStop["port"]>;
const oslo = { id: 2 } as NonNullable<CruiseStop["port"]>;

describe("countPortCalls", () => {
  it("counts every call, including a port visited twice", () => {
    // A round trip ties up at Kiel twice. Two calls, one place — the number
    // the delete dialog needs is the calls, because it counts what goes away.
    const c = cruise([
      stop({ id: "1", port: kiel, portId: 1 }),
      stop({ id: "2", port: oslo, portId: 2 }),
      stop({ id: "3", port: kiel, portId: 1 }),
    ]);
    expect(countPortCalls(c)).toBe(3);
    expect(countUniquePorts(c)).toBe(2);
  });

  it("does not count a sea day as a call", () => {
    const c = cruise([
      stop({ id: "1", port: kiel, portId: 1 }),
      stop({ id: "2", isAtSea: true }),
      stop({ id: "3", port: oslo, portId: 2 }),
    ]);
    expect(countPortCalls(c)).toBe(2);
  });

  it("counts an unresolved call — the ship still tied up there", () => {
    // The name simply did not match the catalogue. It is a real call, which
    // is why `countUniquePorts` (places) excludes it and this does not.
    const c = cruise([
      stop({ id: "1", port: kiel, portId: 1 }),
      stop({ id: "2", unresolvedPortName: "Puerto Desconocido" }),
    ]);
    expect(countPortCalls(c)).toBe(2);
    expect(countUniquePorts(c)).toBe(1);
  });

  it("is zero for a crossing with no stops at all", () => {
    expect(countPortCalls(cruise([]))).toBe(0);
    expect(countPortCalls(cruise([stop({ id: "1", isAtSea: true })]))).toBe(0);
  });
});
