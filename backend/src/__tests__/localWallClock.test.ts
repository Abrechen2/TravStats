import { localWallClockOf } from "../utils/timezone";

describe("localWallClockOf", () => {
  it("reads a real UTC instant on the clock at the airport", () => {
    // 07:00 Berlin summer time is 05:00 UTC. The traveller left in the
    // morning, not in the middle of the night.
    const clock = localWallClockOf(new Date("2026-07-01T05:00:00Z"), "Europe/Berlin", "UTC");
    expect(clock.hour).toBe(7);
    expect(clock.date).toBe("2026-07-01");
    expect(clock.year).toBe(2026);
    expect(clock.month).toBe(6);
  });

  it("keeps a departure on its local calendar day across the date line", () => {
    // Monday 00:30 in Tokyo is Sunday 15:30 UTC.
    const clock = localWallClockOf(new Date("2026-07-05T15:30:00Z"), "Asia/Tokyo", "UTC");
    expect(clock.date).toBe("2026-07-06");
    expect(clock.weekday).toBe(1); // Monday, matching Date#getDay
    expect(clock.hour).toBe(0);
  });

  it("files a late New York departure under the year the traveller flew", () => {
    // 22:30 on 31 December in New York is already 03:30 on 1 January UTC.
    const clock = localWallClockOf(new Date("2026-01-01T03:30:00Z"), "America/New_York", "UTC");
    expect(clock.year).toBe(2025);
    expect(clock.month).toBe(11);
    expect(clock.date).toBe("2025-12-31");
  });

  it("does not shift a legacy fake-UTC row a second time", () => {
    // A LEGACY_FAKE_UTC row stores the wall clock itself, encoded as UTC.
    // Converting it through the airport timezone would subtract the offset
    // again — the same double conversion that shifted AirLabs times.
    const clock = localWallClockOf(
      new Date("2020-05-01T10:30:00Z"),
      "Europe/Berlin",
      "LEGACY_FAKE_UTC"
    );
    expect(clock.hour).toBe(10);
    expect(clock.date).toBe("2020-05-01");
  });

  it("reports no hour for a date-only row but keeps its local date", () => {
    // DATE_ONLY stores a placeholder time for a recorded day. The date is real, the
    // time is not — so time-of-day buckets must skip it.
    const clock = localWallClockOf(
      new Date("2026-03-15T00:00:00Z"),
      "Pacific/Auckland",
      "DATE_ONLY"
    );
    expect(clock.hour).toBeNull();
    expect(clock.date).toBe("2026-03-15");
  });

  describe("a date-only row is its recorded calendar day, never a reading through a zone (forgejo#273)", () => {
    // DATE_ONLY stores 12:00Z of the day the user recorded. Read through a
    // zone at UTC+12 or beyond, that placeholder instant is already the NEXT
    // local day, so the flight moved a day - a month, a year - on every
    // statistic that asked for its date.
    it.each([
      ["Pacific/Auckland", "2020-06-30T12:00:00Z", "2020-06-30"], // NZST +12 -> local 00:00 next day
      ["Pacific/Auckland", "2025-12-31T12:00:00Z", "2025-12-31"], // NZDT +13 -> next year
      ["Pacific/Fiji", "2026-03-31T12:00:00Z", "2026-03-31"], // Suva / Nadi, +12
      ["Pacific/Kiritimati", "2026-09-01T12:00:00Z", "2026-09-01"], // +14
      ["Pacific/Honolulu", "2026-09-01T12:00:00Z", "2026-09-01"], // west of UTC: never moved
    ])("%s %s stays on %s", (zone, stored, day) => {
      const clock = localWallClockOf(new Date(stored), zone, "DATE_ONLY");
      expect(clock.date).toBe(day);
      expect(clock.hour).toBeNull();
    });

    it("derives year, month and weekday from the recorded day", () => {
      // 2025-12-31 is a Wednesday; read in Auckland (+13) it would be Thursday 1 January 2026.
      const clock = localWallClockOf(
        new Date("2025-12-31T12:00:00Z"),
        "Pacific/Auckland",
        "DATE_ONLY"
      );
      expect(clock.year).toBe(2025);
      expect(clock.month).toBe(11);
      expect(clock.day).toBe(31);
      expect(clock.weekday).toBe(3);
    });

    it("still reads a timed row in the same zone on the local clock", () => {
      // The fix is about the placeholder, not about Auckland: 12:00Z is
      // 01:00 next day there for a real instant, and that stays so.
      const clock = localWallClockOf(new Date("2025-12-31T12:00:00Z"), "Pacific/Auckland", "UTC");
      expect(clock.date).toBe("2026-01-01");
      expect(clock.hour).toBe(1);
    });
  });

  it("falls back to the stored UTC components when no timezone is known", () => {
    const clock = localWallClockOf(new Date("2026-07-01T05:00:00Z"), null, "UTC");
    expect(clock.hour).toBe(5);
    expect(clock.date).toBe("2026-07-01");
  });

  it("falls back to the stored UTC components when the timezone is unusable", () => {
    const clock = localWallClockOf(new Date("2026-07-01T05:00:00Z"), "Not/AZone", "UTC");
    expect(clock.hour).toBe(5);
    expect(clock.date).toBe("2026-07-01");
  });

  it("treats an untagged row as a real UTC instant, like the duration helper", () => {
    // UNKNOWN must not be read as legacy: that would wrongly shift the
    // API-imported real-UTC rows that dominate the untagged set.
    const clock = localWallClockOf(new Date("2026-07-01T05:00:00Z"), "Europe/Berlin");
    expect(clock.hour).toBe(7);
  });

  it("reports midnight as hour 0, never 24", () => {
    const clock = localWallClockOf(new Date("2026-07-01T22:00:00Z"), "Europe/Berlin", "UTC");
    expect(clock.hour).toBe(0);
    expect(clock.date).toBe("2026-07-02");
  });
});
