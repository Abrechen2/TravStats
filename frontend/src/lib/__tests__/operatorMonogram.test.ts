import { describe, expect, it } from "vitest";
import { operatorMonogram } from "../operatorMonogram";

// forgejo#197: the tile's letters while no logo source exists.
describe("operatorMonogram", () => {
  it.each<[string | null | undefined, string | null]>([
    [null, null],
    [undefined, null],
    ["   ", null],
    ["DB Fernverkehr", "DB"],
    ["SBB", "SBB"],
    ["ÖBB Nightjet", "ÖBB"],
    ["SNCF Voyageurs", "SNCF"],
    ["Share Now", "SN"],
    ["Deutsche Bahn", "DB"],
    ["Sixt", "SI"],
    ["Free2Move", "FR"],
    ["eurostar", "EU"],
    ["Avis Budget Group", "AB"],
    ["Trenitalia – Frecciarossa", "TF"],
  ])("%s → %s", (name, expected) => {
    expect(operatorMonogram(name)).toBe(expected);
  });
});
