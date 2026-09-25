import { describe, it, expect } from "vitest";
import { countRoadtripNights, stationState, type CountableStation } from "../roadtrip";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const stayStation = (id: string, checkIn: string, checkOut: string): CountableStation => ({
  lodgingStayId: id,
  overnight: true,
  startDate: d(checkIn),
  endDate: d(checkOut),
  stay: { checkIn: d(checkIn), checkOut: d(checkOut), datePrecision: "DAY", nights: null },
});

describe("stationState", () => {
  it("is exactly one of stay, free and pass", () => {
    expect(stationState({ lodgingStayId: "s1", overnight: true })).toBe("stay");
    expect(stationState({ lodgingStayId: null, overnight: true })).toBe("free");
    expect(stationState({ lodgingStayId: null, overnight: false })).toBe("pass");
  });

  it("reads a station whose stay was deleted as a free night, not a pass", () => {
    // The SetNull cascade clears the link and leaves `overnight` — the night
    // still happened.
    expect(stationState({ lodgingStayId: null, overnight: true })).toBe("free");
  });
});

describe("countRoadtripNights", () => {
  it("takes a stay's nights from the stay and counts only free nights itself", () => {
    const result = countRoadtripNights([
      {
        lodgingStayId: null,
        overnight: false,
        startDate: d("2026-07-12"),
        endDate: null,
        stay: null,
      },
      stayStation("camp-1", "2026-07-12", "2026-07-14"),
      {
        lodgingStayId: null,
        overnight: true,
        startDate: d("2026-07-14"),
        endDate: d("2026-07-15"),
        stay: null,
      },
    ]);
    expect(result).toEqual({
      stayNights: 2,
      freeNights: 1,
      nights: 3,
      nightsKnown: true,
      placesSlept: 2,
    });
  });

  it("never counts one stay twice, even when two stations link it", () => {
    const result = countRoadtripNights([
      stayStation("camp-1", "2026-07-12", "2026-07-14"),
      stayStation("camp-1", "2026-07-12", "2026-07-14"),
    ]);
    expect(result.stayNights).toBe(2);
    expect(result.placesSlept).toBe(1);
  });

  it("counts no night at a cancelled stay, as the lodging statistics count none", () => {
    // The lodging statistics exclude a cancelled stay (`classifyStay` ->
    // "excluded"). A roadtrip that still counted its nights would report
    // nights no lodging figure knows — the double book this module forbids.
    const cancelled = stayStation("camp-x", "2026-07-12", "2026-07-14");
    const result = countRoadtripNights([
      { ...cancelled, stay: { ...cancelled.stay!, status: "cancelled" } },
      stayStation("camp-1", "2026-07-14", "2026-07-15"),
    ]);
    expect(result).toEqual({
      stayNights: 1,
      freeNights: 0,
      nights: 1,
      nightsKnown: true,
      placesSlept: 1,
    });
  });

  it("counts a free station with no dates as one night, and says the count is soft", () => {
    const result = countRoadtripNights([
      { lodgingStayId: null, overnight: true, startDate: null, endDate: null, stay: null },
    ]);
    expect(result.nights).toBe(1);
    expect(result.nightsKnown).toBe(false);
  });

  it("inherits the stay's own uncertainty rather than inventing a span", () => {
    const result = countRoadtripNights([
      {
        lodgingStayId: "old",
        overnight: true,
        startDate: null,
        endDate: null,
        stay: { checkIn: d("2011-07-01"), checkOut: null, datePrecision: "MONTH", nights: null },
      },
    ]);
    expect(result.stayNights).toBe(0);
    expect(result.nightsKnown).toBe(false);
  });
});
