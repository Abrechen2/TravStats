import { describe, expect, it } from "@jest/globals";

import { dataQualityFlagPayloadSchema } from "../../../schemas/dataQualityFlag";
import {
  duplicatePairs,
  findDuplicateCandidates,
  normaliseFlightNumber,
} from "../checks/duplicateCandidates";
import { cruise, flight, ground, snapshot, stay } from "./recordFixtures";

const later = new Date("2026-02-01T00:00:00Z");

describe("findDuplicateCandidates — the same entry twice, asked on the newer copy", () => {
  it("asks about a mail-imported flight beside the hand-typed one", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        flights: [
          flight({ id: "typed", flightNumber: "LH 0400", departureAt: null, arrivalAt: null }),
          flight({ id: "mail", createdAt: later, dataSource: "email_import" }),
        ],
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "flight",
      entityId: "mail",
      kind: "duplicate_candidate",
      details: {
        matchedOn: ["departureDay", "flightNumber", "route"],
        dataSource: "email_import",
        // The inbox groups the question under the copy's own travel day.
        day: "2026-03-10",
        copies: [{ entityType: "flight", entityId: "typed", dataSource: "manual", parentId: null }],
      },
    });
    // What the check writes is what the API will serve.
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask about a daily commute — the same flight on two days is two flights", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        flights: [
          flight({ id: "mon" }),
          flight({
            id: "tue",
            createdAt: later,
            firstDay: "2026-03-11",
            lastDay: "2026-03-11",
            departureAt: new Date("2026-03-11T08:00:00Z"),
            arrivalAt: new Date("2026-03-11T16:00:00Z"),
          }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("matches a numberless copy only at the same certain minute", () => {
    const same = findDuplicateCandidates(
      snapshot({
        flights: [flight({ id: "a" }), flight({ id: "b", createdAt: later, flightNumber: null })],
      })
    );
    expect(same.map((f) => f.entityId)).toEqual(["b"]);

    const dateOnly = findDuplicateCandidates(
      snapshot({
        flights: [
          flight({ id: "a" }),
          flight({ id: "b", createdAt: later, flightNumber: null, departureAt: null }),
        ],
      })
    );
    expect(dateOnly).toEqual([]);
  });

  it("never joins two different flight numbers at the same minute (a codeshare pair)", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        flights: [
          flight({ id: "lh", flightNumber: "LH400" }),
          flight({ id: "ua", flightNumber: "UA9050", createdAt: later }),
          flight({ id: "none", flightNumber: null, createdAt: later }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("ignores a cancelled booking beside its rebooking", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        flights: [flight({ id: "a", status: "cancelled" }), flight({ id: "b", createdAt: later })],
      })
    );
    expect(findings).toEqual([]);
  });

  it("does not ask again about a flight the user already marked as a duplicate", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        flights: [flight({ id: "a", status: "duplicated" }), flight({ id: "b", createdAt: later })],
      })
    );
    expect(findings).toEqual([]);
  });

  it("asks about the same train number on the same day, not on the next one", () => {
    const twice = findDuplicateCandidates(
      snapshot({
        railJourneys: [
          ground({ id: "r1", departureAt: null }),
          ground({ id: "r2", createdAt: later, departureAt: null }),
          ground({ id: "r3", createdAt: later, firstDay: "2026-03-11", departureAt: null }),
        ],
      })
    );
    expect(twice.map((f) => [f.entityType, f.entityId])).toEqual([["rail_journey", "r2"]]);
  });

  it("matches buses only on a timed departure — a line name is not a departure", () => {
    const sameLineSameDay = findDuplicateCandidates(
      snapshot({
        busJourneys: [
          ground({ id: "b1", service: "100", departureAt: new Date("2026-03-10T07:00:00Z") }),
          ground({
            id: "b2",
            service: "100",
            createdAt: later,
            departureAt: new Date("2026-03-10T07:20:00Z"),
          }),
          ground({ id: "b3", service: "100", createdAt: later, departureAt: null }),
        ],
      })
    );
    expect(sameLineSameDay).toEqual([]);

    const sameMinute = findDuplicateCandidates(
      snapshot({
        busJourneys: [ground({ id: "b1" }), ground({ id: "b2", createdAt: later })],
      })
    );
    expect(sameMinute.map((f) => [f.entityType, f.entityId])).toEqual([["bus_journey", "b2"]]);
  });

  it("asks about a cruise with the same ship and dates, not a different week", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        cruises: [
          cruise({ id: "c1" }),
          cruise({ id: "c2", createdAt: later }),
          cruise({ id: "c3", createdAt: later, firstDay: "2026-06-01", lastDay: "2026-06-08" }),
        ],
      })
    );
    expect(findings.map((f) => f.entityId)).toEqual(["c2"]);
  });

  it("asks about the same stay twice and links the copy through its lodging", () => {
    const findings = findDuplicateCandidates(
      snapshot({
        stays: [
          stay({ id: "s1" }),
          stay({ id: "s2", createdAt: later }),
          // Same house, the following week — a return visit, not a copy.
          stay({ id: "s3", createdAt: later, firstDay: "2026-03-17", lastDay: "2026-03-19" }),
        ],
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "lodging_stay",
      entityId: "s2",
      details: { copies: [{ entityId: "s1", parentId: "l1" }] },
    });
  });

  it("pairs every flagged copy for the chronology check to skip", () => {
    const findings = findDuplicateCandidates(
      snapshot({ flights: [flight({ id: "a" }), flight({ id: "b", createdAt: later })] })
    );
    const pairs = duplicatePairs(findings);
    expect(pairs.has("a|b") && pairs.has("b|a")).toBe(true);
  });
});

describe("normaliseFlightNumber", () => {
  it("folds case, spaces and leading zeros", () => {
    expect(normaliseFlightNumber("lh 0400")).toBe("LH400");
    expect(normaliseFlightNumber("U2 012")).toBe("U212");
    expect(normaliseFlightNumber(" ")).toBeNull();
  });
});
