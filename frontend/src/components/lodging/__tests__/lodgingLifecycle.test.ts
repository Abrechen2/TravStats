/**
 * Owner ask (2026-08-20): the stay lifecycle status must be visible in the
 * lodging list like the flights table shows flight status. These pin the
 * row-level derivation and the status sort order.
 */
import { describe, it, expect } from "vitest";
import { lodgingLifecycleStatus } from "../lodgingLifecycle";
import { sortLodgingRows } from "../sortLodgingRows";
import type { Lodging, LodgingStay, StayStatus } from "../../../types/lodging";

const stay = (status: StayStatus): LodgingStay => ({ status }) as unknown as LodgingStay;

const lodging = (name: string, statuses: StayStatus[], extra: Partial<Lodging> = {}): Lodging =>
  ({
    name,
    chain: null,
    city: null,
    country: null,
    stays: statuses.map(stay),
    stayCount: statuses.length,
    nights: 0,
    overallRating: null,
    totalSpendBase: 0,
    ...extra,
  }) as unknown as Lodging;

describe("lodgingLifecycleStatus", () => {
  it("prefers a running stay over everything else", () => {
    expect(lodgingLifecycleStatus([stay("completed"), stay("in_progress"), stay("scheduled")])).toBe(
      "in_progress"
    );
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

describe("sortLodgingRows by status", () => {
  it("orders running, booked, past, cancelled-only, stayless", () => {
    const rows = [
      lodging("stayless", []),
      lodging("past", ["completed"]),
      lodging("cancelledOnly", ["cancelled"]),
      lodging("running", ["in_progress"]),
      lodging("booked", ["scheduled", "completed"]),
    ];
    expect(sortLodgingRows(rows, "status", "asc").map((l) => l.name)).toEqual([
      "running",
      "booked",
      "past",
      "cancelledOnly",
      "stayless",
    ]);
  });

  it("sorts independents after named chains", () => {
    const rows = [
      lodging("indie", ["completed"]),
      lodging("chained", ["completed"], {
        chain: { id: 1, name: "Accor" } as unknown as Lodging["chain"],
      }),
    ];
    expect(sortLodgingRows(rows, "chain", "asc").map((l) => l.name)).toEqual(["chained", "indie"]);
  });
});
