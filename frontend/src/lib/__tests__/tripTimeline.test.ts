import { describe, it, expect } from "vitest";
import {
  compareTimelineEvents,
  dayAsTimeValue,
  formatTimelineDate,
  hasExplicitTime,
  splitTimeValue,
} from "../tripTimeline";
import type { TimeValue } from "../../shared/time";

/** A value at a place: its wall clock, and the instant (default: the same clock read as UTC). */
const at = (local: string, utc = `${local}.000Z`): TimeValue => ({
  utc,
  zone: "Europe/Berlin",
  offset: "+02:00",
  local,
  precision: "minute",
});
const day = (date: string): TimeValue => dayAsTimeValue({ date, zone: null, precision: "day" });

describe("splitTimeValue", () => {
  it("fills the form from the place's clock", () => {
    expect(splitTimeValue(at("2026-05-01T14:30:00"))).toEqual({
      date: "2026-05-01",
      time: "14:30",
    });
  });

  it("leaves the time empty for a value without a time of day, not 00:00", () => {
    expect(splitTimeValue(day("2026-05-01"))).toEqual({ date: "2026-05-01", time: "" });
  });

  it("returns empty fields for a missing value", () => {
    expect(splitTimeValue(null)).toEqual({ date: "", time: "" });
  });
});

describe("hasExplicitTime", () => {
  it("is false for a day-only value", () => {
    expect(hasExplicitTime(day("2026-05-01"))).toBe(false);
  });

  it("is true for a minute-precise value, even at midnight", () => {
    expect(hasExplicitTime(at("2026-05-01T00:00:00"))).toBe(true);
    expect(hasExplicitTime(at("2026-05-01T14:30:00"))).toBe(true);
  });
});

describe("formatTimelineDate", () => {
  it("shows the date alone when no time was given", () => {
    expect(formatTimelineDate(day("2026-05-01"))).toBe("01.05.2026");
  });

  it("appends the place's clock, never the reader's", () => {
    // The instant is 12:30Z; the place said 14:30, and 14:30 is what is shown.
    expect(formatTimelineDate(at("2026-05-01T14:30:00", "2026-05-01T12:30:00.000Z"))).toBe(
      "01.05.2026 14:30"
    );
  });
});

describe("compareTimelineEvents", () => {
  const ev = (local: string, kind = "stop", id = local) => ({ when: at(local), kind, id });
  const dayEv = (date: string, kind: string, id: string) => ({ when: day(date), kind, id });

  it("orders by time within a day — the ordering #175 asked for", () => {
    const events = [
      ev("2026-05-01T18:00:00"),
      ev("2026-05-01T09:00:00"),
      ev("2026-05-01T13:00:00"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.when.local.slice(11, 16))).toEqual([
      "09:00",
      "13:00",
      "18:00",
    ]);
  });

  it("puts a diary entry last on its own day", () => {
    const events = [
      dayEv("2026-05-01", "journal", "j"),
      ev("2026-05-01T09:00:00"),
      ev("2026-05-01T18:00:00"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.kind)).toEqual([
      "stop",
      "stop",
      "journal",
    ]);
  });

  it("does NOT drag a diary entry across days", () => {
    const events = [ev("2026-05-02T09:00:00"), dayEv("2026-05-01", "journal", "j")];
    expect(events.sort(compareTimelineEvents).map((e) => e.kind)).toEqual(["journal", "stop"]);
  });

  it("keeps two day-only entries of one day in their original order", () => {
    const events = [dayEv("2026-05-01", "stop", "first"), dayEv("2026-05-01", "stop", "second")];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["first", "second"]);
  });

  it("puts a time-less check-in AFTER the flight that arrived that day", () => {
    // The owner's Madagascar trip: the hotel appeared above the flight that
    // brought him there, because a day read as 00:00.
    const events = [
      dayEv("2026-05-19", "lodging-checkin", "hotel"),
      ev("2026-05-19T05:55:00", "flight", "ADD-TNR"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["ADD-TNR", "hotel"]);
  });

  it("puts a time-less check-out BEFORE that day's departure", () => {
    const events = [
      ev("2026-06-02T11:50:00", "flight", "TNR-ADD"),
      dayEv("2026-06-02", "lodging-checkout", "hotel"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["hotel", "TNR-ADD"]);
  });

  it("respects a check-in that DOES carry a time", () => {
    const events = [
      ev("2026-05-19T18:00:00", "flight", "abends"),
      ev("2026-05-19T09:00:00", "lodging-checkin", "frueh"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["frueh", "abends"]);
  });

  it("still keeps a diary entry after a time-less check-in", () => {
    const events = [
      dayEv("2026-05-19", "journal", "tagebuch"),
      dayEv("2026-05-19", "lodging-checkin", "hotel"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["hotel", "tagebuch"]);
  });

  it("does not reorder across days", () => {
    const events = [
      dayEv("2026-05-02", "lodging-checkout", "zweiter"),
      dayEv("2026-05-01", "lodging-checkin", "erster"),
    ];
    expect(events.sort(compareTimelineEvents).map((e) => e.id)).toEqual(["erster", "zweiter"]);
  });
});
