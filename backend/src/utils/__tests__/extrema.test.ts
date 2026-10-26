import { readFileSync } from "fs";
import path from "path";

import { extentOf, maxOf, minOf } from "../extrema";

/**
 * Extremes without spreading into `Math.min/max` (Codex review of TravTrack):
 * a spread has an engine argument ceiling, and a point history passes it.
 */
describe("extrema", () => {
  it("finds the least and greatest of a list far longer than a spread can hold", () => {
    const values = Array.from({ length: 500_000 }, (_, i) => 1_000_000 + ((i * 7919) % 500_000));
    values[123_456] = -5;
    values[400_000] = 9_999_999;
    expect(() => Math.min(...values)).toThrow(RangeError);
    expect(extentOf(values)).toEqual({ min: -5, max: 9_999_999 });
    expect(minOf(values)).toBe(-5);
    expect(maxOf(values)).toBe(9_999_999);
  });

  it("answers nothing for an empty list instead of an infinity", () => {
    expect(extentOf([])).toBeNull();
    expect(minOf([])).toBeNull();
    expect(maxOf([])).toBeNull();
  });

  it("no point-sized list is spread into Math.min or Math.max", () => {
    const files = [
      "services/travtrack/flightLines.ts",
      "routes/flights/trackSource.ts",
      "services/evidence/metricEvidencePlaceDetail.ts",
    ];
    for (const file of files) {
      const text = readFileSync(path.join(__dirname, "../..", file), "utf8");
      expect({ file, spread: /Math\.(min|max)\(\s*\.\.\./.test(text) }).toEqual({
        file,
        spread: false,
      });
    }
  });
});
