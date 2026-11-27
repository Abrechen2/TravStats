import { describe, expect, it } from "@jest/globals";

import {
  betterSide,
  groupConflicts,
  groupOf,
  pairIsAutomatic,
  settlePlan,
} from "../linkResolve";

/**
 * UAT 2026-11-27 (B1): "Meine übernehmen" pushed the father's STRAIGHT ferry lines over the owner's
 * drawn ones. A decision never lets an empty, straight or less precise value overwrite a filled,
 * drawn or more precise one, in either direction.
 */
const drawn = {
  geometry: { type: "LineString", coordinates: Array.from({ length: 184 }, (_, i) => [i, i]) },
  geometrySource: "manual",
  manualScope: "pair",
  distanceKm: 61,
};
const straight = {
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
  geometrySource: "straight",
  manualScope: null,
  distanceKm: 55,
};
const GEOMETRY = ["geometry", "geometrySource", "manualScope", "distanceKm"];

describe("the link's quality rule (UAT 2026-11-27, B1)", () => {
  it("'mine' never pushes a straight line over the other side's drawn one", () => {
    const plan = settlePlan("ferry", GEOMETRY, straight, drawn, "mine");
    expect(plan.mine).toEqual([]);
    expect(plan.theirs.sort()).toEqual([...GEOMETRY].sort());
  });

  it("'theirs' never takes the other side's straight line over a drawn one here", () => {
    const plan = settlePlan("ferry", GEOMETRY, drawn, straight, "theirs");
    expect(plan.theirs).toEqual([]);
    expect(plan.mine.sort()).toEqual([...GEOMETRY].sort());
  });

  it("ranks drawn over routed over straight over none", () => {
    const g = groupOf("ferry", "geometry");
    const routed = {
      geometry: { coordinates: [[0, 0], [0.5, 0.4], [1, 1]] },
      geometrySource: "sea_route",
    };
    expect(betterSide(g, drawn, routed)).toBe("here");
    expect(betterSide(g, routed, straight)).toBe("here");
    expect(betterSide(g, straight, { geometry: null, geometrySource: "straight" })).toBe("here");
  });

  it("a time of day beats a date-only value whichever way the decision points", () => {
    const precise = { departureTime: new Date("2025-05-01T08:30:00Z"), depPrecision: "minute" };
    const dayOnly = { departureTime: new Date("2025-05-01T00:00:00Z"), depPrecision: "day" };
    const keys = ["departureTime", "depPrecision"];
    expect(settlePlan("rail", keys, dayOnly, precise, "mine").theirs.sort()).toEqual(keys.sort());
    expect(settlePlan("rail", keys, precise, dayOnly, "theirs").mine.sort()).toEqual(keys.sort());
  });

  it("an empty value never overwrites a filled one", () => {
    expect(settlePlan("flight", ["gate"], { gate: null }, { gate: "B12" }, "mine")).toEqual({
      mine: [],
      theirs: ["gate"],
    });
    expect(settlePlan("flight", ["gate"], { gate: "B12" }, { gate: "" }, "theirs")).toEqual({
      mine: ["gate"],
      theirs: [],
    });
  });

  it("a tie follows the decision; 'best' keeps both", () => {
    const a = { gate: "B12" };
    const b = { gate: "C3" };
    expect(settlePlan("flight", ["gate"], a, b, "mine").mine).toEqual(["gate"]);
    expect(settlePlan("flight", ["gate"], a, b, "theirs").theirs).toEqual(["gate"]);
    expect(settlePlan("flight", ["gate"], a, b, "best")).toEqual({ mine: [], theirs: [] });
  });

  it("a per-field choice in the dry run is taken as given (M2)", () => {
    const plan = settlePlan("ferry", ["operator", ...GEOMETRY], { ...straight, operator: "A" }, {
      ...drawn,
      operator: "B",
    }, "both", { operator: "theirs" });
    expect(plan).toEqual({ mine: [], theirs: ["operator"] });
  });

  it("derived values are no choice, and a pair differing only there links by rule", () => {
    const here = { ...drawn, distanceKm: 60 };
    const { groups, recomputed } = groupConflicts("ferry", ["distanceKm"], here, drawn);
    expect(groups).toEqual([]);
    expect(recomputed).toEqual(["distanceKm"]);
    expect(pairIsAutomatic("rental", ["distanceKm"], { distanceKm: 1 }, { distanceKm: 2 })).toBe(
      true
    );
  });

  it("two different filled values of equal quality need the person", () => {
    expect(pairIsAutomatic("flight", ["gate"], { gate: "B12" }, { gate: "C3" })).toBe(false);
    expect(pairIsAutomatic("ferry", GEOMETRY, straight, drawn)).toBe(true);
  });

  it("a field the other server did not send is set apart, not a difference", () => {
    const { groups, uncarried } = groupConflicts("ferry", ["vesselName"], { vesselName: "X" }, {});
    expect(groups).toEqual([]);
    expect(uncarried).toEqual(["vesselName"]);
  });
});
