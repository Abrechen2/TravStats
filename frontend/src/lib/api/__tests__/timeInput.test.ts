import { describe, expect, it } from "vitest";
import { MissingZoneError, dayInput, wallClockInput, zoneSourceOf } from "../timeInput";

describe("timeInput — the write shape of a time (ADR 0002, D3)", () => {
  it("prefers the zone a pick carries, else its reference, else nothing", () => {
    expect(zoneSourceOf({ timezone: "Asia/Tokyo", ref: { kind: "port", id: "7" } })).toEqual({
      zone: "Asia/Tokyo",
    });
    expect(zoneSourceOf({ timezone: null, ref: { kind: "port", id: "7" } })).toEqual({
      placeRef: { kind: "port", id: "7" },
    });
    expect(zoneSourceOf({ timezone: "Mars/Olympus", ref: { kind: "place", id: "p" } })).toEqual({
      placeRef: { kind: "place", id: "p" },
    });
    expect(zoneSourceOf({ timezone: null })).toBeNull();
  });

  it("sends {local, zone} or {local, placeRef}, fold only when later", () => {
    expect(wallClockInput("t", "2027-10-31", "02:30", { zone: "Europe/Berlin" })).toEqual({
      local: "2027-10-31T02:30",
      zone: "Europe/Berlin",
    });
    expect(
      wallClockInput("t", "2027-10-31", "02:30", { placeRef: { kind: "place", id: "p" } }, "later")
    ).toEqual({ local: "2027-10-31T02:30", placeRef: { kind: "place", id: "p" }, fold: "later" });
  });

  it("a day without a time stays a day; no day is null", () => {
    expect(wallClockInput("t", "2027-05-02", "", null)).toBe("2027-05-02");
    expect(wallClockInput("t", "", "10:00", { zone: "UTC" })).toBeNull();
    expect(dayInput("2027-05-02")).toBe("2027-05-02");
    expect(dayInput("02.05.2027")).toBeNull();
  });

  it("refuses a time whose place brings no zone source instead of assuming UTC", () => {
    expect(() => wallClockInput("visitedAt", "2027-05-02", "10:00", null)).toThrow(
      MissingZoneError
    );
  });
});
