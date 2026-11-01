import { describe, it, expect } from "vitest";
import { co2Kpis } from "../co2Kpis";
import type { Co2Estimate } from "../../types/co2";

const t = (key: string): string => key;
const base: Co2Estimate = {
  kg: 17.7,
  distanceKm: 500,
  factorKgPerKm: 0.03546,
  factor: "rail.rail",
  perVehicle: false,
  lowerBound: false,
  flightKg: 108,
  savedKg: 90.3,
};

describe("co2Kpis (forgejo#395)", () => {
  it("shows nothing for a ride that abstained instead of a zero", () => {
    expect(co2Kpis(null, t, "en")).toEqual([]);
    expect(co2Kpis(undefined, t, "en")).toEqual([]);
  });

  it("adds the saving against flying only when the ride was the cleaner choice", () => {
    expect(co2Kpis(base, t, "en").map((k) => k.key)).toEqual(["co2", "co2Saved"]);
    expect(co2Kpis({ ...base, savedKg: -3 }, t, "en").map((k) => k.key)).toEqual(["co2"]);
    expect(co2Kpis({ ...base, savedKg: null }, t, "en").map((k) => k.key)).toEqual(["co2"]);
  });

  it("labels a cruise as a lower bound and a rental car per vehicle", () => {
    expect(co2Kpis({ ...base, lowerBound: true }, t, "en")[0].label).toBe(
      "common:co2.labelLowerBound"
    );
    expect(co2Kpis({ ...base, perVehicle: true }, t, "en")[0].label).toBe(
      "common:co2.labelVehicle"
    );
  });
});
