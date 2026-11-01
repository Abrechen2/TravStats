import { describe, expect, it } from "vitest";
import { lodgingSheet, placeSheet } from "../sheets";

const t = (key: string): string => key;

describe("lodging and place sheets carry tags (forgejo#405)", () => {
  it("writes a lodging's tags as one comma-separated cell", () => {
    const col = lodgingSheet(t).columns.find((c) => c.key === "tags");
    expect(col).toBeDefined();
    expect(col!.value({ tags: ["Meerblick", "Frühstück"] } as never)).toBe("Meerblick, Frühstück");
    expect(col!.value({} as never)).toBe("");
  });

  it("writes a place's tags as one comma-separated cell", () => {
    const col = placeSheet(t).columns.find((c) => c.key === "tags");
    expect(col).toBeDefined();
    expect(col!.value({ tags: ["Strand"] } as never)).toBe("Strand");
  });
});
