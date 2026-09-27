import { describe, expect, it } from "vitest";
import { classifyWallClock } from "../wallClock";

// Cases from the shared vectors (backend/src/shared/time/vectors.json): the
// web only asks whether a typed time exists once, twice or not at all.
describe("classifyWallClock", () => {
  it.each([
    ["2027-03-28T02:30", "Europe/Berlin", "gap"],
    ["2027-03-28T01:59", "Europe/Berlin", "ok"],
    ["2027-03-28T03:00", "Europe/Berlin", "ok"],
    ["2027-10-31T02:30", "Europe/Berlin", "repeated"],
    ["2027-03-14T02:30", "America/New_York", "gap"],
    ["2027-11-07T01:30", "America/New_York", "repeated"],
    ["2027-10-03T02:30", "Australia/Sydney", "gap"],
    ["2027-04-04T02:30", "Australia/Sydney", "repeated"],
    ["2027-10-03T02:15", "Australia/Lord_Howe", "gap"],
    ["2027-04-04T01:45", "Australia/Lord_Howe", "repeated"],
    ["2011-12-30T12:00", "Pacific/Apia", "gap"],
    ["2014-10-26T01:30", "Europe/Moscow", "repeated"],
    ["2011-10-30T02:30", "Europe/Moscow", "ok"],
    ["2027-01-15T00:15", "Asia/Kolkata", "ok"],
  ])("%s in %s is %s", (local, zone, kind) => {
    expect(classifyWallClock(local, zone)).toBe(kind);
  });

  it("says nothing for an unknown zone or a string that is not a wall clock", () => {
    expect(classifyWallClock("2027-03-28T02:30", "Mars/Olympus")).toBeNull();
    expect(classifyWallClock("2027-03-28", "Europe/Berlin")).toBeNull();
  });
});
