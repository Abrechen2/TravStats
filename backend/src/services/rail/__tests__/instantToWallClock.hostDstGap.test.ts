import { instantToWallClock } from "../railJourneyWrite";

/**
 * Rail read a stored instant back through `formatInTimeZone`, which builds the
 * reading as a HOST-local Date: with the host in Europe/Berlin, a 02:30 reading
 * inside Berlin's own spring-forward gap came back as 03:30 and the edit form
 * seeded that hour. It reads through `shared/zonedWallClock.ts` now.
 */
describe("instantToWallClock", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("reads a UTC-zoned 02:30 as 02:30 while the host is in its DST gap", () => {
    expect(instantToWallClock(new Date("2025-03-30T02:30:00Z"), "UTC")).toBe("2025-03-30T02:30");
  });

  it("reads a station without a zone as UTC", () => {
    expect(instantToWallClock(new Date("2025-03-30T02:30:00Z"), null)).toBe("2025-03-30T02:30");
  });

  it("reads a zone the runtime rejects as UTC instead of throwing", () => {
    expect(instantToWallClock(new Date("2025-06-01T08:15:00Z"), "Not/AZone")).toBe(
      "2025-06-01T08:15"
    );
  });
});
