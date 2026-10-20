import {
  bucketUsers,
  bucketFlights,
  bucketCruises,
  roundKm,
  bucketCount,
  bucketCountries,
  bucketPairings,
} from "../buckets";

describe("bucketUsers", () => {
  it.each([
    [1, "1"],
    [2, "2-5"],
    [5, "2-5"],
    [6, "6-20"],
    [20, "6-20"],
    [21, "20+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketUsers(n)).toBe(expected);
  });
});

describe("bucketFlights", () => {
  it.each([
    [0, "<50"],
    [49, "<50"],
    [50, "50-250"],
    [250, "50-250"],
    [251, "250-1k"],
    [1000, "250-1k"],
    [1001, "1k+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketFlights(n)).toBe(expected);
  });
});

describe("bucketCruises", () => {
  it("has an explicit zero bucket", () => {
    expect(bucketCruises(0)).toBe("0");
  });
  it.each([
    [1, "1-5"],
    [5, "1-5"],
    [6, "6-20"],
    [20, "6-20"],
    [21, "20+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketCruises(n)).toBe(expected);
  });
});

describe("roundKm", () => {
  it("rounds to the nearest 100", () => {
    expect(roundKm(128_437)).toBe(128_400);
    expect(roundKm(128_450)).toBe(128_500);
    expect(roundKm(49)).toBe(0);
    expect(roundKm(0)).toBe(0);
  });
  it("never returns a fractional value", () => {
    expect(Number.isInteger(roundKm(1234.567))).toBe(true);
  });
});

// forgejo#315 — must stay in step with COUNT_BUCKETS / COUNTRY_BUCKETS /
// PAIRING_BUCKETS in travstats-stats/src/schema.ts, which refuses any other value.
describe("bucketCount", () => {
  it.each([
    [0, "0"],
    [1, "1-10"],
    [10, "1-10"],
    [11, "11-50"],
    [50, "11-50"],
    [51, "51-250"],
    [250, "51-250"],
    [251, "250+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketCount(n)).toBe(expected);
  });
});

describe("bucketCountries", () => {
  it.each([
    [0, "0"],
    [5, "1-5"],
    [6, "6-20"],
    [21, "21-50"],
    [51, "50+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketCountries(n)).toBe(expected);
  });
});

describe("bucketPairings", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [2, "2-5"],
    [6, "6+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketPairings(n)).toBe(expected);
  });
});
