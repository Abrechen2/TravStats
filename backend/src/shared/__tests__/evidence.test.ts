import { rankingKey, parseRankingKey, RANKING_DIMENSIONS } from "../evidence";

/**
 * The key is the only thing a tile and the endpoint share. A tile that builds
 * it one way and a resolver that reads it another way is a 404 the user finds,
 * so the round trip is pinned here and the vocabulary is a closed list.
 */
describe("evidence keys", () => {
  it("round-trips every dimension", () => {
    for (const dimension of RANKING_DIMENSIONS) {
      expect(parseRankingKey(rankingKey(dimension, "LH"))).toEqual({ dimension, value: "LH" });
    }
  });

  it("keeps a value containing a colon intact — an airline name may carry one", () => {
    expect(parseRankingKey(rankingKey("airline", "Air: One"))).toEqual({
      dimension: "airline",
      value: "Air: One",
    });
  });

  it("refuses a key with an unknown dimension rather than guessing", () => {
    expect(parseRankingKey("nonsense:LH")).toBeNull();
    expect(parseRankingKey("LH")).toBeNull();
  });

  /**
   * These behave correctly today, but nothing pinned them before this test:
   * a later naive rewrite (`split(":")`, or accepting an empty value) would
   * pass the round-trip cases above and still ship a 404 on one of these.
   */
  it.each([
    ["", "empty"],
    [":", "separator only"],
    ["airline:", "empty value"],
    [":LH", "empty dimension"],
    ["air:LH", "a prefix of a real dimension"],
  ])("refuses %s (%s) rather than guessing", (key) => {
    expect(parseRankingKey(key)).toBeNull();
  });

  it("keeps every colon after the first inside the value", () => {
    expect(parseRankingKey("airline:A:B:C")).toEqual({ dimension: "airline", value: "A:B:C" });
  });
});
