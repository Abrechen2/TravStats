/**
 * Owner ask (2026-08-20): the stay lifecycle status must be visible in the
 * lodging list like the flights table shows flight status. These pin the
 * row-level derivation and the status sort order.
 */
import { describe, it, expect } from "vitest";
import { lodgingLifecycleRank, lodgingLifecycleStatus } from "../lodgingLifecycle";
import type { LodgingStay, StayStatus } from "../../../types/lodging";

const stay = (status: StayStatus): LodgingStay => ({ status }) as unknown as LodgingStay;

describe("lodgingLifecycleStatus", () => {
  it("prefers a running stay over everything else", () => {
    expect(
      lodgingLifecycleStatus([stay("completed"), stay("in_progress"), stay("scheduled")])
    ).toBe("in_progress");
  });

  it("prefers a booked stay over history", () => {
    expect(lodgingLifecycleStatus([stay("completed"), stay("scheduled")])).toBe("scheduled");
  });

  it("is completed when only past stays exist", () => {
    expect(lodgingLifecycleStatus([stay("completed"), stay("cancelled")])).toBe("completed");
  });

  it("is cancelled only when cancellations are all there is", () => {
    expect(lodgingLifecycleStatus([stay("cancelled")])).toBe("cancelled");
  });

  it("is null without stays (the bookmarked case)", () => {
    expect(lodgingLifecycleStatus([])).toBeNull();
  });
});

describe("lodgingLifecycleRank — the status sort, now applied in SQL", () => {
  /**
   * The list orders by this rank on the SERVER since 2026-09-20, so
   * `sortLodgingRows` is gone and with it the comparator these cases used to
   * exercise. The RULE is what mattered, and it is still here: this file and
   * `backend/src/shared/__tests__/lodgingLifecycle.test.ts` assert the same
   * table on either side of the mirror, which is what makes a one-sided edit
   * show up as a red test somewhere.
   */
  it("ranks running, booked, past, cancelled-only, stayless — in that order", () => {
    expect([
      lodgingLifecycleRank([stay("in_progress")]),
      lodgingLifecycleRank([stay("scheduled"), stay("completed")]),
      lodgingLifecycleRank([stay("completed")]),
      lodgingLifecycleRank([stay("cancelled")]),
      lodgingLifecycleRank([]),
    ]).toEqual([0, 1, 2, 3, 4]);
  });
});
