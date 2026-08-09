import { describe, it, expect } from "vitest";
import { groupByDay } from "./galleryGrouping";

/**
 * Timestamps are pinned to midday UTC on purpose: grouping uses the viewer's
 * local calendar day, and midday keeps every realistic test/CI timezone on the
 * same date, so these assertions do not depend on where they run.
 */
const at = (day: string, hour = 12) => ({
  id: `${day}-${hour}`,
  takenAt: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
});

describe("groupByDay", () => {
  it("puts photos from the same day into one group", () => {
    const groups = groupByDay([at("2026-05-01", 9), at("2026-05-01", 14)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].assets).toHaveLength(2);
  });

  it("splits consecutive days into separate groups, keeping the incoming order", () => {
    const groups = groupByDay([at("2026-05-01"), at("2026-05-02"), at("2026-05-03")]);
    expect(groups.map((g) => g.assets.length)).toEqual([1, 1, 1]);
    expect(groups[0].assets[0].id).toBe("2026-05-01-12");
    expect(groups[2].assets[0].id).toBe("2026-05-03-12");
  });

  it("keeps every photo — grouping must never drop one", () => {
    const input = [at("2026-05-01"), at("2026-05-02"), at("2026-05-02", 15), at("2026-05-04")];
    const total = groupByDay(input).reduce((n, g) => n + g.assets.length, 0);
    expect(total).toBe(input.length);
  });

  it("collects undated photos in a trailing group rather than dropping them", () => {
    const groups = groupByDay([at("2026-05-01"), { id: "nodate", takenAt: null }]);
    expect(groups).toHaveLength(2);
    expect(groups[1].day).toBeNull();
    expect(groups[1].assets[0].id).toBe("nodate");
  });

  it("returns no groups for an empty album", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("exposes the flat index of each photo so the lightbox still opens the right one", () => {
    // The lightbox is driven by a position in the ORIGINAL flat list; grouping
    // must not renumber it.
    const groups = groupByDay([at("2026-05-01"), at("2026-05-02"), at("2026-05-02", 15)]);
    expect(groups[0].assets[0].index).toBe(0);
    expect(groups[1].assets[0].index).toBe(1);
    expect(groups[1].assets[1].index).toBe(2);
  });
});
