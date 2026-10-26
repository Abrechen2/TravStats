import { describe, expect, it } from "vitest";
import { germanT } from "../../../../__tests__/helpers/germanT";
import type { DataQualityFlag } from "../../../../types/dataQuality";
import { buildInboxItems, flagDay, orderByJourney } from "../model";
import { flag, photo, suggestion, trip, update } from "./fixtures";

describe("inbox journey grouping", () => {
  it("joins a question, photo visit and update by persisted trip identity", () => {
    const items = buildInboxItems(
      [
        { source: "review", data: flag },
        {
          source: "photos",
          data: { ...photo, kind: "visit", tripId: "trip1", tripName: "Lissabon" },
        },
        { source: "updates", data: update },
      ],
      [trip],
      germanT,
      "de"
    );
    expect(new Set(items.map((i) => i.groupKey))).toEqual(new Set(["trip:trip1"]));
  });
  it("never assigns an unrelated photo by overlapping dates or a matching name", () => {
    const items = buildInboxItems(
      [
        {
          source: "photos",
          data: {
            ...photo,
            kind: "place",
            city: "Lissabon",
            startDay: "2026-09-12",
            endDay: "2026-09-16",
          },
        },
      ],
      [trip],
      germanT,
      "de"
    );
    expect(items[0].groupKey).toBe("unassigned");
    expect(items[0].tripId).toBeNull();
  });
  it("keeps identically named proposed trips separate and never dates records by check creation time", () => {
    const items = buildInboxItems(
      [
        { source: "trips", data: suggestion },
        { source: "trips", data: { ...suggestion, id: "other" } },
        { source: "updates", data: update },
      ],
      [],
      germanT,
      "de"
    );
    expect(new Set(items.map((i) => i.groupKey)).size).toBe(3);
    expect(items[2].day).toBeNull();
    expect(orderByJourney(items)[items.length - 1]?.groupKey).toBe("unassigned");
  });
});

describe("flagDay — a dated finding is filed under its travel day", () => {
  const base = { ...flag, entityType: "flight" as const, entityId: "f1", subject: null };
  it("dates a ferry match by the crossing's local departure day", () => {
    const ferry = {
      ...base,
      kind: "ferry_match",
      details: {
        ferryId: "ferry1",
        candidateTripId: "trip1",
        candidateTripName: "Dänemark",
        departurePort: "Puttgarden",
        arrivalPort: "Rødby",
        departureTime: {
          utc: "2025-06-02T22:30:00Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2025-06-03T00:30:00",
          precision: "minute",
        },
        reason: "insideTripWindow",
      },
    } as DataQualityFlag;
    expect(flagDay(ferry)).toBe("2025-06-03");
  });
  it("dates a duplicate and a flight overlap by the row's own day", () => {
    const dup = {
      ...base,
      kind: "duplicate_candidate",
      details: { matchedOn: ["route"], copies: [], dataSource: null, day: "2025-06-04" },
    } as DataQualityFlag;
    const overlap = {
      ...base,
      kind: "chronology_conflict",
      details: {
        domain: "flight",
        conflictWith: { entityType: "flight", entityId: "f0", label: "x", parentId: null },
        thisStart: "2025-06-03T23:30:00Z",
        thisEnd: "2025-06-04T02:00:00Z",
        otherStart: "2025-06-03T22:00:00Z",
        otherEnd: "2025-06-04T01:00:00Z",
        overlapMinutes: 90,
        overlapNights: null,
        day: "2025-06-04",
      },
    } as DataQualityFlag;
    expect(flagDay(dup)).toBe("2025-06-04");
    expect(flagDay(overlap)).toBe("2025-06-04");
  });
  it("still says unknown for a flag written before the day was sent", () => {
    const old = {
      ...base,
      kind: "duplicate_candidate",
      details: { matchedOn: ["route"], copies: [], dataSource: null },
    } as DataQualityFlag;
    expect(flagDay(old)).toBeNull();
  });
});
