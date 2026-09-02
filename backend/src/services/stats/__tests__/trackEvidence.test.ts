/**
 * What a location history proves — the four cases §8.2 and §3.4c turn on.
 *
 * The one worth reading first is the last: an account that never left the
 * terminal in Doha and an account that spent the day in the city produce the
 * same country-days, and the ONLY thing that tells them apart is where the
 * points were relative to an airport the traveller is known to have flown
 * through. That is the rung this module exists for, and a test that stopped at
 * "a track proves a country" would not touch it.
 */
import { describe, it, expect } from "@jest/globals";

import { trackEvidence, type CountryDayRow } from "../trackEvidence";

const day = (
  date: string,
  countryCode: string,
  overrides: Partial<CountryDayRow> = {}
): CountryDayRow => ({
  date,
  countryCode,
  pointCount: 20,
  airportPointCount: 0,
  partialWindow: false,
  ...overrides,
});

const tierOf = (rows: CountryDayRow[], code: string): string | undefined =>
  trackEvidence(rows).find((input) => input.country === code)?.tier;

describe("trackEvidence — the days", () => {
  it("hands over every recorded day, and only recorded days", () => {
    // §3.4b-bis: a track day is ATTESTED — a point was actually recorded. So
    // unlike a spell between two flights, it needs no endpoint rule, and the
    // gap between the 2nd and the 5th is simply not there.
    const [input] = trackEvidence([day("2024-06-01", "EE"), day("2024-06-05", "EE")]);

    expect(input.days).toEqual(["2024-06-01", "2024-06-05"]);
    expect(input.kind).toBe("track");
  });

  it("dates the country at its EARLIEST day", () => {
    const [input] = trackEvidence([day("2024-06-05", "EE"), day("2024-06-01", "EE")]);

    expect(input.at?.toISOString().slice(0, 10)).toBe("2024-06-01");
  });

  it("never publishes a ground time", () => {
    // A first and a last fix are two clocks, but they are not a landing and a
    // take-off: nothing says the traveller was still there in between, and
    // nothing says they left after. `notApplicable`, never a synthesised span.
    const [input] = trackEvidence([day("2024-06-01", "EE")]);

    expect(input.groundMinutes).toBeUndefined();
  });

  it("emits ONE input per country, not one per day", () => {
    const inputs = trackEvidence([
      day("2024-06-01", "EE"),
      day("2024-06-02", "EE"),
      day("2024-06-02", "LV"),
    ]);

    expect(inputs.map((i) => i.country)).toEqual(["EE", "LV"]);
  });
});

describe("trackEvidence — the tier", () => {
  it("calls two calendar-adjacent days `slept`", () => {
    // The same structural cut every other tier is made on: the day changed
    // while the traveller was there.
    expect(tierOf([day("2024-06-01", "EE"), day("2024-06-02", "EE")], "EE")).toBe("slept");
  });

  it("does not read two SEPARATE days as a night", () => {
    // A day in June and a day in August are two visits, not a two-month stay.
    // Neither is shared with another country here, so both are whole days.
    expect(tierOf([day("2024-06-01", "EE"), day("2024-08-01", "EE")], "EE")).toBe("visited");
  });

  it("calls a day the country had to itself `visited`", () => {
    expect(tierOf([day("2024-06-01", "EE")], "EE")).toBe("visited");
  });

  it("calls a day SHARED with another country `transited` — the Baltic case", () => {
    // Driving Riga → Tallinn: both countries hold the same day, so neither was
    // a day spent somewhere. §3.4c: this counts, and it is not a connection.
    const rows = [day("2024-06-01", "LV"), day("2024-06-01", "EE")];

    expect(tierOf(rows, "EE")).toBe("transited");
    expect(tierOf(rows, "LV")).toBe("transited");
  });

  it("does not let a PARTIAL day be read as a day the country had to itself", () => {
    // The window was truncated, so the absence of a second country on that day
    // proves nothing — Dawarich answers newest-first and the older part was
    // never read. It falls to `transited` rather than claiming a whole day.
    expect(tierOf([day("2024-06-01", "EE", { partialWindow: true })], "EE")).toBe("transited");
  });

  it("still reaches `slept` across two partial days", () => {
    // A partial window withdraws the day's SILENCE, not the day. Two adjacent
    // days are two days however thinly each was read.
    const rows = [
      day("2024-06-01", "EE", { partialWindow: true }),
      day("2024-06-02", "EE", { partialWindow: true }),
    ];

    expect(tierOf(rows, "EE")).toBe("slept");
  });
});

describe("trackEvidence — §8.2, the point in Doha", () => {
  it("keeps a country whose every point sat at a flown-through airport a `connection`", () => {
    // The whole reason the rung exists. A GPS point in Doha is a point in
    // Qatar even airside; what says "airside" is that every one of them was on
    // the grounds of an airport this traveller demonstrably flew through.
    const rows = [day("2024-06-01", "QA", { pointCount: 40, airportPointCount: 40 })];

    expect(tierOf(rows, "QA")).toBe("connection");
  });

  it("lifts the same country off `connection` as soon as ONE point was elsewhere", () => {
    // Six hours in Doha with a trip into the city. One fix off the airport is
    // enough, and it should be: the claim being made is "every point", so a
    // single counter-example ends it.
    const rows = [day("2024-06-01", "QA", { pointCount: 40, airportPointCount: 39 })];

    expect(tierOf(rows, "QA")).toBe("visited");
  });

  it("applies airside-only across the WHOLE country, not one day at a time", () => {
    // An overnight on a terminal bench is still a connection. The rule is a
    // statement about the country, so two adjacent airside days do not become
    // `slept` — which is exactly the upgrade §1.1 was written to prevent.
    const rows = [
      day("2024-06-01", "QA", { pointCount: 10, airportPointCount: 10 }),
      day("2024-06-02", "QA", { pointCount: 10, airportPointCount: 10 }),
    ];

    expect(tierOf(rows, "QA")).toBe("connection");
  });

  it("does not call a country airside on the strength of a row that recorded nothing", () => {
    // 0 of 0 is vacuously "every point", and reading it that way would demote
    // a country on the absence of evidence. A row with no points cannot make
    // the claim.
    const rows = [day("2024-06-01", "QA", { pointCount: 0, airportPointCount: 0 })];

    expect(tierOf(rows, "QA")).toBe("visited");
  });
});
