import { describe, it, expect } from "vitest";
import { adaptFlight } from "../flightStatsAdapter";
import { adaptCruise } from "../cruiseStatsAdapter";
import { adaptLodging } from "../lodgingStatsAdapter";
import { adaptPoi } from "../poiStatsAdapter";
import type { Flight } from "../../../../types";
import type { CruiseStatsResponse } from "../../../api/stats";
import type { Cruise } from "../../../../types/cruise";
import type { Lodging, LodgingStats } from "../../../../types/lodging";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

function makeFlight(overrides: Partial<Flight>): Flight {
  return {
    id: "f1",
    userId: "u1",
    airline: "Lufthansa",
    flightNumber: "LH400",
    depLat: 50.0379,
    depLon: 8.5622,
    arrLat: 40.6413,
    arrLon: -73.7781,
    departureTime: "2024-03-15T10:00:00Z",
    arrivalTime: "2024-03-15T18:00:00Z",
    status: "flown",
    createdAt: "2024-03-15T00:00:00Z",
    durationMinutes: 480,
    ...overrides,
  };
}

const baseStats: CruiseStatsResponse = {
  cruisesCount: 0,
  cruisePortsUnique: 0,
  cruisePortsSingleMax: 0,
  cruiseShipsUnique: 0,
  cruiseLinesUnique: 0,
  cruiseLineLoyaltyMax: 0,
  cruiseLines: [],
  seaDays: 0,
  seaDaysStreak: 0,
  regions: [],
  regionVisitCounts: {},
  countries: [],
  totalDistanceKm: 0,
  longestLegKm: 0,
  totalPortCalls: 0,
  totalCruiseDays: 0,
  hasBalconyCabin: false,
  hasSuiteCabin: false,
  maxDeck: 0,
  hasCanalTransit: false,
  hasPolar: false,
  hasColdWater: false,
  hasDatelineCrossing: false,
  hasBirthdayAtSea: false,
  hasNewYearsAtSea: false,
};

function makeCruise(overrides: Partial<Cruise>): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-06-01",
    endDate: "2024-06-08",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    createdAt: "2024-06-01T00:00:00Z",
    stops: [],
    ...overrides,
  } as Cruise;
}

describe("adaptFlight", () => {
  it("returns hasData=false on empty input", () => {
    const stats = adaptFlight({ flights: [], countries: [] });
    expect(stats).toEqual({ domain: "flight", hasData: false });
  });

  it("collapses multiple flights on the same day to 1 active day", () => {
    const stats = adaptFlight({
      flights: [
        makeFlight({ id: "1", departureTime: "2024-03-15T08:00:00Z" }),
        makeFlight({ id: "2", departureTime: "2024-03-15T18:00:00Z" }),
      ],
      countries: ["DE", "US"],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(2);
    expect(stats.yearlyEvents[2024]).toBe(2);
    expect(stats.yearlyActiveDays[2024]).toBe(1);
    expect(stats.monthlyActiveDays["2024-03"]).toBe(1);
    expect(stats.dailyActiveDays["2024-03-15"]).toBe(1);
  });

  it("aggregates haversine distance and duration", () => {
    const stats = adaptFlight({
      flights: [makeFlight({})],
      countries: ["DE", "US"],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalDistanceKm).toBeGreaterThan(6000);
    expect(stats.totalDurationHours).toBeCloseTo(8, 1);
    expect(stats.summary.headlineKpis[0].label).toBe("Distanz");
    expect(stats.summary.topItems?.items[0].label).toBe("Lufthansa");
  });

  it("passes the year-keyed country index through to the domain contract", () => {
    const stats = adaptFlight({
      flights: [makeFlight({})],
      countries: ["DE", "US"],
      countriesByYear: { 2024: ["DE"], 2026: ["US"] },
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.countriesByYear).toEqual({ 2024: ["DE"], 2026: ["US"] });
  });

  it("leaves the index undefined when the backend did not send one", () => {
    // Must stay undefined rather than {} — aggregate() reads that difference
    // to decide between "no index, use lifetime" and "zero countries".
    const stats = adaptFlight({ flights: [makeFlight({})], countries: ["DE"] });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.countriesByYear).toBeUndefined();
  });
});

describe("adaptCruise", () => {
  it("returns hasData=false when stats reports no cruises", () => {
    const stats = adaptCruise({ stats: { ...baseStats, cruisesCount: 0 }, cruises: [] });
    expect(stats).toEqual({ domain: "cruise", hasData: false });
  });

  it("expands a cruise into per-day buckets across its full span", () => {
    const stats = adaptCruise({
      stats: {
        ...baseStats,
        cruisesCount: 1,
        totalDistanceKm: 1000,
        seaDays: 3,
        cruisePortsUnique: 5,
        countries: ["IT"],
        cruiseLines: ["AIDA"],
        hasPolar: true,
      },
      cruises: [makeCruise({ startDate: "2024-06-01", endDate: "2024-06-03" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents[2024]).toBe(1);
    expect(stats.yearlyActiveDays[2024]).toBe(3);
    expect(stats.monthlyActiveDays["2024-06"]).toBe(3);
    expect(stats.dailyActiveDays["2024-06-01"]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-02"]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-03"]).toBe(1);
    expect(stats.summary.badges?.find((b) => b.label === "Polar-Region")).toBeDefined();
  });

  it("counts in ISO codes while the cruise tab keeps the display names", () => {
    // "Germany" and the airport catalogue's "DE" are the same country. Before
    // this the cross-domain tile counted them as two.
    const stats = adaptCruise({
      stats: {
        ...baseStats,
        cruisesCount: 1,
        countries: ["Germany", "Spain"],
        countriesIso: ["DE", "ES"],
        cruiseLines: ["AIDA"],
      },
      cruises: [makeCruise({ startDate: "2024-06-01", endDate: "2024-06-03" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.countries).toEqual(["DE", "ES"]);
  });

  it("falls back to the names when an older backend sends no ISO list", () => {
    const stats = adaptCruise({
      stats: { ...baseStats, cruisesCount: 1, countries: ["Germany"], cruiseLines: ["AIDA"] },
      cruises: [makeCruise({ startDate: "2024-06-01", endDate: "2024-06-03" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.countries).toEqual(["Germany"]);
  });

  it("converts the cruise year index from JSON string keys to numbers", () => {
    const stats = adaptCruise({
      stats: {
        ...baseStats,
        cruisesCount: 1,
        countries: ["IT", "ES"],
        countriesByYear: { "2024": ["IT"], "2026": ["ES"] },
        cruiseLines: ["AIDA"],
      },
      cruises: [makeCruise({ startDate: "2024-06-01", endDate: "2024-06-03" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.countriesByYear).toEqual({ 2024: ["IT"], 2026: ["ES"] });
  });

  it("splits day-buckets correctly across year boundary", () => {
    const stats = adaptCruise({
      stats: { ...baseStats, cruisesCount: 1, cruiseLines: ["MSC"] },
      cruises: [makeCruise({ startDate: "2023-12-30", endDate: "2024-01-02" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyActiveDays[2023]).toBe(2);
    expect(stats.yearlyActiveDays[2024]).toBe(2);
    expect(stats.monthlyActiveDays["2023-12"]).toBe(2);
    expect(stats.monthlyActiveDays["2024-01"]).toBe(2);
  });

  it("filters out scheduled and cancelled cruises", () => {
    const stats = adaptCruise({
      stats: { ...baseStats, cruisesCount: 1, cruiseLines: ["AIDA"] },
      cruises: [makeCruise({ status: "scheduled" })],
    });
    expect(stats).toEqual({ domain: "cruise", hasData: false });
  });
});

const baseLodgingStats: LodgingStats = {
  lodgingsCount: 0,
  staysCount: 0,
  totalNights: 0,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 0,
  chainsUnique: 0,
  citiesUnique: 0,
  countries: [],
  countriesCount: 0,
  spendBaseTotal: 0,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: {},
  awardNights: 0,
  nightsByType: {},
  avgRatingOverall: null,
  chainLoyaltyMax: 0,
  sameHotelRepeatMax: 0,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

function makeLodgingStay(overrides: Partial<Lodging["stays"][number]> = {}): Lodging["stays"][number] {
  return {
    id: "stay-1",
    lodgingId: "lodging-1",
    userId: "u1",
    tripId: null,
    bookingId: null,
    checkIn: "2024-06-01T00:00:00.000Z",
    checkOut: "2024-06-03T00:00:00.000Z",
    status: "completed",
    roomNumber: null,
    roomCategory: null,
    board: null,
    pricePerNight: null,
    currency: "EUR",
    totalPrice: null,
    totalPriceBase: null,
    fxRate: null,
    fxRateDate: null,
    fxBaseCurrency: null,
    fxSource: null,
    isAwardStay: false,
    ratingRoom: null,
    ratingBreakfast: null,
    ratingService: null,
    ratingOverall: null,
    roomAmenities: [],
    bookingReference: null,
    membershipId: null,
    membershipOptOut: false,
    receiptUrl: null,
    companions: [],
    notes: null,
    parserTemplate: null,
    parserConfidence: null,
    dataSource: null,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: "lodging-1",
    userId: "u1",
    type: "hotel",
    name: "Hotel Adlon",
    chainId: null,
    chain: null,
    address: null,
    city: "Berlin",
    country: "DE",
    lat: null,
    lon: null,
    stars: null,
    amenities: [],
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    stays: [],
    overallRating: null,
    stayCount: 0,
    nights: 0,
    totalSpendBase: 0,
    totalSpendBaseByCurrency: {},
    ...overrides,
  };
}

describe("adaptLodging", () => {
  it("returns hasData=false when the stats endpoint reports no stays", () => {
    const stats = adaptLodging({ stats: baseLodgingStats, lodgings: [] });
    expect(stats).toEqual({ domain: "lodging", hasData: false });
  });

  it("returns real headline figures and expands a stay into per-day buckets", () => {
    const stats = adaptLodging({
      stats: { ...baseLodgingStats, staysCount: 1, totalNights: 2, lodgingsCount: 1, chainsUnique: 1, countries: ["CH"] },
      lodgings: [
        makeLodging({
          chain: {
            id: 1,
            name: "Marriott",
            brandColor: null,
            loyaltyProgram: null,
            isUserAdded: false,
            createdAt: "2024-01-01T00:00:00.000Z",
          },
          stays: [
            makeLodgingStay({
              checkIn: "2024-06-01T00:00:00.000Z",
              checkOut: "2024-06-03T00:00:00.000Z",
            }),
          ],
        }),
      ],
    });

    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(1);
    expect(stats.yearlyEvents[2024]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-01"]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-02"]).toBe(1);
    // The check-out day itself contributes no active day.
    expect(stats.dailyActiveDays["2024-06-03"]).toBeUndefined();
    expect(stats.yearlyActiveDays[2024]).toBe(2);
    expect(stats.monthlyActiveDays["2024-06"]).toBe(2);
    expect(stats.summary.topItems?.items[0].label).toBe("Marriott");
  });

  it("excludes a cancelled stay from every bucket", () => {
    const stats = adaptLodging({
      stats: { ...baseLodgingStats, staysCount: 1 },
      lodgings: [
        makeLodging({
          stays: [makeLodgingStay({ status: "cancelled" })],
        }),
      ],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(Object.keys(stats.dailyActiveDays)).toHaveLength(0);
    expect(Object.keys(stats.yearlyEvents)).toHaveLength(0);
  });
});

describe("stub adapters", () => {
  it("poi returns hasData=false", () => {
    expect(adaptPoi()).toEqual({ domain: "poi", hasData: false });
  });
});
