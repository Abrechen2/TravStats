import { longestRide } from "../railStats";

/**
 * The rail and bus tabs' record (`longestRide`) must agree with the records
 * page (`domainRecords.longest`), which skips a distance of 0 or less. A
 * 0 km ride — a placeholder, or a station typed twice — held "longest ride"
 * on the tab while the records page showed none.
 */
describe("longestRide", () => {
  it("lets no ride of 0 km or less hold the record", () => {
    expect(longestRide([{ distanceKm: 0 }])).toBeNull();
    expect(longestRide([{ distanceKm: -3 }, { distanceKm: null }])).toBeNull();
  });

  it("still finds the longest measured ride, ties to the earlier one", () => {
    const a = { id: "a", distanceKm: 120 };
    const b = { id: "b", distanceKm: 0 };
    const c = { id: "c", distanceKm: 120 };
    expect(longestRide([b, a, c])).toBe(a);
  });
});
