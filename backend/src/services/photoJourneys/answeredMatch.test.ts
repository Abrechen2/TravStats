import { describe, it, expect } from "@jest/globals";
import { buildAnsweredIndex, JOURNEY_MATCH_KM } from "./answeredMatch";

const DAY = 86_400_000;
const answered = [
  { startMs: Date.UTC(2024, 4, 3), endMs: Date.UTC(2024, 4, 8), lat: 38.72, lon: -9.14 },
];

describe("answered photo journeys keep their answer when the fingerprint changes", () => {
  const index = buildAnsweredIndex(answered, JOURNEY_MATCH_KM);

  it("matches a burst that starts earlier and whose median crossed a 0.1 degree edge", () => {
    expect(
      index.covers({
        startMs: Date.UTC(2024, 4, 1),
        endMs: Date.UTC(2024, 4, 8),
        position: { lat: 38.84, lon: -9.14 },
      })
    ).toBe(true);
  });

  it("does not match a different trip at the same place a month later", () => {
    expect(
      index.covers({
        startMs: Date.UTC(2024, 5, 10),
        endMs: Date.UTC(2024, 5, 14),
        position: { lat: 38.72, lon: -9.14 },
      })
    ).toBe(false);
  });

  it("does not match a burst the same week but far away", () => {
    expect(
      index.covers({
        startMs: Date.UTC(2024, 4, 3) + DAY,
        endMs: Date.UTC(2024, 4, 5),
        position: { lat: 41.15, lon: -8.61 },
      })
    ).toBe(false);
  });

  it("never matches a burst without a position", () => {
    expect(
      index.covers({ startMs: answered[0].startMs, endMs: answered[0].endMs, position: null })
    ).toBe(false);
  });
});
