import { describe, it, expect } from "vitest";

import { evidenceKeyForRule } from "../achievementEvidenceKey";
import { progressUnitForRule } from "../achievementProgressUnit";

/**
 * The rail badges (2.7) open the rides behind them: every rail rule but the
 * longest ride names a served measure, and the kilometre rules say "km"
 * behind their fraction instead of a bare 40075.
 */
describe("rail badges in the achievement dialog", () => {
  it("names a served rail measure for every counting rule", () => {
    expect(evidenceKeyForRule("rail_count")).toBe("railRideCount");
    expect(evidenceKeyForRule("rail_km")).toBe("railDistanceKmTotal");
    expect(evidenceKeyForRule("rail_countries")).toBe("railCountriesCount");
    expect(evidenceKeyForRule("rail_operators")).toBe("railOperatorsCount");
    expect(evidenceKeyForRule("rail_night_trains")).toBe("railNightTrainCount");
    expect(evidenceKeyForRule("rail_high_speed")).toBe("railHighSpeedRideCount");
    expect(evidenceKeyForRule("rail_cross_border")).toBe("railCrossBorderRideCount");
  });

  it("offers no list for the longest ride, an extremum release 1 does not serve", () => {
    expect(evidenceKeyForRule("rail_longest_km")).toBeNull();
  });

  it("names the unit of the distance rules, roadtrip ones included", () => {
    expect(progressUnitForRule("rail_km")).toBe("km");
    expect(progressUnitForRule("rail_longest_km")).toBe("km");
    expect(progressUnitForRule("roadtrip_km")).toBe("km");
    expect(progressUnitForRule("roadtrip_free_nights")).toBe("nights");
    expect(progressUnitForRule("rail_count")).toBeNull();
  });
});
