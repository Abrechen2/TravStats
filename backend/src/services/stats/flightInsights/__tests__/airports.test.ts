import { describe, it, expect } from "@jest/globals";

import {
  airportVisits,
  airportsByYear,
  completedYears,
  longestReunions,
  quartersByAirportYear,
  reunionsEndingIn,
} from "../airports";
import { connectionFlights, connectionsByYear } from "../connections";
import { row } from "./fixtures";

describe("airport discovery (forgejo#256)", () => {
  it("files a new airport under the year it was first recorded, against the whole logbook", () => {
    const visits = airportVisits([
      row("FRA", "JFK", "2022-05-01T10:00", "2022-05-01T18:00"),
      row("JFK", "FRA", "2023-05-01T10:00", "2023-05-01T18:00"),
      row("FRA", "HND", "2023-07-01T10:00", "2023-07-02T06:00"),
    ]);
    expect(airportsByYear(visits)).toEqual([
      { year: 2022, used: ["FRA", "JFK"], discovered: ["FRA", "JFK"] },
      { year: 2023, used: ["FRA", "HND", "JFK"], discovered: ["HND"] },
    ]);
  });

  it("files the arrival under the day it landed — a New Year's Eve departure discovers its arrival next year", () => {
    const visits = airportVisits([row("FRA", "JFK", "2022-12-31T22:00", "2023-01-01T05:00")]);
    expect(airportsByYear(visits).map((y) => [y.year, y.discovered])).toEqual([
      [2022, ["FRA"]],
      [2023, ["JFK"]],
    ]);
  });

  it("counts no visit for an undated flight, an unknown end, or a flight that did not happen", () => {
    const visits = airportVisits([
      row("FRA", "JFK", null, null),
      row(null, "LHR", "2022-01-01T10:00", "2022-01-01T11:00"),
      row("MUC", "CDG", "2022-02-01T10:00", "2022-02-01T11:00", { status: "scheduled" }),
      row("MUC", "CDG", "2022-03-01T10:00", "2022-03-01T11:00", { status: "historical" }),
    ]);
    expect(visits.map((v) => v.airport).sort()).toEqual(["CDG", "LHR", "MUC"]);
  });
});

describe("long time no see (forgejo#256)", () => {
  it("names each airport's longest pause between two visit days, longest first", () => {
    const visits = airportVisits([
      row("FRA", "LIS", "2010-03-01T10:00", "2010-03-01T13:00", { id: "a" }),
      row("LIS", "FRA", "2010-03-08T10:00", "2010-03-08T13:00", { id: "b" }),
      row("MUC", "LIS", "2021-04-01T10:00", "2021-04-01T13:00", { id: "c" }),
    ]);
    const [first, second] = longestReunions(visits);
    expect(first).toMatchObject({
      airport: "LIS",
      fromDay: "2010-03-08",
      toDay: "2021-04-01",
      years: 11,
      fromFlightId: "b",
      toFlightId: "c",
    });
    // FRA's pause is one week: listed, after LIS. MUC was visited once — no pause.
    expect(second).toMatchObject({ airport: "FRA", days: 7, years: 0 });
    expect(longestReunions(visits)).toHaveLength(2);
  });

  it("counts whole years only — ten years less a day is nine", () => {
    expect(completedYears("2014-06-01", "2024-05-31")).toBe(9);
    expect(completedYears("2014-06-01", "2024-06-01")).toBe(10);
  });

  it("does not call a change of planes on one day a reunion", () => {
    const visits = airportVisits([
      row("MUC", "FRA", "2020-01-01T07:00", "2020-01-01T08:00"),
      row("FRA", "JFK", "2020-01-01T10:00", "2020-01-01T18:00"),
    ]);
    expect(longestReunions(visits).map((r) => r.airport)).toEqual([]);
    expect(reunionsEndingIn(visits, 2020)).toEqual([]);
  });
});

describe("placeholder dates (review fix round 1)", () => {
  it("file a year-only entry under its year but take it out of pauses and quarters", () => {
    const placeholder = { departureDayExact: false, arrivalDayExact: false };
    const visits = airportVisits([
      row("HAV", "MIA", "1986-12-31T00:00", "1986-12-31T01:00", placeholder),
      row("MIA", "HAV", "1996-06-01T10:00", "1996-06-01T11:00"),
      row("HAV", "MIA", "1996-09-01T10:00", "1996-09-01T11:00"),
    ]);
    expect(airportsByYear(visits)[0]).toMatchObject({ year: 1986, discovered: ["HAV", "MIA"] });
    // The only pause is the 1996 one: the placeholder day starts none.
    expect(longestReunions(visits).map((r) => [r.airport, r.fromDay])).toEqual([
      ["HAV", "1996-06-01"],
      ["MIA", "1996-06-01"],
    ]);
    expect(quartersByAirportYear(visits).some((q) => q.year === 1986)).toBe(false);
  });
});

describe("the four quarters (forgejo#256)", () => {
  it("needs the SAME airport in all four calendar quarters of ONE year", () => {
    const visits = airportVisits([
      row("FRA", "LHR", "2024-01-10T10:00", "2024-01-10T11:00"),
      row("FRA", "LHR", "2024-04-10T10:00", "2024-04-10T11:00"),
      row("FRA", "LHR", "2024-07-10T10:00", "2024-07-10T11:00"),
      row("MUC", "LHR", "2024-10-10T10:00", "2024-10-10T11:00"),
      row("FRA", "CDG", "2025-11-10T10:00", "2025-11-10T11:00"),
    ]);
    const quarters = quartersByAirportYear(visits);
    const [all] = quarters.filter((q) => q.quarters === 4);
    expect(quarters.filter((q) => q.quarters === 4)).toHaveLength(1);
    expect(all).toMatchObject({ airport: "LHR", year: 2024, quarters: 4 });
    expect(all.visits.map((v) => [v.quarter, v.day])).toEqual([
      [1, "2024-01-10"],
      [2, "2024-04-10"],
      [3, "2024-07-10"],
      [4, "2024-10-10"],
    ]);
    expect(quarters.find((q) => q.airport === "FRA" && q.year === 2024)?.quarters).toBe(3);
  });
});

describe("network growth (forgejo#256)", () => {
  it("treats the return direction as a repetition of the same connection", () => {
    const years = connectionsByYear(
      connectionFlights([
        row("MUC", "JFK", "2022-05-01T10:00", "2022-05-01T18:00"),
        row("JFK", "MUC", "2022-05-10T10:00", "2022-05-10T18:00"),
        row("MUC", "JFK", "2023-05-01T10:00", "2023-05-01T18:00"),
        row("MUC", "LIS", "2023-06-01T10:00", "2023-06-01T13:00"),
        row("MUC", null, "2023-06-02T10:00", "2023-06-02T13:00"),
      ])
    );
    expect(years).toEqual([
      {
        year: 2022,
        discovered: ["JFK-MUC"],
        repeated: [],
        flightsOnNew: 2,
        flightsOnRepeated: 0,
      },
      {
        year: 2023,
        discovered: ["LIS-MUC"],
        repeated: ["JFK-MUC"],
        flightsOnNew: 1,
        flightsOnRepeated: 1,
      },
    ]);
  });
});
