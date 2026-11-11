import { describe, it, expect } from "vitest";
import { statsSectionsFor } from "../statsSections";

const t = (key: string): string => key;

describe("the tour statistics tab (tours-own-domain T3)", () => {
  it("owns the day-tour insights, which the roadtrip tab no longer carries", () => {
    expect(statsSectionsFor("tour", t).map((s) => s.key)).toEqual(["insights"]);
    expect(statsSectionsFor("roadtrip", t).map((s) => s.key)).not.toContain("tours");
  });
});
