import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitZonedDatetime } from "../editModalDatetime";

/**
 * The edit modal seeded its date/time fields with `formatInTimeZone`, which
 * is an hour late whenever the airport's reading falls into the BROWSER's own
 * spring-forward gap. With the browser in Europe/Berlin (gap 30 March 2025,
 * 02:00–03:00), a 02:30 departure elsewhere was shown — and re-saved — as 03:30.
 */
describe("splitZonedDatetime with the browser in a DST gap", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("shows Tokyo's 02:30 as 02:30", () => {
    expect(splitZonedDatetime("2025-03-29T17:30:00Z", "Asia/Tokyo")).toEqual({
      date: "2025-03-30",
      time: "02:30",
    });
  });

  it("shows UTC's 02:30 as 02:30", () => {
    expect(splitZonedDatetime("2025-03-30T02:30:00Z", "UTC")).toEqual({
      date: "2025-03-30",
      time: "02:30",
    });
  });
});
