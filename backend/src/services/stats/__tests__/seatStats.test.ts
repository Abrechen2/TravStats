import { computeSeatStats, seatFactsOf } from "../seatStats";

/** The seat figures and their evidence read one rule (`seatFactsOf`, forgejo#256). */
describe("computeSeatStats", () => {
  it("counts positions, zones, classes, the most common seat and the average row", () => {
    const stats = computeSeatStats([
      { seatNumber: "3A", seatClass: "economy" },
      { seatNumber: "3a", seatClass: "economy" },
      { seatNumber: "14E", seatClass: "economy" },
      { seatNumber: "30C", seatClass: "business" },
      { seatNumber: "12L", seatClass: null },
      { seatNumber: "XX", seatClass: null },
      { seatNumber: null, seatClass: "first" },
    ]);
    expect(stats).toEqual({
      windowCount: 2,
      middleCount: 1,
      aisleCount: 1,
      unknownCount: 2,
      noSeatCount: 1,
      frontCount: 2,
      middleZoneCount: 2,
      backCount: 1,
      mostCommonSeat: "3A",
      seatClassDistribution: { economy: 3, business: 1, first: 1 },
      avgRowNumber: 12.4,
    });
  });

  it("places a seat the pattern cannot read as unknown, with no row", () => {
    expect(seatFactsOf({ seatNumber: "XX", seatClass: null })).toEqual({
      seat: "XX",
      position: "unknown",
      zone: null,
      row: null,
    });
  });
});
