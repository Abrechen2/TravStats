import { describe, it, expect } from "vitest";
import {
  compareTimelineEvents,
  formatTimelineDate,
  hasExplicitTime,
  joinDateTimeInput,
  splitDateTimeInput,
  utcDayOf,
} from "../tripTimeline";

describe("splitDateTimeInput / joinDateTimeInput", () => {
  it("round-trips a wall-clock time unchanged", () => {
    const stored = joinDateTimeInput("2026-05-01", "14:30");
    expect(stored).toBe("2026-05-01T14:30:00.000Z");
    // What the user typed is what the form shows again — the whole point of
    // the timezone-naive model. A local-time round-trip would shift this.
    expect(splitDateTimeInput(stored)).toEqual({ date: "2026-05-01", time: "14:30" });
  });

  it("treats an empty time as 'no time given' (midnight UTC)", () => {
    expect(joinDateTimeInput("2026-05-01", "")).toBe("2026-05-01T00:00:00.000Z");
    // …and reads back as an empty time field, not "00:00".
    expect(splitDateTimeInput("2026-05-01T00:00:00.000Z")).toEqual({
      date: "2026-05-01",
      time: "",
    });
  });

  it("is null without a date, whatever the time says", () => {
    expect(joinDateTimeInput("", "14:30")).toBeNull();
    expect(joinDateTimeInput("   ", "")).toBeNull();
  });

  it("returns empty fields for a missing or unparseable value", () => {
    expect(splitDateTimeInput(null)).toEqual({ date: "", time: "" });
    expect(splitDateTimeInput("not a date")).toEqual({ date: "", time: "" });
  });
});

describe("hasExplicitTime", () => {
  it("is false at exactly midnight UTC — the date-only convention", () => {
    expect(hasExplicitTime("2026-05-01T00:00:00.000Z")).toBe(false);
  });

  it("is true for any other time of day", () => {
    expect(hasExplicitTime("2026-05-01T00:01:00.000Z")).toBe(true);
    expect(hasExplicitTime("2026-05-01T14:30:00.000Z")).toBe(true);
  });

  it("is false for missing/garbage input rather than throwing", () => {
    expect(hasExplicitTime(null)).toBe(false);
    expect(hasExplicitTime("nonsense")).toBe(false);
  });
});

describe("formatTimelineDate", () => {
  it("shows the date alone when no time was given", () => {
    expect(formatTimelineDate("2026-05-01T00:00:00.000Z", "de")).toBe("01.05.2026");
  });

  it("appends the time when there is one, rendered in UTC not the viewer's zone", () => {
    // The literal string matters: a viewer in Europe/Berlin must still read
    // 14:30, because 14:30 is what was typed at the place.
    expect(formatTimelineDate("2026-05-01T14:30:00.000Z", "de")).toBe("01.05.2026, 14:30");
  });

  it("falls back to the raw value instead of rendering 'Invalid Date'", () => {
    expect(formatTimelineDate("nope", "de")).toBe("nope");
  });
});

describe("utcDayOf", () => {
  it("groups by the UTC calendar day", () => {
    expect(utcDayOf("2026-05-01T23:59:00.000Z")).toBe("2026-05-01");
    expect(utcDayOf("2026-05-02T00:00:00.000Z")).toBe("2026-05-02");
  });
});

describe("compareTimelineEvents", () => {
  const ev = (date: string, kind = "stop") => ({ date, kind });

  it("orders by time within a day — the ordering #175 asked for", () => {
    const events = [
      ev("2026-05-01T18:00:00.000Z"),
      ev("2026-05-01T09:00:00.000Z"),
      ev("2026-05-01T13:00:00.000Z"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.date.slice(11, 16))).toEqual([
      "09:00",
      "13:00",
      "18:00",
    ]);
  });

  it("puts a diary entry last on its own day, even when its time is earliest", () => {
    const events = [
      ev("2026-05-01T08:00:00.000Z", "journal"),
      ev("2026-05-01T09:00:00.000Z"),
      ev("2026-05-01T18:00:00.000Z"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.kind)).toEqual([
      "stop",
      "stop",
      "journal",
    ]);
  });

  it("does NOT drag a diary entry across days", () => {
    // The rule is "last of ITS day", not "last overall" — a diary on the 1st
    // must still precede everything on the 2nd.
    const events = [
      ev("2026-05-02T09:00:00.000Z"),
      ev("2026-05-01T23:00:00.000Z", "journal"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.date.slice(0, 10))).toEqual([
      "2026-05-01",
      "2026-05-02",
    ]);
  });

  it("keeps two diary entries on one day in their original order", () => {
    const first = { date: "2026-05-01T00:00:00.000Z", kind: "journal", id: "a" };
    const second = { date: "2026-05-01T00:00:00.000Z", kind: "journal", id: "b" };
    expect([first, second].sort(compareTimelineEvents).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("leaves time-less stops in the order the backend returned them", () => {
    // Both midnight: the comparator returns 0 and sort is stable, so orderIdx
    // (the backend's ordering) survives.
    const a = { date: "2026-05-01T00:00:00.000Z", kind: "stop", id: "first" };
    const b = { date: "2026-05-01T00:00:00.000Z", kind: "stop", id: "second" };
    expect([a, b].sort(compareTimelineEvents).map((e) => e.id)).toEqual(["first", "second"]);
  });
});
