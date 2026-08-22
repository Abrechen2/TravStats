import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../../types/lodging";

vi.unmock("../../../../store/settingsStore");

import LodgingRhythmSection from "../LodgingRhythmSection";
import LodgingGeoSection from "../LodgingGeoSection";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

const base: LodgingStats = {
  lodgingsCount: 2,
  staysCount: 3,
  totalNights: 11,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 4,
  chainsUnique: 1,
  citiesUnique: 2,
  countries: ["DE"],
  countriesCount: 1,
  spendBaseTotal: 0,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: {},
  awardNights: 0,
  nightsByType: { hotel: 11 },
  avgRatingOverall: null,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

describe("LodgingRhythmSection", () => {
  it("renders the week starting on Monday, not on the backend's Sunday index", () => {
    // The payload array mirrors Date.getUTCDay() (0 = Sunday). Re-basing it
    // server-side would put two conventions in one payload, so the rotation
    // lives here — and that is exactly what this pins.
    render(
      <LodgingRhythmSection
        stats={{
          ...base,
          rhythm: {
            ...base.rhythm,
            nightsAway: 28,
            // Sunday 7, Monday 1, Tuesday 2, … Saturday 6.
            nightsByWeekday: [7, 1, 2, 3, 4, 5, 6],
          },
        }}
      />
    );
    const weekday = screen
      .getAllByText(/^lodging:stats\.rhythm\.weekday\./)
      .map((n) => n.textContent);
    expect(weekday[0]).toBe("lodging:stats.rhythm.weekday.mon");
    expect(weekday[6]).toBe("lodging:stats.rhythm.weekday.sun");
  });

  it("mentions double-booked nights only when stays actually overlap", () => {
    // Overlap is measured against the nights that CAN be placed on a calendar,
    // never against the grand total: an undated stay never enters `nightsAway`,
    // so the total would report it as a double booking.
    const { rerender } = render(
      <LodgingRhythmSection
        stats={{
          ...base,
          totalNights: 11,
          rhythm: { ...base.rhythm, walkableNights: 11, nightsAway: 11 },
        }}
      />
    );
    expect(screen.queryByText(/lodging:stats\.rhythm\.overlap/)).toBeNull();

    rerender(
      <LodgingRhythmSection
        stats={{
          ...base,
          totalNights: 11,
          rhythm: { ...base.rhythm, walkableNights: 11, nightsAway: 9 },
        }}
      />
    );
    expect(screen.getByText(/lodging:stats\.rhythm\.overlap/)).toBeTruthy();
  });

  it("does not call an undated stay a double booking", () => {
    // The regression: five nights recorded as "July 2011" are five nights the
    // calendar cannot hold. They must not be announced as booked twice.
    render(
      <LodgingRhythmSection
        stats={{
          ...base,
          totalNights: 11,
          undatedStays: 1,
          rhythm: { ...base.rhythm, walkableNights: 6, nightsAway: 6 },
        }}
      />
    );
    expect(screen.queryByText(/lodging:stats\.rhythm\.overlap/)).toBeNull();
    expect(screen.getByText(/lodging:stats\.rhythm\.undated/)).toBeTruthy();
  });

  it("shows a dash for the busiest month when no night was ever recorded", () => {
    render(<LodgingRhythmSection stats={base} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("LodgingGeoSection", () => {
  it("marks the hemisphere with a letter rather than a minus sign", () => {
    render(
      <LodgingGeoSection
        stats={{
          ...base,
          geo: {
            ...base.geo,
            continents: ["Europe"],
            continentsCount: 1,
            northernmost: {
              lodgingId: "l1",
              lodgingName: "Tromsø",
              city: "Tromsø",
              country: "NO",
              lat: 69.65,
              lon: 18.96,
              checkIn: "2024-02-01T00:00:00.000Z",
            },
            southernmost: {
              lodgingId: "l2",
              lodgingName: "Kapstadt",
              city: "Cape Town",
              country: "ZA",
              lat: -33.92,
              lon: 18.42,
              checkIn: "2024-11-01T00:00:00.000Z",
            },
          },
        }}
      />
    );
    expect(screen.getByText("69.65° N")).toBeTruthy();
    expect(screen.getByText("33.92° S")).toBeTruthy();
  });

  it("says how many stays have no coordinates instead of hiding the gap", () => {
    render(<LodgingGeoSection stats={{ ...base, geo: { ...base.geo, unlocatedStays: 4 } }} />);
    expect(screen.getByText(/lodging:stats\.geo\.unlocated/)).toBeTruthy();
  });

  it("says nothing about coordinates when every stay has them", () => {
    render(<LodgingGeoSection stats={base} />);
    expect(screen.queryByText(/lodging:stats\.geo\.unlocated/)).toBeNull();
  });
});
