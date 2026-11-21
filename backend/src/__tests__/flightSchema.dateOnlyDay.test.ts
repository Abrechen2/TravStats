import { createFlightSchema, updateFlightSchema } from "../schemas/flight";
import { toUtcDate } from "../services/flights/mergedChronology";
import { localDay } from "../shared/time/instant";

/**
 * GitHub #403: `departureLocal` refused a plain `YYYY-MM-DD`, so a date-only
 * flight could not be written without inventing a time — and the API callers who
 * wrote midnight UTC by hand put the flight on the previous day west of UTC.
 * A bare day is now accepted WITH `DATE_ONLY` and stored as the form's noon.
 */
const base = {
  departure: { iata: "HNL", lat: 21.32, lon: -157.92 },
  arrival: { iata: "LIH", lat: 21.97, lon: -159.34 },
  status: "historical",
  depTimezone: "Pacific/Honolulu",
  arrTimezone: "Pacific/Honolulu",
};

describe("a bare YYYY-MM-DD in departureLocal / arrivalLocal (#403)", () => {
  it("is accepted with DATE_ONLY on create and becomes the local noon anchor", () => {
    const data = createFlightSchema.parse({
      ...base,
      departureLocal: "2025-12-31",
      arrivalLocal: "2025-12-31",
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
    });
    expect(data.departureLocal).toBe("2025-12-31T12:00");
    expect(data.arrivalLocal).toBe("2025-12-31T12:00");
    const stored = toUtcDate(data.departureLocal, data.depTimezone)!;
    expect(stored.toISOString()).toBe("2025-12-31T22:00:00.000Z");
    // the day it reads back on is the day that was sent, not the one before
    expect(localDay(stored, "Pacific/Honolulu")).toBe("2025-12-31");
  });

  it("is accepted on update, one end at a time", () => {
    const data = updateFlightSchema.parse({
      departureLocal: "2026-01-08",
      depTimezone: "Pacific/Honolulu",
      depTimeSemantics: "DATE_ONLY",
    });
    expect(data.departureLocal).toBe("2026-01-08T12:00");
  });

  it("is still refused without DATE_ONLY — a day is not a clock a flight can be timed by", () => {
    const r = createFlightSchema.safeParse({
      ...base,
      departureLocal: "2025-12-31",
      arrivalLocal: "2025-12-31T18:00",
    });
    expect(r.success).toBe(false);
  });

  it("refuses a day that is not on the calendar", () => {
    const r = createFlightSchema.safeParse({
      ...base,
      departureLocal: "2026-02-30",
      arrivalLocal: "2026-02-30",
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
    });
    expect(r.success).toBe(false);
  });
});
