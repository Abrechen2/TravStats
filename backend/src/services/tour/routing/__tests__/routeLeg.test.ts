import { describe, it, expect, jest } from "@jest/globals";

import { routeLegGeometry } from "../routeLeg";
import { RouteProvider, RouteRequest, RouteResult } from "../types";
import { haversineKm } from "../../../../shared/geo/haversine";

/**
 * Task 5 (Phase 3 tour routing providers): routes one leg, and decides what
 * happens when routing does not — or should not — work. Every kilometre the
 * tour-routes feature reports passes through this module, so each fallback
 * path below is asserted strictly rather than loosely ("truthy waypoints").
 */

// Two real points a few km apart (Berlin Alexanderplatz -> Tiergarten-ish).
const FROM = { lat: 52.517037, lon: 13.38886 };
const TO = { lat: 52.529407, lon: 13.397634 };
const CHORD_KM = haversineKm(FROM, TO);

function makeProvider(routeImpl: (req: RouteRequest) => Promise<RouteResult | null>): {
  provider: RouteProvider;
  route: jest.Mock<(req: RouteRequest) => Promise<RouteResult | null>>;
} {
  const route = jest.fn(routeImpl);
  return { provider: { id: "graphhopper", route }, route };
}

describe("routeLegGeometry", () => {
  it("case 1: a provider that answers is trusted verbatim — its own distance, not a recomputed one", async () => {
    const providerResult: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.390006, 52.520008],
        [13.397634, 52.529407],
      ],
      // Deliberately NOT equal to the chord — a real road distance is
      // always somewhat longer than the straight line. If the module ever
      // started recomputing this from the polyline instead of trusting the
      // provider, this exact value would catch it.
      distanceKm: 1.9,
      drivingMinutes: 4,
    };
    const { provider, route } = makeProvider(async () => providerResult);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result).toEqual({
      waypoints: providerResult.waypoints,
      distanceKm: 1.9,
      source: "routed",
      confidence: "high",
      drivingMinutes: 4,
    });
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith({ from: FROM, to: TO, mode: "road" });
  });

  it("case 2: a provider returning null falls back to the chord — never a fabricated number, never a throw", async () => {
    const { provider, route } = makeProvider(async () => null);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(result.waypoints).toBeNull();
    expect(result.drivingMinutes).toBeNull();
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("case 3: provider === null uses the same straight fallback, without needing a provider at all", async () => {
    const result = await routeLegGeometry(null, { from: FROM, to: TO, mode: "road" });

    expect(result).toEqual({
      waypoints: null,
      distanceKm: CHORD_KM,
      source: "straight",
      confidence: "low",
      drivingMinutes: null,
    });
  });

  it("case 4: a non-routable mode (ferry) falls back to straight WITHOUT calling the provider", async () => {
    const { provider, route } = makeProvider(async () => {
      throw new Error("must never be called for a ferry leg");
    });

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "ferry" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
    expect(route).not.toHaveBeenCalled();
  });

  it("case 4b: a non-routable mode (rail) also falls back to straight WITHOUT calling the provider", async () => {
    const { provider, route } = makeProvider(async () => {
      throw new Error("must never be called for a rail leg");
    });

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "rail" });

    expect(result.source).toBe("straight");
    expect(route).not.toHaveBeenCalled();
  });

  it("case 5: a route whose ends are far from the requested endpoints is rejected, not trusted", async () => {
    // A plausible-looking line, but anchored ~changed-city away from FROM/TO —
    // e.g. the provider snapped to a road network in the wrong place, or the
    // caller's lon/lat got swapped upstream. This is the "answers about a
    // different place" failure mode: worse than not answering at all,
    // because it looks like a real route.
    const wrongPlaceResult: RouteResult = {
      waypoints: [
        [13.38886 + 1, 52.517037 + 1],
        [13.397634 + 1, 52.529407 + 1],
      ],
      distanceKm: 1.9,
      drivingMinutes: 4,
    };
    const { provider, route } = makeProvider(async () => wrongPlaceResult);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(result.waypoints).toBeNull();
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
    // The provider WAS asked (mode is routable) — it just answered about the
    // wrong place, so its answer is discarded rather than propagated.
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("case 5b: only the tail is off-anchor — still rejected (both ends must hold, not just one)", async () => {
    const tailOffResult: RouteResult = {
      waypoints: [
        [13.38886, 52.517037], // correct head
        [13.397634 + 5, 52.529407 + 5], // tail far from TO
      ],
      distanceKm: 700,
      drivingMinutes: 500,
    };
    const { provider } = makeProvider(async () => tailOffResult);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("case 5c: only the head is off-anchor — still rejected (a mutant dropping half of the `||` must not survive)", async () => {
    // The mirror of 5b: tail is correct, head is far from FROM. Without this
    // case, a mutant that drops the `headOff > tolerance` half of the `||`
    // check would still pass the whole suite, because case 5 (both ends
    // off) and 5b (tail off) never exercise the head-only branch.
    const headOffResult: RouteResult = {
      waypoints: [
        [13.38886 + 5, 52.517037 + 5], // head far from FROM
        [13.397634, 52.529407], // correct tail
      ],
      distanceKm: 700,
      drivingMinutes: 500,
    };
    const { provider } = makeProvider(async () => headOffResult);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("rejects a route with fewer than two waypoints — cannot verify anchors on a degenerate line", async () => {
    // An EMPTY waypoints array, not a single point sitting on one of the
    // stops: a single-point fixture placed at FROM would already fail the
    // tail-anchor check on its own (line[0] === line[last] === FROM, which
    // is nowhere near TO), so deleting the length guard entirely would
    // still make that fixture pass via the anchor check — it would not
    // isolate the length guard. An empty array isolates it: without the
    // guard, `line[0]` is `undefined` and the anchor code below would
    // throw, so this fixture can only be rejected by the length check.
    const degenerate: RouteResult = {
      waypoints: [],
      distanceKm: 0,
      drivingMinutes: 0,
    };
    const { provider } = makeProvider(async () => degenerate);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("rejects a route whose distance is a NaN — a comparison against NaN silently loses, so this must be checked explicitly", async () => {
    const nanDistance: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.397634, 52.529407],
      ],
      distanceKm: NaN,
      drivingMinutes: 4,
    };
    const { provider } = makeProvider(async () => nanDistance);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(Number.isFinite(result.distanceKm)).toBe(true);
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("rejects a route with a NaN waypoint coordinate — NaN > tolerance and NaN > chord*ratio are both false", async () => {
    // Both the anchor check (`headOff > ANCHOR_TOLERANCE_KM`) and the
    // sanity check (`distanceKm > chordKm * SANITY_RATIO`) are comparisons
    // that a NaN silently loses, so a line carrying one would otherwise
    // sail through both and be persisted as `source: "routed"` — after
    // which every distance sum this leg enters becomes NaN. This must be
    // rejected on the value itself, not on a comparison against it.
    const nanWaypoint: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [NaN, 52.529407],
      ],
      distanceKm: 1.9,
      drivingMinutes: 4,
    };
    const { provider } = makeProvider(async () => nanWaypoint);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(Number.isFinite(result.distanceKm)).toBe(true);
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("rejects an implausible distance (50x the chord) even when both anchors are correct", async () => {
    // Anchors line up with FROM/TO, but the reported distance is wildly out
    // of proportion to the straight-line distance — the kind of number a
    // broken provider response (wrong units, a self-intersecting polyline,
    // an accidental world-circumnavigation) can produce while still passing
    // the anchor check. See the file-level comment on SANITY_RATIO for why
    // this bound exists and how it was chosen.
    const implausible: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.397634, 52.529407],
      ],
      distanceKm: CHORD_KM * 50,
      drivingMinutes: 6000,
    };
    const { provider } = makeProvider(async () => implausible);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });

  it("accepts a real-world detour ratio (e.g. a fjord/mountain road at ~6x the chord)", async () => {
    // The sanity bound must not punish legitimate geography: a road can
    // reasonably be several times longer than the chord for two points near
    // a lake, fjord, or mountain pass. Only the truly implausible case above
    // is rejected.
    const plausibleDetour: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.397634, 52.529407],
      ],
      distanceKm: CHORD_KM * 6,
      drivingMinutes: 25,
    };
    const { provider } = makeProvider(async () => plausibleDetour);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("routed");
    expect(result.confidence).toBe("high");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM * 6, 6);
  });

  it("accepts a large ratio on a very short leg (a ~100m one-way system) — the sub-0.5km gate protects this, it does not hide it", async () => {
    // Two points ~100m apart, but the road distance is ~3km (a real
    // one-way system, a closed bridge, a pedestrian-only shortcut). That is
    // a 30x ratio — well past SANITY_RATIO (20) — yet this must be
    // ACCEPTED, because MIN_CHORD_FOR_SANITY_KM (0.5 km) exists precisely
    // so a tiny chord's naturally huge ratio is not mistaken for a broken
    // provider response.
    const shortFrom = { lat: 52.517037, lon: 13.38886 };
    const shortTo = { lat: 52.517937, lon: 13.38886 }; // ~0.1 km due north
    const shortChordKm = haversineKm(shortFrom, shortTo);
    expect(shortChordKm).toBeLessThan(0.5);

    const oneWaySystem: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.38886, 52.517937],
      ],
      distanceKm: 3, // ~30x the chord
      drivingMinutes: 6,
    };
    const { provider } = makeProvider(async () => oneWaySystem);

    const result = await routeLegGeometry(provider, {
      from: shortFrom,
      to: shortTo,
      mode: "road",
    });

    expect(result.source).toBe("routed");
    expect(result.confidence).toBe("high");
    expect(result.distanceKm).toBe(3);
  });

  it("boundary: exactly 20x the chord is still accepted (the check is strictly-greater-than)", async () => {
    // Mirrors SANITY_RATIO in routeLeg.ts (not exported, so duplicated here
    // the same way ANCHOR_TOLERANCE_KM is duplicated across the two
    // call-site modules — see that constant's own comment for why).
    const exactlyAtBound: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.397634, 52.529407],
      ],
      distanceKm: CHORD_KM * 20,
      drivingMinutes: 100,
    };
    const { provider } = makeProvider(async () => exactlyAtBound);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("routed");
    expect(result.confidence).toBe("high");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM * 20, 6);
  });

  it("boundary: just over 20x the chord is rejected", async () => {
    const justOverBound: RouteResult = {
      waypoints: [
        [13.38886, 52.517037],
        [13.397634, 52.529407],
      ],
      distanceKm: CHORD_KM * 20 + 0.001,
      drivingMinutes: 100,
    };
    const { provider } = makeProvider(async () => justOverBound);

    const result = await routeLegGeometry(provider, { from: FROM, to: TO, mode: "road" });

    expect(result.source).toBe("straight");
    expect(result.confidence).toBe("low");
    expect(result.distanceKm).toBeCloseTo(CHORD_KM, 6);
  });
});
