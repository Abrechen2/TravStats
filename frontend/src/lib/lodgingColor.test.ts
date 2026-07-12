import { describe, it, expect } from "vitest";
import { DOMAINS } from "../shared/domains";
import { LODGING_COLOR, buildLodgingLegend } from "./lodgingColor";

describe("LODGING_COLOR", () => {
  it("is derived from DOMAINS.lodging.color, not a second hardcoded literal", () => {
    // #d4778f -> [212, 119, 143]
    expect(DOMAINS.lodging.color).toBe("#d4778f");
    expect(LODGING_COLOR).toEqual([212, 119, 143]);
  });
});

describe("buildLodgingLegend", () => {
  it("returns exactly one row — lodging has no colour mode to switch", () => {
    const rows = buildLodgingLegend();
    expect(rows).toHaveLength(1);
  });

  it("the row's colour IS LODGING_COLOR — the same constant the pin layer resolves through", () => {
    const [row] = buildLodgingLegend();
    expect(row.kind).toBe("swatch");
    expect(row.slot).toBe("lodging");
    expect(row.color).toEqual(LODGING_COLOR);
  });
});
