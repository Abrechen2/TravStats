/**
 * The truth table for the lifecycle rule, on the backend side of the mirror.
 *
 * `frontend/src/shared/lodgingLifecycle.ts` holds the same rule and has its own
 * test of the same table — nothing checks that the two files agree, which is
 * the convention here rather than a guard (see `shared/domains.ts`,
 * `shared/lodgingCounting.ts`). Asserting the table twice is what makes a
 * one-sided edit show up as a red test somewhere.
 */
import {
  LIFECYCLE_RANK_STAYLESS,
  lodgingLifecycleRank,
  lodgingLifecycleStatus,
} from "../lodgingLifecycle";

const stays = (...statuses: string[]): Array<{ status: string }> =>
  statuses.map((status) => ({ status }));

describe("lodgingLifecycleStatus", () => {
  it("has no status for a house with no stays — that is bookmarked, not cancelled", () => {
    expect(lodgingLifecycleStatus([])).toBeNull();
    expect(lodgingLifecycleRank([])).toBe(LIFECYCLE_RANK_STAYLESS);
  });

  it("lets a running stay beat a booked one beat history", () => {
    expect(lodgingLifecycleStatus(stays("completed", "scheduled", "in_progress"))).toBe(
      "in_progress"
    );
    expect(lodgingLifecycleStatus(stays("completed", "scheduled"))).toBe("scheduled");
    expect(lodgingLifecycleStatus(stays("completed", "cancelled"))).toBe("completed");
  });

  it("says cancelled only when cancellations are ALL the house has", () => {
    // Nine completed stays and one cancelled booking is not a cancelled hotel.
    expect(lodgingLifecycleStatus(stays("cancelled", "cancelled"))).toBe("cancelled");
    expect(lodgingLifecycleStatus(stays("cancelled", "completed"))).toBe("completed");
  });

  it("ranks running, booked, past, cancelled, stayless — in that order", () => {
    expect([
      lodgingLifecycleRank(stays("in_progress")),
      lodgingLifecycleRank(stays("scheduled")),
      lodgingLifecycleRank(stays("completed")),
      lodgingLifecycleRank(stays("cancelled")),
      lodgingLifecycleRank([]),
    ]).toEqual([0, 1, 2, 3, 4]);
  });

  it("reads the STORED status, not the dates — that is the other module's question", () => {
    // A stay stored as "scheduled" makes the house look booked whatever its
    // dates say, because the pill is a view of the record. `classifyStay` in
    // shared/lodgingCounting.ts is the one that derives from the calendar.
    expect(lodgingLifecycleStatus(stays("scheduled"))).toBe("scheduled");
  });
});
