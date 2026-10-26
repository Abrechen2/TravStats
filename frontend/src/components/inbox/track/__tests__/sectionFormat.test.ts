import { describe, expect, it } from "vitest";
import {
  dayBarFor,
  formatDuration,
  formatKm,
  formatSpan,
  formatSpeed,
  linkDays,
  zoneOrUtc,
} from "../sectionFormat";

/** The section in words, on the question's own clock — never the browser's. */

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;
const at = (iso: string) => Date.parse(iso);

describe("sectionFormat", () => {
  it("reads a same-day window on the question's clock", () => {
    const w = { fromMs: at("2026-10-20T04:32:00Z"), untilMs: at("2026-10-20T06:02:00Z") };
    expect(formatSpan(w, "Europe/Berlin", t)).toBe(
      `track:inbox.value.sameDay ${JSON.stringify({ day: "20.10.", from: "06:32", until: "08:02" })}`
    );
  });

  it("names both days when the window crosses local midnight", () => {
    const w = { fromMs: at("2026-10-10T05:30:00Z"), untilMs: at("2026-10-11T00:10:00Z") };
    expect(formatSpan(w, "Asia/Seoul", t)).toBe(
      `track:inbox.value.days ${JSON.stringify({
        fromDay: "10.10.",
        from: "14:30",
        untilDay: "11.10.",
        until: "09:10",
      })}`
    );
  });

  it("D3: whole days end on the last day inside the window, not a day early at the end's clock", () => {
    // 24.09. 00:00 – 27.09. 00:00 local, three whole days.
    const w = { fromMs: at("2026-09-23T22:00:00Z"), untilMs: at("2026-09-26T22:00:00Z") };
    expect(formatSpan(w, "Europe/Berlin", t)).toBe(
      `track:inbox.value.wholeDays ${JSON.stringify({ fromDay: "24.09.", untilDay: "26.09." })}`
    );
    const one = { fromMs: at("2026-09-24T00:00:00Z"), untilMs: at("2026-09-25T00:00:00Z") };
    expect(formatSpan(one, "UTC", t)).toBe(
      `track:inbox.value.wholeDay ${JSON.stringify({ day: "24.09." })}`
    );
  });

  it("D3: a partial window ending at local midnight names that midnight", () => {
    const sameDay = { fromMs: at("2026-09-24T10:00:00Z"), untilMs: at("2026-09-25T00:00:00Z") };
    expect(formatSpan(sameDay, "UTC", t)).toBe(
      `track:inbox.value.sameDay ${JSON.stringify({ day: "24.09.", from: "10:00", until: "24:00" })}`
    );
    const days = { fromMs: at("2026-09-24T10:00:00Z"), untilMs: at("2026-09-27T00:00:00Z") };
    expect(formatSpan(days, "UTC", t)).toBe(
      `track:inbox.value.days ${JSON.stringify({
        fromDay: "24.09.",
        from: "10:00",
        untilDay: "27.09.",
        until: "00:00",
      })}`
    );
  });

  it("D3: whole days across a DST change are still whole days", () => {
    // 24.10. 00:00 – 27.10. 00:00 in Berlin; summer time ends on the 25th (a 25-hour day).
    const w = { fromMs: at("2026-10-23T22:00:00Z"), untilMs: at("2026-10-26T23:00:00Z") };
    expect(formatSpan(w, "Europe/Berlin", t)).toBe(
      `track:inbox.value.wholeDays ${JSON.stringify({ fromDay: "24.10.", untilDay: "26.10." })}`
    );
  });

  it("a zone the runtime does not know reads as UTC", () => {
    expect(zoneOrUtc("Mars/Olympus")).toBe("UTC");
    expect(zoneOrUtc(null)).toBe("UTC");
    expect(zoneOrUtc("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("durations in minutes, hours, then days", () => {
    expect(formatDuration(45 * 60_000, t)).toBe(`track:inbox.value.minutes {"m":45}`);
    expect(formatDuration(18 * 3_600_000 + 40 * 60_000, t)).toBe(
      `track:inbox.value.hours {"h":18,"m":40}`
    );
    expect(formatDuration(76 * 3_600_000, t)).toBe(`track:inbox.value.daysHours {"d":3,"h":4}`);
  });

  it("abstains: no distance and no speed read —", () => {
    expect(formatKm(null, "de", t)).toBe("track:inbox.value.none");
    expect(formatSpeed(null, null, "de", t)).toBe("track:inbox.value.none");
    expect(formatKm(12_340, "de", t)).toBe(`track:inbox.value.km {"km":"12"}`);
    expect(formatKm(1_234, "de", t)).toBe(`track:inbox.value.km {"km":"1,2"}`);
  });

  it("the day bar marks a same-day window and stays away from a multi-day one", () => {
    const sameDay = { fromMs: at("2026-10-20T06:00:00Z"), untilMs: at("2026-10-20T12:00:00Z") };
    expect(dayBarFor(sameDay, "UTC")).toEqual({ left: 25, width: 25 });
    const toMidnight = { fromMs: at("2026-10-20T18:00:00Z"), untilMs: at("2026-10-21T00:00:00Z") };
    expect(dayBarFor(toMidnight, "UTC")).toEqual({ left: 75, width: 25 });
    const twoDays = { fromMs: at("2026-10-20T18:00:00Z"), untilMs: at("2026-10-21T06:00:00Z") };
    expect(dayBarFor(twoDays, "UTC")).toBeNull();
  });

  it("the Track-map link opens the days on the profile's clock, end exclusive", () => {
    const w = { fromMs: at("2026-10-20T00:00:00Z"), untilMs: at("2026-10-22T00:00:00Z") };
    expect(linkDays(w, "UTC")).toEqual({ fromDay: "2026-10-20", toDay: "2026-10-21" });
    expect(linkDays(w, "America/New_York")).toEqual({
      fromDay: "2026-10-19",
      toDay: "2026-10-21",
    });
  });
});
