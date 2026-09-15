import { isPlausibleCoordinate, parseCoordinate, toCoordinates } from "../coordinates";

/**
 * AUD-071. Both geocoders checked `Number.isFinite` and stopped, which misses
 * the two ways a provider row actually goes wrong: a missing value coerces to
 * a perfectly finite 0, and nothing bounded the range at all.
 */
describe("parseCoordinate", () => {
  it.each([
    ["a number", 48.1, 48.1],
    ["a numeric string", "48.1", 48.1],
    ["a padded numeric string", "  -9.216 ", -9.216],
    ["zero itself", 0, 0],
  ])("reads %s", (_label, raw, expected) => {
    expect(parseCoordinate(raw)).toBe(expected);
  });

  // Every one of these is 0 under `Number()`, which is how a row with no
  // latitude became a position in the Atlantic.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a boolean", false],
    ["an object", {}],
    ["text", "somewhere"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s rather than reading it as zero", (_label, raw) => {
    expect(parseCoordinate(raw)).toBeNull();
  });
});

describe("isPlausibleCoordinate", () => {
  it("accepts an ordinary position", () => {
    expect(isPlausibleCoordinate(48.3538, 11.7861)).toBe(true);
  });

  it("accepts the extremes of the ranges", () => {
    expect(isPlausibleCoordinate(90, 180)).toBe(true);
    expect(isPlausibleCoordinate(-90, -180)).toBe(true);
  });

  it.each([
    ["latitude past the pole", 91, 0],
    ["latitude far past the pole", 1000, 10],
    ["longitude past the antimeridian", 0, 181],
    ["both out of range", -200, 400],
  ])("refuses %s", (_label, lat, lon) => {
    expect(isPlausibleCoordinate(lat, lon)).toBe(false);
  });

  it("refuses exact 0/0, which is always a failed parse here", () => {
    // A real point in the Gulf of Guinea, and nothing this application records
    // is ever there. Accepting it is what put pins in the Atlantic.
    expect(isPlausibleCoordinate(0, 0)).toBe(false);
    // But a zero on ONE axis is an ordinary position — the equator and the
    // prime meridian both exist.
    expect(isPlausibleCoordinate(0, 11.7861)).toBe(true);
    expect(isPlausibleCoordinate(48.3538, 0)).toBe(true);
  });

  it("refuses a row whose latitude is missing", () => {
    // The finding's own shape: `{ lat: null, lon: "" }` used to parse as 0/0.
    expect(isPlausibleCoordinate(null, "")).toBe(false);
  });
});

describe("toCoordinates", () => {
  it("returns the parsed pair", () => {
    expect(toCoordinates("48.1", "11.6")).toEqual({ lat: 48.1, lon: 11.6 });
  });

  it("returns null rather than a partial answer", () => {
    expect(toCoordinates("48.1", null)).toBeNull();
  });
});
