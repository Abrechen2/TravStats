import { describe, expect, it } from "@jest/globals";

import { dataQualityFlagPayloadSchema } from "../../../schemas/dataQualityFlag";
import { findIncompleteTrips } from "../checks/tripIncomplete";
import { flight, snapshot, stay } from "./recordFixtures";

const NOW = new Date("2026-10-10T12:00:00Z");
const trip = (over: {
  id: string;
  status?: string;
  startDay?: string | null;
  endDay?: string | null;
}) => ({
  status: "completed",
  startDay: "2026-03-09",
  endDay: "2026-03-15",
  ...over,
});

describe("findIncompleteTrips — trip_end_missing", () => {
  it("asks about a long-past trip with no end and suggests the last entry's day", () => {
    const findings = findIncompleteTrips(
      snapshot({
        trips: [trip({ id: "t1", status: "in_progress", endDay: null })],
        flights: [
          flight({ id: "home", tripId: "t1", firstDay: "2026-03-20", lastDay: "2026-03-21" }),
        ],
      }),
      NOW
    );
    expect(findings).toEqual([
      {
        entityType: "trip",
        entityId: "t1",
        kind: "trip_end_missing",
        details: { startDay: "2026-03-09", lastEntryDay: "2026-03-21" },
      },
    ]);
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask about a trip that is still running, or one with no dates at all", () => {
    const findings = findIncompleteTrips(
      snapshot({
        trips: [
          trip({ id: "running", status: "in_progress", startDay: "2026-10-01", endDay: null }),
          trip({ id: "wish", status: "planned", startDay: null, endDay: null }),
        ],
      }),
      NOW
    );
    expect(findings).toEqual([]);
  });

  it("asks about a completed trip with no end even when it started recently", () => {
    const findings = findIncompleteTrips(
      snapshot({ trips: [trip({ id: "done", startDay: "2026-10-01", endDay: null })] }),
      NOW
    );
    expect(findings.map((f) => f.kind)).toEqual(["trip_end_missing"]);
  });
});

describe("findIncompleteTrips — trip_entries_outside", () => {
  it("names the entries that fall outside the trip's days", () => {
    const findings = findIncompleteTrips(
      snapshot({
        trips: [trip({ id: "t1" })],
        flights: [
          flight({ id: "early", tripId: "t1", firstDay: "2026-03-01", lastDay: "2026-03-01" }),
        ],
        stays: [
          stay({
            id: "late",
            tripId: "t1",
            lodgingId: "rome",
            firstDay: "2026-03-20",
            lastDay: "2026-03-22",
          }),
        ],
      }),
      NOW
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "trip",
      entityId: "t1",
      kind: "trip_entries_outside",
      details: {
        startDay: "2026-03-09",
        endDay: "2026-03-15",
        entries: [
          { entityType: "flight", entityId: "early", parentId: null, firstDay: "2026-03-01" },
          { entityType: "lodging_stay", entityId: "late", parentId: "rome", lastDay: "2026-03-22" },
        ],
      },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask about an overnight leg one day past either edge, or a cancelled or undated entry", () => {
    const findings = findIncompleteTrips(
      snapshot({
        trips: [trip({ id: "t1" })],
        flights: [
          flight({ id: "eve", tripId: "t1", firstDay: "2026-03-08", lastDay: "2026-03-09" }),
          flight({ id: "redeye", tripId: "t1", firstDay: "2026-03-15", lastDay: "2026-03-16" }),
          flight({ id: "gone", tripId: "t1", status: "cancelled", firstDay: "2026-01-01" }),
          flight({ id: "undated", tripId: "t1", firstDay: null, lastDay: null }),
        ],
      }),
      NOW
    );
    expect(findings).toEqual([]);
  });
});
