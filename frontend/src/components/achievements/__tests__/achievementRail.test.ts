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

  // forgejo#261
  it("lists the journeys behind 'Gut umgestiegen' and says the two extrema have no list", () => {
    expect(evidenceKeyForRule("rail_documented_transfer_journeys")).toBe(
      "railDocumentedTransferJourneyCount"
    );
    expect(evidenceKeyForRule("rail_station_return_years")).toBeNull();
    expect(evidenceKeyForRule("rail_new_connections_year")).toBeNull();
    expect(progressUnitForRule("rail_station_return_years")).toBe("years");
  });

  it("names the unit of the distance rules, roadtrip ones included", () => {
    expect(progressUnitForRule("rail_km")).toBe("km");
    expect(progressUnitForRule("rail_longest_km")).toBe("km");
    expect(progressUnitForRule("roadtrip_km")).toBe("km");
    expect(progressUnitForRule("roadtrip_free_nights")).toBe("nights");
    expect(progressUnitForRule("rail_count")).toBeNull();
  });

  // forgejo#265: every rental and bus badge names the entries behind it.
  it("lists the rentals and bus rides behind their badges", () => {
    expect(evidenceKeyForRule("rental_count")).toBe("rentalCount");
    expect(evidenceKeyForRule("rental_one_way")).toBe("rentalOneWayCount");
    expect(evidenceKeyForRule("rental_odometer_documented")).toBe("rentalOdometerDocumentedCount");
    expect(evidenceKeyForRule("bus_count")).toBe("busRideCount");
    expect(evidenceKeyForRule("bus_night_rides")).toBe("busNightRideCount");
    expect(evidenceKeyForRule("bus_terminals")).toBe("busTerminalsCount");
  });
});
