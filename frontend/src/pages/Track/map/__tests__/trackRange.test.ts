import { describe, expect, it } from "vitest";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import {
  activePreset,
  presetRange,
  rangeDays,
  rangePath,
  readDays,
  stepRange,
  type DayResult,
} from "../trackRange";

/**
 * The Track map's range (plan T5.2): one day or seven, composed from day
 * reads with a bound on requests in flight — and a day that fails is a failed
 * day, never an empty one.
 */

const day = (date: string): TravTrackDay => ({
  date,
  zone: "Europe/Berlin",
  segments: [],
  coverage: [],
  context: [],
  pointCount: 1,
  truncated: false,
});

describe("trackRange", () => {
  it("seven days end at the range's day, oldest first", () => {
    expect(rangeDays({ end: "2026-10-25", length: 7 })).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(rangeDays({ end: "2026-03-01", length: 1 })).toEqual(["2026-03-01"]);
  });

  it("steps by the range's own length", () => {
    expect(stepRange({ end: "2026-10-25", length: 7 }, -1)).toEqual({
      end: "2026-10-18",
      length: 7,
    });
    expect(stepRange({ end: "2026-10-25", length: 1 }, 1).end).toBe("2026-10-26");
  });

  it("presets and their URLs keep /track/:date deep links", () => {
    const today = "2026-10-25";
    const current = { end: "2026-10-10", length: 1 as const };
    expect(presetRange("today", today, current)).toEqual({ end: today, length: 1 });
    expect(presetRange("yesterday", today, current)).toEqual({ end: "2026-10-24", length: 1 });
    expect(presetRange("week", today, current)).toEqual({ end: "2026-10-10", length: 7 });
    expect(rangePath({ end: today, length: 1 }, today)).toBe("/track");
    expect(rangePath({ end: "2026-10-10", length: 1 }, today)).toBe("/track/2026-10-10");
    expect(rangePath({ end: "2026-10-10", length: 7 }, today)).toBe("/track/2026-10-10?range=7");
    expect(activePreset({ end: "2026-10-10", length: 1 }, today)).toBeNull();
    expect(activePreset({ end: "2026-10-24", length: 1 }, today)).toBe("yesterday");
  });

  it("a failed day is a failed day with its reason; the others load", async () => {
    const days = rangeDays({ end: "2026-10-25", length: 7 });
    const heard: DayResult[] = [];
    const results = await readDays(
      days,
      async (date) => {
        if (date === "2026-10-22") throw new Error("boom");
        return day(date);
      },
      () => "track:errors.network",
      (r) => heard.push(r)
    );
    expect(results.map((r) => r.kind)).toEqual([
      "loaded",
      "loaded",
      "loaded",
      "failed",
      "loaded",
      "loaded",
      "loaded",
    ]);
    expect(results[3]).toEqual({ date: "2026-10-22", kind: "failed", key: "track:errors.network" });
    expect(heard).toHaveLength(7);
  });

  it("never has more than the limit of reads in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const days = rangeDays({ end: "2026-10-25", length: 7 });
    await readDays(
      days,
      async (date) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return day(date);
      },
      () => "x",
      undefined,
      3
    );
    expect(peak).toBe(3);
  });
});
