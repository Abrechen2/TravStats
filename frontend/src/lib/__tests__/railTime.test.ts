import { describe, it, expect } from "vitest";
import { formatStationClock, toStationWallClock } from "../railTime";

/** Rail times are read on the station's clock, never the viewer's. */
describe("railTime", () => {
  it("reads an instant back on the departure station's clock", () => {
    // 06:15 UTC is 08:15 in Frankfurt in July (CEST).
    expect(toStationWallClock("2026-07-01T06:15:00.000Z", "Europe/Berlin")).toBe(
      "2026-07-01T08:15"
    );
  });

  it("keeps two stations on their own clocks", () => {
    const instant = "2026-07-01T09:55:00.000Z";
    expect(toStationWallClock(instant, "Europe/London")).toBe("2026-07-01T10:55");
    expect(toStationWallClock(instant, "Europe/Paris")).toBe("2026-07-01T11:55");
  });

  it("falls back to UTC for a station without a zone, as the server stored it", () => {
    expect(toStationWallClock("2026-07-01T08:00:00.000Z", null)).toBe("2026-07-01T08:00");
  });

  it("gives an empty field for an unknown time", () => {
    expect(toStationWallClock(null, "Europe/Berlin")).toBe("");
  });

  it("formats the clock in the station's zone whatever the reader's", () => {
    expect(formatStationClock("2026-01-15T07:00:00.000Z", "Europe/Berlin", "de-DE")).toBe("08:00");
  });
});
