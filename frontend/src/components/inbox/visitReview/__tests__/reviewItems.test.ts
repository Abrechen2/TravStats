import { describe, expect, it } from "vitest";

import type { PhotoJourney } from "../../../../types/photoJourney";
import { buildReviewItems, needsName } from "../reviewItems";

const row = (over: Partial<PhotoJourney> = {}) =>
  ({
    id: "a",
    kind: "visit",
    suggestedName: "Gyeongbokgung",
    suggestedLocalName: "경복궁",
    startLocal: "2026-10-05T11:19:00",
    placeId: null,
    ...over,
  }) as PhotoJourney;

describe("buildReviewItems", () => {
  it("sends a rejection as the bare answer, whatever was corrected", () => {
    expect(buildReviewItems(["a"], "dismiss", [row()], { a: { name: "X" } })).toEqual([
      { id: "a", action: "dismiss" },
    ]);
  });

  it("sends nothing the reader left as proposed", () => {
    expect(
      buildReviewItems(["a"], "accept", [row()], {
        a: { name: "Gyeongbokgung", localName: "경복궁", local: "2026-10-05T11:19" },
      })
    ).toEqual([{ id: "a", action: "accept" }]);
  });

  it("lets a chosen own place replace the name fields", () => {
    expect(
      buildReviewItems(["a"], "accept", [row()], {
        a: { name: "Other", place: { id: "p1", name: "Mine" } },
      })
    ).toEqual([{ id: "a", action: "accept", placeId: "p1" }]);
  });
});

describe("needsName", () => {
  it("is true only when nothing — lookup, own place, chosen place or typed name — names it", () => {
    expect(needsName(row({ suggestedName: null }), undefined)).toBe(true);
    expect(needsName(row({ suggestedName: null }), { name: "  " })).toBe(true);
    expect(needsName(row({ suggestedName: null }), { name: "Grounds" })).toBe(false);
    expect(needsName(row({ suggestedName: null, placeId: "p" }), undefined)).toBe(false);
    expect(needsName(row({ suggestedName: null }), { place: { id: "p", name: "n" } })).toBe(false);
    expect(needsName(row(), undefined)).toBe(false);
  });
});
