import { describe, it, expect } from "vitest";
import { pinnedFromLodging, pinnedFromPlace } from "../buildFlatPinned";
import { latestStayFacts } from "../cardStats";
import type { Lodging } from "../../../../types/lodging";
import type { Place } from "../../../../types/place";

const stay = (id: string, checkIn: string, checkOut: string) => ({
  id,
  checkIn,
  checkOut,
  datePrecision: "DAY",
  nights: 3,
  totalPrice: null,
  currency: null,
  status: "confirmed",
});

const hotel = {
  id: "l1",
  name: "Hotel",
  lat: 38.7,
  lon: -9.1,
  stayCount: 2,
  nights: 3,
  stays: [
    stay("past", "2025-09-01T00:00:00.000Z", "2025-09-04T00:00:00.000Z"),
    stay("future", "2099-01-10T00:00:00.000Z", "2099-01-13T00:00:00.000Z"),
  ],
} as unknown as Lodging;

describe("a card opened for ONE entry of a place with several", () => {
  // The bug: a list row for a PLANNED stay opened the hotel card on the latest
  // PAST stay, because the card picks "which stay" itself.
  it("opens the lodging card on the clicked planned stay, not the latest past one", () => {
    const pinned = pinnedFromLodging(hotel, "future");
    if (pinned?.kind !== "lodging") throw new Error("no lodging card");
    const facts = latestStayFacts(pinned.data.stays, "en");
    expect(facts.upcoming).toBe(true);
    expect(facts.dateRange).toContain("2099");
  });

  it("opens it on the clicked PAST stay when a planned one also exists", () => {
    const pinned = pinnedFromLodging(hotel, "past");
    if (pinned?.kind !== "lodging") throw new Error("no lodging card");
    const facts = latestStayFacts(pinned.data.stays, "en");
    expect(facts.upcoming).toBe(false);
    expect(facts.dateRange).toContain("2025");
  });

  it("keeps the server totals and the old behaviour with no stay named", () => {
    const pinned = pinnedFromLodging(hotel);
    if (pinned?.kind !== "lodging") throw new Error("no lodging card");
    expect(pinned.data.stays).toHaveLength(2);
    const narrowed = pinnedFromLodging(hotel, "future");
    if (narrowed?.kind !== "lodging") throw new Error("no lodging card");
    expect(narrowed.data.stayCount).toBe(2);
    expect(narrowed.data.nights).toBe(3);
  });

  it("carries the clicked visit's date on the place card", () => {
    const place = {
      id: "p1",
      name: "Museum",
      lat: 1,
      lon: 2,
      visitCount: 2,
      visits: [
        { id: "v1", visitedAt: "2025-01-01T00:00:00.000Z" },
        { id: "v2", visitedAt: "2099-05-05T00:00:00.000Z" },
      ],
    } as unknown as Place;
    const pinned = pinnedFromPlace(place, "v2");
    if (pinned.kind !== "place") throw new Error("no place card");
    expect(pinned.data.focusVisit).toEqual({ visitedAt: "2099-05-05T00:00:00.000Z" });
    const plain = pinnedFromPlace(place);
    if (plain.kind !== "place") throw new Error("no place card");
    expect(plain.data.focusVisit).toBeUndefined();
  });
});
