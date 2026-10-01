import { describe, expect, it } from "vitest";
import { rentalBandSegments } from "../rentalTimelineBands";
import type { TimelineEvent } from "../tripTimelineEvents";

/**
 * A rental is one band from its pickup entry to its return entry (owner,
 * 2026-10-01), passing everything in between; overlapping rentals get lanes.
 */
const rental = (id: string) => ({ id }) as never;
const pickup = (id: string) => ({ id: `p-${id}`, kind: "rental-pickup", rental: rental(id) });
const ret = (id: string) => ({ id: `r-${id}`, kind: "rental-return", rental: rental(id) });
const other = (id: string) => ({ id, kind: "journal" });
const events = (...list: object[]) => list as unknown as TimelineEvent[];

describe("rentalBandSegments", () => {
  it("runs one band from the pickup, past the entries between, to the return", () => {
    const parts = rentalBandSegments(
      events(other("a"), pickup("x"), other("b"), ret("x"), other("c"))
    );
    expect(parts.map((p) => p.map((s) => s.part))).toEqual([
      [],
      ["start"],
      ["through"],
      ["end"],
      [],
    ]);
    expect(parts.flat().every((s) => s.lane === 0)).toBe(true);
  });

  it("gives an overlapping rental its own lane and frees it at the return", () => {
    const parts = rentalBandSegments(
      events(pickup("x"), pickup("y"), ret("x"), pickup("z"), ret("y"), ret("z"))
    );
    expect(parts[1]).toEqual([
      { rentalId: "x", lane: 0, part: "through" },
      { rentalId: "y", lane: 1, part: "start" },
    ]);
    expect(parts[2]).toEqual([
      { rentalId: "x", lane: 0, part: "end" },
      { rentalId: "y", lane: 1, part: "through" },
    ]);
    // z takes the lane x left free.
    expect(parts[3]).toContainEqual({ rentalId: "z", lane: 0, part: "start" });
  });

  it("draws nothing for a return whose pickup is not on the timeline", () => {
    expect(rentalBandSegments(events(ret("x")))).toEqual([[]]);
  });
});
