import { describe, it, expect } from "vitest";
import {
  formatRailSpan,
  formatStationClock,
  formatStationTime,
  railDurationMinutes,
  toStationWallClock,
} from "../railTime";
import type { TimeValue } from "../../shared/time";
import type { RailJourney } from "../../types/rail";

const station = (utc: string, zone: string, offset: string, local: string): TimeValue => ({
  utc,
  zone,
  offset,
  local,
  precision: "minute",
});

/** Rail times are read on the station's clock, never the viewer's. */
describe("railTime", () => {
  it("fills a datetime-local input from the station's clock", () => {
    const dep = station(
      "2026-07-01T06:15:00.000Z",
      "Europe/Berlin",
      "+02:00",
      "2026-07-01T08:15:00"
    );
    expect(toStationWallClock(dep)).toBe("2026-07-01T08:15");
  });

  it("gives an empty field for an unknown time", () => {
    expect(toStationWallClock(null)).toBe("");
  });

  it("shows the station's clock from the server's `local`, not from `utc`", () => {
    // `utc` says 07:00Z; the station said 08:00. The screen shows 08:00.
    const value = station(
      "2026-01-15T07:00:00.000Z",
      "Europe/Berlin",
      "+01:00",
      "2026-01-15T08:00:00"
    );
    expect(formatStationClock(value, "de-DE")).toBe("08:00");
    expect(formatStationTime(value, "de-DE")).toBe("15.01.2026, 08:00");
  });

  it("labels a station without a known zone as UTC instead of passing it off as local", () => {
    const value: TimeValue = {
      utc: "2026-01-15T07:00:00.000Z",
      zone: null,
      offset: "+00:00",
      local: "2026-01-15T07:00:00",
      precision: "minute",
    };
    expect(formatStationClock(value, "de-DE")).toBe("07:00 UTC");
  });

  it("measures the ride across a zone border from the instants", () => {
    const dep = station(
      "2026-07-01T09:01:00.000Z",
      "Europe/London",
      "+01:00",
      "2026-07-01T10:01:00"
    );
    const arr = station(
      "2026-07-01T11:47:00.000Z",
      "Europe/Paris",
      "+02:00",
      "2026-07-01T13:47:00"
    );
    expect(railDurationMinutes(dep, arr)).toBe(166);
    expect(railDurationMinutes(dep, null)).toBeNull();
  });

  // forgejo#132 item 17: a ride logged date-only is stored at the starts of
  // its days. Measured, "5th to 6th" would read as 24 h on board.
  it("has no duration for a ride logged with its days only", () => {
    const day = (utc: string, local: string): TimeValue => ({
      ...station(utc, "Europe/Berlin", "+01:00", local),
      precision: "day",
    });
    const dep = day("2026-03-04T23:00:00.000Z", "2026-03-05T00:00:00");
    const arr = day("2026-03-05T23:00:00.000Z", "2026-03-06T00:00:00");
    expect(railDurationMinutes(dep, arr)).toBeNull();
    // One clocked end is not enough either.
    const clocked = station(
      "2026-03-05T07:00:00.000Z",
      "Europe/Berlin",
      "+01:00",
      "2026-03-05T08:00:00"
    );
    expect(railDurationMinutes(clocked, arr)).toBeNull();
    expect(railDurationMinutes(dep, clocked)).toBeNull();
  });

  it("reads an older payload without `times` on each station's own clock", () => {
    const journey = {
      departureTime: "2026-07-01T09:01:00.000Z",
      arrivalTime: "2026-07-01T11:47:00.000Z",
      depTimezone: "Europe/London",
      arrTimezone: "Europe/Paris",
    } as Pick<RailJourney, "departureTime" | "arrivalTime" | "depTimezone" | "arrTimezone">;
    expect(formatRailSpan(journey, "de-DE")).toBe("01.07.2026, 10:01 – 13:47");
  });
});
