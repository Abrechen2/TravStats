import { describe, it, expect } from "vitest";
import { assessStayPlausibility, STAY_NEAR_LEG_KM } from "../stayPlausibility";

const TOKYO = { lat: 35.69, lon: 139.69 };
const NARITA = { lat: 35.77, lon: 140.39 }; // ~65 km from central Tokyo
const JFK = { lat: 40.64, lon: -73.78 };

describe("assessStayPlausibility (#6)", () => {
  it("is plausible when a leg lands near the hotel (airport far from city still counts)", () => {
    const r = assessStayPlausibility(TOKYO, [NARITA]);
    expect(r.plausible).toBe(true);
    expect(r.nearestKm).toBeGreaterThan(40);
    expect(r.nearestKm).toBeLessThan(STAY_NEAR_LEG_KM);
  });

  it("flags a hotel with no leg anywhere near it", () => {
    const r = assessStayPlausibility(TOKYO, [JFK]);
    expect(r.plausible).toBe(false);
    expect(r.nearestKm).toBeGreaterThan(STAY_NEAR_LEG_KM);
  });

  it("takes the NEAREST of several legs", () => {
    const r = assessStayPlausibility(TOKYO, [JFK, NARITA]);
    expect(r.plausible).toBe(true);
  });

  // A hotel-only trip, or a stay whose lodging has no coordinates, must never
  // warn — there is simply nothing to judge against.
  it("does not judge when the trip has no located legs", () => {
    expect(assessStayPlausibility(TOKYO, [])).toEqual({ nearestKm: null, plausible: true });
    expect(assessStayPlausibility(TOKYO, [{ lat: null, lon: null }])).toEqual({
      nearestKm: null,
      plausible: true,
    });
  });

  it("does not judge when the hotel has no coordinates", () => {
    expect(assessStayPlausibility({ lat: null, lon: 5 }, [JFK])).toEqual({
      nearestKm: null,
      plausible: true,
    });
  });
});
