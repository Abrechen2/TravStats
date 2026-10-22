import { describe, expect, it } from "@jest/globals";

import { rewriteCompanionNames } from "../nameRewrite";

describe("rewriteCompanionNames", () => {
  const from = new Set(["norber"]);

  it("replaces every spelling of the person and keeps the order", () => {
    expect(rewriteCompanionNames(["Ben", "NORBER", "Carl"], from, "Norbert")).toEqual([
      "Ben",
      "Norbert",
      "Carl",
    ]);
  });

  it("keeps the merged person once, where they were listed first", () => {
    expect(rewriteCompanionNames(["Norbert", "Ben", "Norber"], from, "Norbert")).toEqual([
      "Norbert",
      "Ben",
    ]);
    expect(rewriteCompanionNames(["Norber", "Ben", "norbert"], from, "Norbert")).toEqual([
      "Norbert",
      "Ben",
    ]);
  });

  it("answers null for a list that does not name the person — that row is not written", () => {
    expect(rewriteCompanionNames(["Ben", "Carl"], from, "Norbert")).toBeNull();
    expect(rewriteCompanionNames([], from, "Norbert")).toBeNull();
  });

  it("leaves other people's duplicates alone", () => {
    expect(rewriteCompanionNames(["Ben", "ben", "Norber"], from, "Norbert")).toEqual([
      "Ben",
      "ben",
      "Norbert",
    ]);
  });

  it("is no change when the new spelling is the one already there", () => {
    expect(rewriteCompanionNames(["Norbert"], new Set(["norbert"]), "Norbert")).toBeNull();
    expect(rewriteCompanionNames(["norbert"], new Set(["norbert"]), "Norbert")).toEqual([
      "Norbert",
    ]);
  });
});
