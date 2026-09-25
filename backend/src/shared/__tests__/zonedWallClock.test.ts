import { formatWallClockIn } from "../zonedWallClock";

/**
 * date-fns-tz 3.2.0's `formatInTimeZone` built the reading as a HOST-local
 * Date, so a reading inside the host's own spring-forward gap came back an
 * hour late. These cases run with the host in Europe/Berlin, whose 2025 gap
 * is 30 March 02:00–03:00, and ask for readings that land exactly there.
 */
describe("formatWallClockIn", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("reads 02:30 UTC as 02:30 even inside the host's DST gap", () => {
    expect(formatWallClockIn(new Date("2025-03-30T02:30:00Z"), "UTC")).toBe("2025-03-30T02:30:00");
  });

  it("reads Tokyo's 02:30 as 02:30 when the host is in its gap", () => {
    // 2025-03-29T17:30Z is 02:30 on 30 March in Tokyo (UTC+9, no DST).
    expect(formatWallClockIn(new Date("2025-03-29T17:30:00Z"), "Asia/Tokyo")).toBe(
      "2025-03-30T02:30:00"
    );
  });

  it("reads midnight as 00, not 24", () => {
    expect(formatWallClockIn(new Date("2025-06-01T00:00:00Z"), "UTC")).toBe("2025-06-01T00:00:00");
  });

  it("abstains for a zone the runtime rejects", () => {
    expect(formatWallClockIn(new Date("2025-06-01T00:00:00Z"), "Not/AZone")).toBeNull();
  });
});
