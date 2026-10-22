import { describe, it, expect } from "@jest/globals";
import { calculateCruiseStats, type CruiseData } from "../cruiseStats";

/** An eight-day ocean cruise (1.–8. May) with three sea days. */
function cruise(countSeaDays?: boolean, kind: "ocean" | "river" = "ocean"): CruiseData {
  return {
    id: `c-${String(countSeaDays)}-${kind}`,
    kind,
    shipId: null,
    cruiseLine: null,
    cabinType: null,
    deck: null,
    startDate: new Date("2024-05-01T00:00:00Z"),
    endDate: new Date("2024-05-08T00:00:00Z"),
    stops: [2, 3, 4].map((dayNumber) => ({ portId: null, port: null, dayNumber, isAtSea: true })),
    ...(countSeaDays !== undefined && { countSeaDays }),
  };
}

/**
 * "Seetage zählen" (forgejo#321): with the account's answer "no", the day
 * total leaves the sea days out. The sea-day figures themselves stay — they
 * name sea days, and the setting is about the total that counts days.
 */
describe("calculateCruiseStats — sea days in the day total", () => {
  it("counts every day of the span by default, as before the setting", () => {
    expect(calculateCruiseStats([cruise()]).totalCruiseDays).toBe(8);
    expect(calculateCruiseStats([cruise(true)]).totalCruiseDays).toBe(8);
  });

  it("leaves the sea days out of the total when they are not counted", () => {
    const s = calculateCruiseStats([cruise(false)]);
    expect(s.totalCruiseDays).toBe(5);
    expect(s.seaDays).toBe(3);
  });

  it("subtracts only true sea days — a river cruise's portless days were never any", () => {
    expect(calculateCruiseStats([cruise(false, "river")]).totalCruiseDays).toBe(8);
  });

  it("never lets a cruise with more sea days than dates drive the total negative", () => {
    const crowded: CruiseData = {
      ...cruise(false),
      endDate: new Date("2024-05-02T00:00:00Z"),
    };
    const s = calculateCruiseStats([crowded, cruise(false)]);
    expect(s.totalCruiseDays).toBe(5);
  });
});
