import { serializeDay, serializeTime } from "../../../shared/time/wire";
import { toInstant } from "../../../shared/time/instant";
import {
  addDays,
  boundsOfDaySpan,
  boundsOfInstants,
  boundsOfNights,
  endOfBounds,
} from "../eventBounds";

/**
 * From an entry's `times` to calendar bounds (forgejo#310): instants in UTC,
 * day values on the PLACE's calendar day, and nothing for a value vaguer than
 * a day — abstention, never a placeholder drawn as a date.
 */

const at = (local: string, zone: string, precision: "minute" | "day" | "unknown" = "minute") =>
  serializeTime(toInstant(local, zone, { origin: "machine" }).utc, zone, precision);

describe("calendar event bounds", () => {
  it("keeps a timed journey's real instants", () => {
    const dep = at("2030-06-01T08:00", "Europe/Berlin");
    const arr = at("2030-06-01T10:30", "Europe/London");
    expect(boundsOfInstants(dep, arr)).toEqual({
      kind: "timed",
      start: new Date("2030-06-01T06:00:00.000Z"),
      end: new Date("2030-06-01T09:30:00.000Z"),
    });
  });

  it("drops an arrival that is not a later instant rather than inventing a length", () => {
    const dep = at("2030-06-01T08:00", "Europe/Berlin");
    expect(boundsOfInstants(dep, at("2030-06-01T07:00", "Europe/Berlin"))).toMatchObject({
      end: null,
    });
    expect(boundsOfInstants(dep, at("2030-06-02T00:00", "Europe/Berlin", "day"))).toMatchObject({
      end: null,
    });
    expect(boundsOfInstants(dep, null)).toMatchObject({ end: null });
  });

  it("puts a date-only ride on its station's day, not the UTC date", () => {
    // Start of 2 June in Tokyo is 1 June 15:00 UTC: the UTC date is a day early.
    const dep = at("2030-06-02T00:00", "Asia/Tokyo", "day");
    const arr = at("2030-06-03T00:00", "Asia/Tokyo", "day");
    expect(boundsOfInstants(dep, arr)).toEqual({
      kind: "allDay",
      start: "2030-06-02",
      endExclusive: "2030-06-04",
    });
    expect(boundsOfInstants(dep, null)).toEqual({
      kind: "allDay",
      start: "2030-06-02",
      endExclusive: "2030-06-03",
    });
  });

  it("leaves out an entry whose start is not known to the day", () => {
    expect(boundsOfInstants(at("2030-06-01T00:00", "UTC", "unknown"), null)).toBeNull();
    expect(boundsOfInstants(null, at("2030-06-01T08:00", "UTC"))).toBeNull();
    expect(boundsOfDaySpan(serializeDay("2030-06-01", null, "month"), null)).toBeNull();
    expect(boundsOfNights(serializeDay("2030-01-01", "Europe/Berlin", "year"), null)).toBeNull();
    expect(boundsOfNights(null, serializeDay("2030-06-03", null))).toBeNull();
  });

  it("covers a span of days inclusively", () => {
    expect(
      boundsOfDaySpan(serializeDay("2030-06-01", "Europe/Rome"), serializeDay("2030-06-08", null))
    ).toEqual({ kind: "allDay", start: "2030-06-01", endExclusive: "2030-06-09" });
    // An end before the start is not believed: the first day stands alone.
    expect(
      boundsOfDaySpan(serializeDay("2030-06-08", null), serializeDay("2030-06-01", null))
    ).toEqual({ kind: "allDay", start: "2030-06-08", endExclusive: "2030-06-09" });
  });

  it("draws a stay as its nights: the check-out day excluded, a same-day stay one day", () => {
    expect(
      boundsOfNights(serializeDay("2030-06-01", null), serializeDay("2030-06-04", null))
    ).toEqual({ kind: "allDay", start: "2030-06-01", endExclusive: "2030-06-04" });
    expect(
      boundsOfNights(serializeDay("2030-06-01", null), serializeDay("2030-06-01", null))
    ).toEqual({ kind: "allDay", start: "2030-06-01", endExclusive: "2030-06-02" });
    expect(boundsOfNights(serializeDay("2030-06-01", null), null)).toEqual({
      kind: "allDay",
      start: "2030-06-01",
      endExclusive: "2030-06-02",
    });
  });

  it("counts days across month and year ends", () => {
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    expect(addDays("2032-02-28", 1)).toBe("2032-02-29");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
  });

  it("measures the end of an event for the look-back window", () => {
    const start = new Date("2030-06-01T06:00:00Z");
    expect(endOfBounds({ kind: "timed", start, end: null })).toEqual(start);
    expect(
      endOfBounds({ kind: "allDay", start: "2030-06-01", endExclusive: "2030-06-04" })
    ).toEqual(new Date("2030-06-04T00:00:00Z"));
  });
});
