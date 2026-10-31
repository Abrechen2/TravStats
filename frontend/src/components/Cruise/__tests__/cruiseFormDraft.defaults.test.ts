import { describe, expect, it } from "vitest";
import { cruiseFormFields } from "../cruiseFormDraft";
import type { Cruise } from "../../../types";

describe("cruise form defaults (forgejo#389: defaultLine / defaultCabinType changed nothing)", () => {
  const defaults = { defaultLine: "AIDA", defaultCabinType: "balcony" as const };

  it("prefills a new cruise with the preferred line and cabin type", () => {
    const f = cruiseFormFields(undefined, "EUR", defaults);
    expect(f.cruiseLine).toBe("AIDA");
    expect(f.cabinType).toBe("balcony");
  });

  it("leaves a stored cruise alone, even one with an empty line", () => {
    const stored = { cruiseLine: null, cabinType: null } as unknown as Cruise;
    const f = cruiseFormFields(stored, "EUR", defaults);
    expect(f.cruiseLine).toBe("");
    expect(f.cabinType).toBe("");
  });

  it("stays empty without defaults", () => {
    expect(cruiseFormFields(undefined, "EUR").cruiseLine).toBe("");
    expect(cruiseFormFields(undefined, "EUR", { defaultCabinType: null }).cabinType).toBe("");
  });
});
