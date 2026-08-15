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

  it("puts a time-less check-in AFTER the flight that arrived that day", () => {
    // Found on the owner's Madagascar trip: the hotel in Antananarivo appeared
    // above the flight that brought him there. A stay carries no time of day,
    // so it is stored at midnight — which this comparator read as 00:00, the
    // earliest moment of the day, rather than as "unknown".
    const events = [
      { date: "2026-05-19T00:00:00.000Z", kind: "lodging-checkin", id: "hotel" },
      { date: "2026-05-19T02:55:00.000Z", kind: "flight", id: "ADD-TNR" },
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["ADD-TNR", "hotel"]);
  });

  it("puts a time-less check-out BEFORE that day's departure", () => {
    // The mirror case: you leave the hotel in the morning and fly on. Ordering
    // by kind only works if it runs in the direction the day actually runs.
    const events = [
      { date: "2026-06-02T08:50:00.000Z", kind: "flight", id: "TNR-ADD" },
      { date: "2026-06-02T00:00:00.000Z", kind: "lodging-checkout", id: "hotel" },
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["hotel", "TNR-ADD"]);
  });

  it("respects a check-in that DOES carry a time", () => {
    // The kind-based rule is a fallback for missing information, not an
    // override. A stay checked in at 09:00 belongs before an 18:00 flight.
    const events = [
      { date: "2026-05-19T18:00:00.000Z", kind: "flight", id: "abends" },
      { date: "2026-05-19T09:00:00.000Z", kind: "lodging-checkin", id: "frueh" },
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["frueh", "abends"]);
  });

  it("still keeps a diary entry after a time-less check-in", () => {
    const events = [
      { date: "2026-05-19T00:00:00.000Z", kind: "journal", id: "tagebuch" },
      { date: "2026-05-19T00:00:00.000Z", kind: "lodging-checkin", id: "hotel" },
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["hotel", "tagebuch"]);
  });

  it("does not reorder across days", () => {
    // A check-out on the 2nd must not be dragged before a check-in on the 1st.
    const events = [
      { date: "2026-05-02T00:00:00.000Z", kind: "lodging-checkout", id: "zweiter" },
      { date: "2026-05-01T00:00:00.000Z", kind: "lodging-checkin", id: "erster" },
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["erster", "zweiter"]);
  });
});
