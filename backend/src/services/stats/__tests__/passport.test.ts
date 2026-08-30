import { describe, it, expect } from "@jest/globals";

import { buildPassport, type PassportFlight } from "../passport";
import { CONTINENT_GROUPS, groupsCoverEveryContinent } from "../../../shared/passportContinents";
import { CONTINENTS } from "../../../utils/continents";

const MUC = { iata: "MUC", lat: 48.3538, lon: 11.7861 };
const TXL = { iata: "TXL", lat: 52.5597, lon: 13.2877 };
const JFK = { iata: "JFK", lat: 40.6413, lon: -73.7781 };
const NRT = { iata: "NRT", lat: 35.7647, lon: 140.3863 };
const SSH = { iata: "SSH", lat: 27.9773, lon: 34.395 }; // Sharm el-Sheikh — Sinai, so Asia
const HRG = { iata: "HRG", lat: 27.1783, lon: 33.7994 }; // Hurghada — African bank

const COUNTRIES = new Map<string, string | null>([
  ["MUC", "DE"],
  ["TXL", "DE"],
  ["JFK", "US"],
  ["NRT", "JP"],
  ["SSH", "EG"],
  ["HRG", "EG"],
  ["ZZZ", null], // in the catalogue, country unknown
]);

const flight = (
  from: { iata: string; lat: number; lon: number },
  to: { iata: string; lat: number; lon: number },
  date: string | null,
  status = "flown",
): PassportFlight => ({
  depIata: from.iata,
  depLat: from.lat,
  depLon: from.lon,
  arrIata: to.iata,
  arrLat: to.lat,
  arrLon: to.lon,
  departureTime: date === null ? null : new Date(`${date}T10:00:00Z`),
  status,
});

const NOW = new Date("2026-08-29T00:00:00Z");

describe("buildPassport", () => {
  it("counts a country once per flight, not once per end", () => {
    // A domestic hop touches Germany twice. It is one entry, or every
    // home-country figure doubles against the statistics page.
    const p = buildPassport([flight(MUC, TXL, "2021-05-01")], COUNTRIES, [], NOW);

    expect(p.countries).toHaveLength(1);
    expect(p.countries[0]).toMatchObject({ code: "DE", entries: 1 });
    expect(p.summary.airports).toBe(2);
  });

  it("counts the departure country, not only arrivals", () => {
    // Someone who has only ever flown out of Germany has still been to Germany.
    const p = buildPassport([flight(MUC, JFK, "2019-03-02")], COUNTRIES, [], NOW);
    expect(p.countries.map((c) => c.code).sort()).toEqual(["DE", "US"]);
  });

  it("leaves out a booked flight", () => {
    const p = buildPassport(
      [flight(MUC, NRT, "2027-01-01", "scheduled")],
      COUNTRIES,
      [],
      NOW,
    );
    expect(p.countries).toHaveLength(0);
    expect(p.summary.entries).toBe(0);
  });

  it("stamps an airport once, dated its first visit", () => {
    const p = buildPassport(
      [
        flight(MUC, JFK, "2018-06-01"),
        flight(JFK, MUC, "2018-06-10"),
        flight(MUC, JFK, "2022-04-04"),
      ],
      COUNTRIES,
      [],
      NOW,
    );

    expect(p.stamps.map((s) => s.iata).sort()).toEqual(["JFK", "MUC"]);
    expect(p.stamps.find((s) => s.iata === "JFK")?.date).toBe("2018-06-01");
  });

  it("puts the two halves of a transcontinental country on different continents", () => {
    // Egypt is the case that makes a single country-level answer a lie: Sharm
    // el-Sheikh is in Asia, Hurghada is in Africa, and they are one country.
    const sinai = buildPassport([flight(MUC, SSH, "2015-02-01")], COUNTRIES, [], NOW);
    const mainland = buildPassport([flight(MUC, HRG, "2015-02-01")], COUNTRIES, [], NOW);

    expect(sinai.countries.find((c) => c.code === "EG")?.continent).toBe("Asia");
    expect(mainland.countries.find((c) => c.code === "EG")?.continent).toBe("Africa");
  });

  it("drops an airport whose country the catalogue does not know", () => {
    const unknown = { iata: "ZZZ", lat: 0, lon: 0 };
    const p = buildPassport([flight(MUC, unknown, "2020-01-01")], COUNTRIES, [], NOW);

    // Germany still counts; the unknown end is simply absent rather than
    // guessed into a continent whose quota nobody could then check.
    expect(p.countries.map((c) => c.code)).toEqual(["DE"]);
    expect(p.summary.airports).toBe(1);
  });

  it("marks the home country and the countries first reached this year", () => {
    const p = buildPassport(
      [flight(MUC, JFK, "2005-07-16"), flight(MUC, NRT, "2026-02-02")],
      COUNTRIES,
      ["MUC"],
      NOW,
    );

    expect(p.countries.find((c) => c.code === "DE")?.isHome).toBe(true);
    expect(p.countries.find((c) => c.code === "JP")?.isNew).toBe(true);
    expect(p.countries.find((c) => c.code === "US")?.isNew).toBe(false);
    expect(p.summary.newThisYear).toBe(1);
    expect(p.summary.firstStampYear).toBe(2005);
  });

  it("reports a quota per continent against a denominator it can name", () => {
    const p = buildPassport([flight(MUC, JFK, "2019-03-02")], COUNTRIES, [], NOW);

    const europe = p.continents.find((c) => c.continent === "Europe");
    expect(europe?.visited).toBe(1);
    // The denominator is the catalogue's own country list, so it is a real
    // number rather than one of the several competing counts of the world.
    expect(europe?.total).toBeGreaterThan(europe!.visited);
    expect(p.continents).toHaveLength(CONTINENTS.length);
  });

  it("counts continents visited even where two share a display row", () => {
    // Africa and Antarctica are drawn as one row. Somebody who reaches
    // Antarctica must still see the headline number move.
    const africaRow = CONTINENT_GROUPS.find((g) => g.key === "africaAntarctica");
    expect(africaRow?.continents).toEqual(["Africa", "Antarctica"]);

    const p = buildPassport([flight(MUC, HRG, "2015-02-01")], COUNTRIES, [], NOW);
    expect(p.summary.continentsVisited).toBe(2); // Europe and Africa, not one row
    expect(p.summary.continentsTotal).toBe(CONTINENTS.length);
  });

  it("draws every continent somewhere", () => {
    expect(groupsCoverEveryContinent()).toBe(true);
  });

  it("emits dates, never month names", () => {
    const p = buildPassport([flight(MUC, JFK, "2018-06-01")], COUNTRIES, [], NOW);
    const text = JSON.stringify(p);
    for (const month of ["Jan", "Feb", "Mär", "Jun", "June", "Juni"]) {
      expect(text).not.toContain(month);
    }
  });

  it("survives a flight with no date", () => {
    const p = buildPassport([flight(MUC, JFK, null)], COUNTRIES, [], NOW);
    expect(p.countries.map((c) => c.code).sort()).toEqual(["DE", "US"]);
    expect(p.countries[0].firstYear).toBeNull();
    expect(p.summary.firstStampYear).toBeNull();
  });
});
