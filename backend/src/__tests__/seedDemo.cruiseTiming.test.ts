import { stopTimesForDay } from "../seedDemo/cruiseTiming";

/**
 * Finding B5 of the independent review of 2026-09-17: the narrated cruises
 * derived every stop's clock time from the EMBARKATION hour — day 0 plus n
 * days, at 16:00 because that is when the ship left — so the last stop of a
 * cruise that ends at 08:00 was recorded as arriving at 16:00 on the day the
 * passengers had already gone home, and departing nine hours after that.
 */
describe("stopTimesForDay", () => {
  const start = new Date("2024-05-11T16:00:00Z");
  const end = new Date("2024-05-17T08:00:00Z");

  it("puts a middle stop on its own day, not on the embarkation hour", () => {
    const { arrivalTime, departureTime } = stopTimesForDay(start, end, 2);
    expect(arrivalTime.toISOString()).toBe("2024-05-13T08:00:00.000Z");
    expect(departureTime.toISOString()).toBe("2024-05-13T17:00:00.000Z");
  });

  it("never puts a stop before the cruise begins", () => {
    // Day 0 is the embarkation day: the ship is not there at 08:00.
    const { arrivalTime, departureTime } = stopTimesForDay(start, end, 0);
    expect(arrivalTime.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(departureTime.getTime()).toBeGreaterThanOrEqual(arrivalTime.getTime());
  });

  it("never puts a stop after the cruise ends", () => {
    // The last stop of this itinerary is day 6, and the cruise ends at 08:00.
    const { arrivalTime, departureTime } = stopTimesForDay(start, end, 6);
    expect(arrivalTime.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(departureTime.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(departureTime.getTime()).toBeGreaterThanOrEqual(arrivalTime.getTime());
  });

  it("keeps every stop of an itinerary inside the cruise, whatever the hours are", () => {
    const evening = new Date("2025-07-05T18:00:00Z");
    const morning = new Date("2025-07-13T07:00:00Z");
    for (let day = 0; day < 8; day += 1) {
      const { arrivalTime, departureTime } = stopTimesForDay(evening, morning, day);
      expect(arrivalTime.getTime()).toBeGreaterThanOrEqual(evening.getTime());
      expect(departureTime.getTime()).toBeLessThanOrEqual(morning.getTime());
      expect(departureTime.getTime()).toBeGreaterThanOrEqual(arrivalTime.getTime());
    }
  });
});
