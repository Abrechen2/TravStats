import { describe, expect, it } from "vitest";
import { germanT } from "../../../../__tests__/helpers/germanT";
import { buildInboxItems, orderByJourney } from "../model";
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
