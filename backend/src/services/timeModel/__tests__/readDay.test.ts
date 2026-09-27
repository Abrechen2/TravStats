import { birthdayOf, readDay } from "../readDay";

/**
 * The read side's one reader of day columns (ADR 0002 phase 4): a `DATE` as
 * `YYYY-MM-DD`, a legacy anchor by the backfill's rule — never through a
 * host-local getter. The odd-zone CI runs this file under Kiritimati and
 * St. John's as well, where a `getDate()` would move each of these days.
 */
describe("readDay", () => {
  it("reads a DATE column as its day, with the zone it belongs to", () => {
    expect(readDay(new Date("2027-05-02T00:00:00.000Z"), null, "Asia/Tokyo")).toEqual({
      date: "2027-05-02",
      zone: "Asia/Tokyo",
      precision: "day",
    });
  });

  it("reads a legacy anchor a host east of UTC wrote as the next UTC date", () => {
    // `new Date("2019-05-02T00:00")` on a host at UTC+2 stored 22:00Z the day before.
    expect(readDay(null, new Date("2019-05-01T22:00:00.000Z"), null)?.date).toBe("2019-05-02");
  });

  it("keeps an anchor it cannot place without guessing, marked unknown", () => {
    expect(readDay(null, new Date("2019-05-01T10:30:00.000Z"), null)).toEqual({
      date: "2019-05-01",
      zone: null,
      precision: "unknown",
    });
  });
});

describe("birthdayOf", () => {
  it("reads the birthday as a floating date from birth_day, else the legacy anchor", () => {
    expect(birthdayOf({ birthDay: new Date("1990-01-01T00:00:00.000Z") })).toEqual({
      month: 1,
      day: 1,
    });
    // The birthday route wrote UTC noon on purpose.
    expect(birthdayOf({ birthdate: new Date("1990-12-31T12:00:00.000Z") })).toEqual({
      month: 12,
      day: 31,
    });
    expect(birthdayOf(null)).toBeUndefined();
  });
});
