import { describe, expect, it } from "@jest/globals";

import { dataQualityFlagPayloadSchema } from "../../../schemas/dataQualityFlag";
import { findChronologyConflicts } from "../checks/chronologyConflicts";
import { flight, snapshot, stay } from "./recordFixtures";

const at = (iso: string) => new Date(iso);

describe("findChronologyConflicts — flights", () => {
  it("asks about a departure before the previous flight has landed, on the later flight", () => {
    const findings = findChronologyConflicts(
      snapshot({
        flights: [
          flight({
            id: "out",
            departureAt: at("2026-03-10T08:00:00Z"),
            arrivalAt: at("2026-03-10T16:00:00Z"),
          }),
          flight({
            id: "next",
            flightNumber: "UA1",
            departureAt: at("2026-03-10T13:00:00Z"),
            arrivalAt: at("2026-03-10T15:00:00Z"),
          }),
        ],
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "flight",
      entityId: "next",
      kind: "chronology_conflict",
      details: {
        domain: "flight",
        conflictWith: { entityType: "flight", entityId: "out" },
        overlapMinutes: 120,
        overlapNights: null,
      },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("leaves a tight connection alone — within the 60-minute tolerance", () => {
    const findings = findChronologyConflicts(
      snapshot({
        flights: [
          flight({
            id: "a",
            departureAt: at("2026-03-10T08:00:00Z"),
            arrivalAt: at("2026-03-10T10:00:00Z"),
          }),
          // Leaves 45 minutes before the scheduled arrival of the first: drift, not a contradiction.
          flight({
            id: "b",
            departureAt: at("2026-03-10T09:15:00Z"),
            arrivalAt: at("2026-03-10T11:00:00Z"),
          }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("does not compare times the time model does not make certain", () => {
    const findings = findChronologyConflicts(
      snapshot({
        flights: [
          flight({
            id: "a",
            departureAt: at("2026-03-10T08:00:00Z"),
            arrivalAt: at("2026-03-10T16:00:00Z"),
          }),
          // A date-only row: no instant, nothing to compare.
          flight({ id: "b", departureAt: null, arrivalAt: null }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("skips a pair the duplicate check already asks about, and cancelled flights", () => {
    const flights = [
      flight({
        id: "a",
        departureAt: at("2026-03-10T08:00:00Z"),
        arrivalAt: at("2026-03-10T16:00:00Z"),
      }),
      flight({
        id: "b",
        departureAt: at("2026-03-10T09:00:00Z"),
        arrivalAt: at("2026-03-10T17:00:00Z"),
      }),
      flight({
        id: "c",
        status: "cancelled",
        departureAt: at("2026-03-10T10:00:00Z"),
        arrivalAt: at("2026-03-10T12:00:00Z"),
      }),
    ];
    expect(findChronologyConflicts(snapshot({ flights }), new Set(["b|a", "a|b"]))).toEqual([]);
  });
});

describe("findChronologyConflicts — answered duplicates", () => {
  it("does not set a flight marked as a duplicate against its original", () => {
    const flights = [
      flight({
        id: "original",
        departureAt: at("2026-03-10T08:00:00Z"),
        arrivalAt: at("2026-03-10T16:00:00Z"),
      }),
      flight({
        id: "copy",
        flightNumber: "UA1",
        status: "duplicated",
        departureAt: at("2026-03-10T09:00:00Z"),
        arrivalAt: at("2026-03-10T17:00:00Z"),
      }),
    ];
    expect(findChronologyConflicts(snapshot({ flights }))).toEqual([]);
  });
});

describe("findChronologyConflicts — stays", () => {
  it("asks about two houses on the same night", () => {
    const findings = findChronologyConflicts(
      snapshot({
        stays: [
          stay({ id: "s1", lodgingId: "rome", firstDay: "2026-03-10", lastDay: "2026-03-13" }),
          stay({ id: "s2", lodgingId: "naples", firstDay: "2026-03-12", lastDay: "2026-03-14" }),
        ],
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "lodging_stay",
      entityId: "s2",
      details: {
        domain: "lodging_stay",
        conflictWith: { entityId: "s1", parentId: "rome" },
        thisStart: "2026-03-12",
        otherEnd: "2026-03-13",
        overlapNights: 1,
        overlapMinutes: null,
      },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask about checking out and into the next house on the same day", () => {
    const findings = findChronologyConflicts(
      snapshot({
        stays: [
          stay({ id: "s1", lodgingId: "rome", firstDay: "2026-03-10", lastDay: "2026-03-12" }),
          stay({ id: "s2", lodgingId: "naples", firstDay: "2026-03-12", lastDay: "2026-03-14" }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("does NOT ask about two rooms in the same house", () => {
    const findings = findChronologyConflicts(
      snapshot({
        stays: [
          stay({ id: "s1", lodgingId: "rome" }),
          stay({ id: "s2", lodgingId: "rome", firstDay: "2026-03-11", lastDay: "2026-03-13" }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("finds an overlap behind a longer stay that does not clash", () => {
    // s1 (rome) is a long stay; s2 is in rome too (no clash); s3 in naples
    // clashes with both. A sweep that kept only the furthest-reaching stay
    // would compare s3 against s1 alone and still find it — but s4, also in
    // rome, must not be asked about against s1/s2.
    const findings = findChronologyConflicts(
      snapshot({
        stays: [
          stay({ id: "s1", lodgingId: "rome", firstDay: "2026-03-01", lastDay: "2026-03-20" }),
          stay({ id: "s2", lodgingId: "rome", firstDay: "2026-03-05", lastDay: "2026-03-08" }),
          stay({ id: "s3", lodgingId: "naples", firstDay: "2026-03-06", lastDay: "2026-03-07" }),
          stay({ id: "s4", lodgingId: "rome", firstDay: "2026-03-10", lastDay: "2026-03-12" }),
        ],
      })
    );
    expect(findings.map((f) => f.entityId)).toEqual(["s3"]);
  });
});
