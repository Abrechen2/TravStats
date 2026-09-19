import {
  countRoundTrips,
  crossesHemisphere,
  departureDaypartOf,
  isWeekendDeparture,
  longitudeDirectionOf,
  touchesTropics,
  type RoundTripLeg,
} from "../flightPredicates";

/**
 * The rules `/stats/fun`, `/stats/unique` and the evidence resolvers now
 * share. The calculators' own suites (`stats.historical`, `statsLocalTime`,
 * `uniqueStats.roundTrips`, `uniqueStats.layover`) already pin the FIGURES
 * these produce end to end; what is tested here is what only became
 * observable when the rules were extracted — above all `pairedLegIds`, which
 * the round-trip count never had to name while it was a bare number.
 */
describe("flightPredicates", () => {
  describe("countRoundTrips", () => {
    const leg = (id: string, dep: string, arr: string, day: string | null): RoundTripLeg => ({
      id,
      depIata: dep,
      arrIata: arr,
      departureTime: day ? new Date(`${day}T08:00:00Z`) : null,
    });

    it("pairs a direction only as often as its thinner side allows, and names the two legs", () => {
      const { total, pairedLegIds } = countRoundTrips([
        leg("a1", "FRA", "LHR", "2025-01-01"),
        leg("a2", "FRA", "LHR", "2025-02-01"),
        leg("a3", "FRA", "LHR", "2025-03-01"),
        leg("b1", "LHR", "FRA", "2025-01-05"),
      ]);
      expect(total).toBe(1);
      // The EARLIEST outbound is the one that made the round trip — not "one
      // of the three", which is what a set-based answer would have said.
      expect(pairedLegIds.sort()).toEqual(["a1", "b1"]);
    });

    it("names the same legs whatever order the input arrives in", () => {
      const legs = [
        leg("a1", "FRA", "LHR", "2025-01-01"),
        leg("a2", "FRA", "LHR", "2025-02-01"),
        leg("b1", "LHR", "FRA", "2025-01-05"),
      ];
      const forward = countRoundTrips(legs).pairedLegIds.sort();
      const reversed = countRoundTrips([...legs].reverse()).pairedLegIds.sort();
      expect(reversed).toEqual(forward);
    });

    it("counts an unordered airport pair once, not once per direction", () => {
      const { total, pairedLegIds } = countRoundTrips([
        leg("a1", "FRA", "LHR", "2025-01-01"),
        leg("b1", "LHR", "FRA", "2025-01-05"),
        leg("a2", "FRA", "LHR", "2025-02-01"),
        leg("b2", "LHR", "FRA", "2025-02-05"),
      ]);
      expect(total).toBe(2);
      expect(pairedLegIds).toHaveLength(4);
    });

    /**
     * A sightseeing flight that lands where it took off. Its direction key is
     * its own reverse, so before the fix `back` was the same bucket as
     * `direction`: `min(n, n)` counted every such leg as a round trip AND
     * pushed its id into `pairedLegIds` twice. The resolver de-duplicates the
     * ids, so the tile claimed one round trip the panel could only half
     * evidence — which is the disagreement the panel exists to prevent.
     */
    it("does not call a flight that lands where it took off a round trip", () => {
      const { total, pairedLegIds } = countRoundTrips([
        leg("s1", "FRA", "FRA", "2025-01-01"),
        leg("a1", "FRA", "LHR", "2025-02-01"),
        leg("b1", "LHR", "FRA", "2025-02-05"),
      ]);
      expect(total).toBe(1);
      expect(pairedLegIds.sort()).toEqual(["a1", "b1"]);
      expect(new Set(pairedLegIds).size).toBe(pairedLegIds.length);
    });

    it("ignores a leg whose endpoint has no code at all", () => {
      const noCode: RoundTripLeg = {
        id: "x1",
        depIata: null,
        depIcao: null,
        arrIata: "LHR",
        departureTime: new Date("2025-01-01T08:00:00Z"),
      };
      expect(countRoundTrips([noCode, leg("b1", "LHR", "FRA", "2025-01-05")])).toEqual({
        total: 0,
        pairedLegIds: [],
      });
    });
  });

  it("crossesHemisphere is false for a flight that only touches the equator", () => {
    // Latitude 0 is in neither hemisphere, so a flight from it has not
    // crossed — the strict `> 0` / `< 0` comparison both tiles inherit.
    expect(crossesHemisphere({ depLat: 0, depLon: 10, arrLat: -5, arrLon: 10 })).toBe(false);
    expect(crossesHemisphere({ depLat: 5, depLon: 10, arrLat: -5, arrLon: 10 })).toBe(true);
  });

  it("longitudeDirectionOf folds the date line out rather than measuring the long way", () => {
    // LAX → NRT is 258° of raw longitude difference eastwards, which is the
    // 102° westward crossing the traveller actually flew.
    expect(longitudeDirectionOf({ depLat: 34, depLon: -118, arrLat: 36, arrLon: 140 })).toBe(
      "west"
    );
    expect(longitudeDirectionOf({ depLat: 50, depLon: 8, arrLat: 36, arrLon: 140 })).toBe("east");
    // No longitude change is neither direction — and is counted in neither
    // tally, rather than defaulting into one of them.
    expect(longitudeDirectionOf({ depLat: 50, depLon: 8, arrLat: 40, arrLon: 8 })).toBeNull();
  });

  it("touchesTropics needs BOTH latitudes before it answers at all", () => {
    expect(touchesTropics({ depLat: 13.7, depLon: 100.5, arrLat: null, arrLon: 8 })).toBe(false);
    expect(touchesTropics({ depLat: 50, depLon: 8, arrLat: 13.7, arrLon: 100.5 })).toBe(true);
  });

  it("departureDaypartOf abstains on a DATE_ONLY row instead of reading its placeholder", () => {
    const noon = new Date("2025-06-01T12:00:00Z");
    expect(
      departureDaypartOf({
        departureTime: noon,
        depTimezone: "Europe/Berlin",
        depTimeSemantics: "DATE_ONLY",
      })
    ).toBeNull();
    expect(
      departureDaypartOf({
        departureTime: noon,
        depTimezone: "Europe/Berlin",
        depTimeSemantics: "UTC",
      })
    ).toBe("afternoon");
    expect(departureDaypartOf({ departureTime: null })).toBeNull();
  });

  it("isWeekendDeparture reads the weekday at the departure airport, not in UTC", () => {
    // 01:00 UTC on Monday 2 June 2025 is still Sunday evening in Los Angeles
    // and is already Monday morning in Berlin — one instant, two weekdays.
    const earlyMonday = new Date("2025-06-02T01:00:00Z");
    expect(
      isWeekendDeparture({
        departureTime: earlyMonday,
        depTimezone: "America/Los_Angeles",
        depTimeSemantics: "UTC",
      })
    ).toBe(true);
    expect(
      isWeekendDeparture({
        departureTime: earlyMonday,
        depTimezone: "Europe/Berlin",
        depTimeSemantics: "UTC",
      })
    ).toBe(false);
  });
});
