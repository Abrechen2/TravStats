import { describe, it, expect } from "@jest/globals";

import { airportVisits, airportsByYear } from "../airports";
import { connectionFlights, connectionsByYear } from "../connections";
import { buildYearStory, type StoryInputs } from "../story";
import { row } from "./fixtures";
import type { FlightInsightRow } from "../rows";

const FUN = {
  fastestDay: null,
  fastestDayFlights: 0,
  routeMaster: null,
  routeMasterCount: 0,
  timezones: 0,
};

function inputs(rows: FlightInsightRow[], year: number): StoryInputs {
  const visits = airportVisits(rows);
  const flights = connectionFlights(rows);
  const figures = [2023, 2024]
    .map((y) => ({
      year: y,
      flights: rows.filter((r) => r.departureDay?.startsWith(String(y))).length,
      distanceKm: 0,
    }))
    .filter((f) => f.flights > 0);
  return {
    year,
    availableYears: figures.map((f) => f.year),
    figures,
    airports: airportsByYear(visits),
    connections: connectionsByYear(flights),
    connectionFlights: flights,
    visits,
    transfers: [],
    funFacts: FUN,
  };
}

describe("the year's story (forgejo#256)", () => {
  it("names the figure that moved most against the calendar year before", () => {
    const rows = [
      row("FRA", "LHR", "2023-02-01T10:00", "2023-02-01T11:00"),
      row("FRA", "LHR", "2024-02-01T10:00", "2024-02-01T11:00"),
      row("FRA", "LHR", "2024-03-01T10:00", "2024-03-01T11:00"),
      row("FRA", "LHR", "2024-04-01T10:00", "2024-04-01T11:00"),
    ];
    const story = buildYearStory(inputs(rows, 2024));
    // 1 → 3 flights (+200 %) beats 2 → 2 airports and 1 → 1 connection.
    expect(story.biggestChange).toMatchObject({
      measure: "flights",
      previous: 1,
      current: 3,
      previousYear: 2023,
    });
    expect(story.biggestChange!.ratio).toBeCloseTo(2);
  });

  it("falls back to the most flown connection when no return lasted a year, from three flights", () => {
    const rows = [
      row("FRA", "LHR", "2024-02-01T10:00", "2024-02-01T11:00"),
      row("LHR", "FRA", "2024-02-03T10:00", "2024-02-03T11:00"),
      row("FRA", "LHR", "2024-05-01T10:00", "2024-05-01T11:00"),
    ];
    const story = buildYearStory(inputs(rows, 2024));
    expect(story.curiousRepetition).toEqual({
      kind: "connection",
      connection: "FRA-LHR",
      flights: 3,
    });
    expect(story.biggestChange).toBeNull();
    expect(story.newAirports).toEqual(["FRA", "LHR"]);
  });

  it("marks the first recorded year, where every airport is new by definition", () => {
    const rows = [
      row("FRA", "LHR", "2023-02-01T10:00", "2023-02-01T11:00"),
      row("FRA", "CDG", "2024-02-01T10:00", "2024-02-01T11:00"),
    ];
    expect(buildYearStory(inputs(rows, 2023)).firstRecordedYear).toBe(true);
    expect(buildYearStory(inputs(rows, 2024)).firstRecordedYear).toBe(false);
  });

  it("claims nothing when nothing stands out", () => {
    const rows = [row("FRA", "LHR", "2024-02-01T10:00", "2024-02-01T11:00")];
    expect(buildYearStory(inputs(rows, 2024)).curiousRepetition).toBeNull();
  });
});
