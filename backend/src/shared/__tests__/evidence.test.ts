import { rankingKey, parseRankingKey, EVIDENCE_METRICS } from "../evidence";

/**
 * The key is the only thing a tile and the endpoint share. A tile that builds
 * it one way and a resolver that reads it another way is a 404 the user finds,
 * so the round trip is pinned here and the vocabulary is a closed list.
 */
describe("evidence keys", () => {
  it("round-trips every dimension", () => {
    for (const dimension of [
      "airline",
      "airport",
      "country",
      "continent",
      "aircraftType",
    ] as const) {
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

  it("lists the metrics the panel may ask for", () => {
    expect(EVIDENCE_METRICS).toContain("countries");
    expect(new Set(EVIDENCE_METRICS).size).toBe(EVIDENCE_METRICS.length);
  });
});
