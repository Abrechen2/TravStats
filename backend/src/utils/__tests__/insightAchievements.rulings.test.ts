import { describe, it, expect } from "@jest/globals";

import { foldCruiseInsightStats, foldFlightInsightStats } from "../insightAchievements";
import { cruisesPerPort } from "../../services/stats/cruiseInsights/ports";
import { row } from "../../services/stats/flightInsights/__tests__/fixtures";
import { call, cruise } from "../../services/stats/cruiseInsights/__tests__/fixtures";

/**
 * Owner rulings of 2026-10-09 on two of the proposal badges (forgejo#256/#257).
 */
describe("NEW_GROUND_YEAR leaves the first recorded year out", () => {
  it("does not count the year where every airport is new by definition", () => {
    const flights = [
      row("FRA", "JFK", "2018-01-10T10:00", "2018-01-10T18:00"),
      row("JFK", "LAX", "2018-02-10T10:00", "2018-02-10T16:00"),
      row("LAX", "SFO", "2018-03-10T10:00", "2018-03-10T11:00"),
      row("SFO", "HNL", "2018-04-10T10:00", "2018-04-10T15:00"),
      row("FRA", "LIS", "2019-05-10T10:00", "2019-05-10T13:00"),
    ];
    // 2018 discovers five airports; 2019 one.
    expect(foldFlightInsightStats(flights).flightNewAirportsYearMax).toBe(1);
  });

  it("counts a later year that discovered more", () => {
    const flights = [
      row("FRA", "MUC", "2018-01-10T10:00", "2018-01-10T11:00"),
      row("FRA", "JFK", "2019-01-10T10:00", "2019-01-10T18:00"),
      row("JFK", "LAX", "2019-02-10T10:00", "2019-02-10T16:00"),
    ];
    expect(foldFlightInsightStats(flights).flightNewAirportsYearMax).toBe(2);
  });

  it("has nothing to count with a single recorded year", () => {
    const flights = [row("FRA", "JFK", "2018-01-10T10:00", "2018-01-10T18:00")];
    expect(foldFlightInsightStats(flights).flightNewAirportsYearMax).toBe(0);
  });
});

describe("PORT_REUNION_3 counts port calls only", () => {
  const fromHamburg = (id: string, start: string, calls: ReturnType<typeof call>[]) =>
    cruise(id, start, start, "HAM", "HAM", calls);

  it("does not let the home port every cruise starts from earn it", () => {
    const rows = [
      fromHamburg("a", "2020-06-01", [call(2, "OSL", "2020-06-02")]),
      fromHamburg("b", "2021-06-01", [call(2, "BGO", "2021-06-02")]),
      fromHamburg("c", "2022-06-01", [call(2, "CPH", "2022-06-02")]),
    ];
    // The effective sequence (the stats list) sees Hamburg three times …
    expect(cruisesPerPort(rows)[0]).toMatchObject({
      portName: "Hamburg",
      cruiseIds: ["a", "b", "c"],
    });
    // … the badge does not.
    const ctx = { rows, toursVisible: false, linked: new Map(), userBirthday: undefined };
    expect(foldCruiseInsightStats(ctx).cruisePortCruisesMax).toBe(1);
  });

  it("counts a port called at on three cruises", () => {
    const rows = ["2020", "2021", "2022"].map((y, i) =>
      fromHamburg(`c${i}`, `${y}-06-01`, [call(2, "OSL", `${y}-06-02`)])
    );
    const ctx = { rows, toursVisible: false, linked: new Map(), userBirthday: undefined };
    expect(foldCruiseInsightStats(ctx).cruisePortCruisesMax).toBe(3);
  });
});
