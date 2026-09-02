/**
 * "On the grounds of an airport this traveller flew through" — the §8.2 signal.
 *
 * The properties that matter are the two edges: an airport is a place with a
 * size, and a city is not part of it. Everything else about the rung follows
 * from those two answers being right.
 */
import { describe, it, expect } from "@jest/globals";

import { knownAirportTest } from "../knownAirports";
import { accumulateCountryDays, createCountryDayAccumulator, drainCountryDays } from "../reduce";

/** Doha's airport reference point, and the middle of the city 5 km north-west. */
const DOH = { lat: 25.2731, lon: 51.6081 };
const DOHA_CITY = { lat: 25.2854, lon: 51.5310 };

describe("knownAirportTest", () => {
  it("answers yes on the airport itself and across its grounds", () => {
    const test = knownAirportTest([DOH]);

    expect(test(DOH.lat, DOH.lon)).toBe(true);
    // ~3 km away — a remote stand or the far end of a runway.
    expect(test(DOH.lat + 0.027, DOH.lon)).toBe(true);
  });

  it("answers no in the CITY the airport serves", () => {
    // The distinction the whole rung rests on. Doha's centre is the closest
    // city centre to its airport of any of the owner's connection countries,
    // so if the radius survives this one it survives the rest.
    expect(knownAirportTest([DOH])(DOHA_CITY.lat, DOHA_CITY.lon)).toBe(false);
  });

  it("answers no for an airport this traveller never flew through", () => {
    // An account with no Qatari flight cannot have its Qatari days explained
    // away by an airport, however close it parked to one. That is what makes
    // this a fact rather than a distance threshold.
    expect(knownAirportTest([])(DOH.lat, DOH.lon)).toBe(false);
  });

  it("is not fooled by a matching longitude on the wrong hemisphere", () => {
    // The latitude guard is an optimisation, and an optimisation that answered
    // wrongly would be worse than none. -25° shares nothing with +25°.
    expect(knownAirportTest([DOH])(-DOH.lat, DOH.lon)).toBe(false);
  });
});

describe("the signal reaches the stored row", () => {
  it("counts the airside points of a day without keeping a coordinate", () => {
    const accumulator = createCountryDayAccumulator();
    const noon = Date.parse("2024-06-01T12:00:00Z");
    const points = [
      { latitude: DOH.lat, longitude: DOH.lon, timestampMs: noon },
      { latitude: DOH.lat, longitude: DOH.lon, timestampMs: noon + 3_600_000 },
      { latitude: DOHA_CITY.lat, longitude: DOHA_CITY.lon, timestampMs: noon + 7_200_000 },
    ];

    accumulateCountryDays(accumulator, points, () => "QA", knownAirportTest([DOH]));
    const [row] = drainCountryDays(accumulator);

    expect(row.pointCount).toBe(3);
    expect(row.airportPointCount).toBe(2);
    // Still nothing that could be inverted back into a position.
    expect(JSON.stringify(row)).not.toContain("51.6");
  });

  it("reports nothing airside when no test is given", () => {
    // The default, and the direction it errs in: "nothing was airside" lifts a
    // country onto a stronger rung than `connection`, which keeps it in the
    // headline rather than dropping it out.
    const rows = createCountryDayAccumulator();
    accumulateCountryDays(
      rows,
      [{ latitude: DOH.lat, longitude: DOH.lon, timestampMs: Date.parse("2024-06-01T12:00:00Z") }],
      () => "QA",
    );

    expect(drainCountryDays(rows)[0].airportPointCount).toBe(0);
  });
});
