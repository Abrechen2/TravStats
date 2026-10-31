import { describe, it, expect } from "@jest/globals";

import { anchorFromLocal, dueAnchorRange, isDue, MAX_LATENESS_MS } from "../due";

const H = 3_600_000;
const anchor = new Date("2026-11-10T12:00:00.000Z");

describe("isDue", () => {
  it("is due from anchor - lead until an hour later, and not before or after", () => {
    const dueAt = anchor.getTime() - 24 * H;
    expect(isDue(anchor, 24, new Date(dueAt - 1))).toBe(false);
    expect(isDue(anchor, 24, new Date(dueAt))).toBe(true);
    expect(isDue(anchor, 24, new Date(dueAt + MAX_LATENESS_MS))).toBe(true);
    expect(isDue(anchor, 24, new Date(dueAt + MAX_LATENESS_MS + 1))).toBe(false);
  });

  it("is never due once the anchor has passed (a 1 h lead missed by 90 minutes)", () => {
    expect(isDue(anchor, 1, new Date(anchor.getTime() + 1))).toBe(false);
  });

  it("a 15-minute cron hits a custom lead: some tick falls inside every hour of lateness", () => {
    const custom = 7;
    const dueAt = anchor.getTime() - custom * H;
    // Ticks at :00/:15/:30/:45; any 15 min of the window contains one.
    const ticks = Array.from({ length: 5 }, (_, i) => new Date(dueAt + i * 15 * 60 * 1000));
    expect(ticks.filter((t) => isDue(anchor, custom, t)).length).toBeGreaterThanOrEqual(4);
  });

  it("the query range covers exactly the anchors that can be due", () => {
    const now = new Date("2026-11-09T12:30:00.000Z");
    const { start, end } = dueAnchorRange(24, now);
    expect(end.getTime()).toBe(now.getTime() + 24 * H);
    expect(start.getTime()).toBe(end.getTime() - MAX_LATENESS_MS);
  });
});

describe("anchorFromLocal (DST)", () => {
  it("a wall time in the spring-forward gap moves to the next valid instant", () => {
    // Berlin 2026-03-29: 02:00 -> 03:00. 02:30 does not exist; 03:00 CEST is 01:00Z.
    expect(anchorFromLocal("2026-03-29", "02:30", "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T01:00:00.000Z"
    );
  });

  it("a repeated autumn hour is the earlier instant", () => {
    // Berlin 2026-10-25: 03:00 -> 02:00; 02:30 happens twice, the first is CEST (00:30Z).
    expect(anchorFromLocal("2026-10-25", "02:30", "Europe/Berlin").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z"
    );
  });

  it("the lead is subtracted in UTC, so a DST change in between does not shift it", () => {
    // 15:00 Berlin on 2026-03-29 is CEST (13:00Z); 24 h before is 13:00Z on the 28th, which is
    // 14:00 CET on the wall clock — not "15:00 the day before".
    const a = anchorFromLocal("2026-03-29", "15:00", "Europe/Berlin");
    expect(a.toISOString()).toBe("2026-03-29T13:00:00.000Z");
    const dueAt = new Date(a.getTime() - 24 * H);
    expect(dueAt.toISOString()).toBe("2026-03-28T13:00:00.000Z");
  });
});
