import { Prisma } from "../../../prisma";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../../shared/domains";

jest.mock("../../../db", () => ({
  prisma: Object.fromEntries(
    [
      "lodgingStay",
      "cruise",
      "flight",
      "trip",
      "tripRoute",
      "tripExpense",
      "railJourney",
      "busJourney",
    ].map((model) => [model, { findMany: jest.fn() }])
  ),
}));
jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../airportCache", () => ({ getCachedAirports: jest.fn(async () => new Map()) }));

import { prisma } from "../../../db";
import { loadTravelAccountData } from "../travelAccountData";
import { getCachedAirports } from "../../airportCache";
import { TRIP_COST_SELECT } from "../../trip/tripCostLoad";

const models = [
  prisma.lodgingStay,
  prisma.cruise,
  prisma.flight,
  prisma.trip,
  prisma.tripRoute,
  prisma.tripExpense,
  prisma.railJourney,
  prisma.busJourney,
];
const trip = {
  id: "trip",
  name: "Trip",
  startDate: null,
  endDate: null,
  status: "planned",
  category: null,
  tags: [],
  journalEntries: [],
  _count: { photos: 0 },
  flights: [],
  expenses: [],
  lodgingStays: [],
  cruises: [],
  railJourneys: [],
  busJourneys: [],
  ferryJourneys: [],
  rentalBookings: [],
  routes: [],
  bookings: [
    {
      price: 100,
      currency: "EUR",
      priceBase: null,
      fxBaseCurrency: null,
      _count: {
        flights: 0,
        cruises: 1,
        lodgingStays: 0,
        railJourneys: 0,
        busJourneys: 0,
        ferryJourneys: 0,
      },
    },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getCachedAirports).mockResolvedValue(new Map());
  for (const model of models) jest.mocked(model.findMany).mockResolvedValue([]);
  // Prisma returns empty arrays for relations limited to zero rows.
  jest
    .mocked(prisma.trip.findMany)
    .mockResolvedValue([trip] as unknown as Awaited<ReturnType<typeof prisma.trip.findMany>>);
});

it("skips five hidden-domain reads but retains flights, trips and trip-wide expenses", async () => {
  const result = await loadTravelAccountData("user", new Set());
  for (const model of [
    prisma.lodgingStay,
    prisma.cruise,
    prisma.tripRoute,
    prisma.railJourney,
    prisma.busJourney,
  ]) {
    expect(model.findMany).not.toHaveBeenCalled();
  }
  expect(prisma.flight.findMany).toHaveBeenCalledTimes(1);
  expect(prisma.trip.findMany).toHaveBeenCalledTimes(1);
  expect(prisma.tripExpense.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: "user", routeId: null } })
  );
  expect(prisma.trip.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        lodgingStays: expect.objectContaining({ take: 0 }),
        cruises: expect.objectContaining({ take: 0 }),
        railJourneys: expect.objectContaining({ take: 0 }),
        busJourneys: expect.objectContaining({ take: 0 }),
        ferryJourneys: expect.objectContaining({ take: 0 }),
        rentalBookings: expect.objectContaining({ take: 0 }),
        routes: expect.objectContaining({ take: 0 }),
        bookings: TRIP_COST_SELECT.bookings,
      }),
    })
  );
  expect(result.stays).toEqual([]);
  expect(result.trips[0]).toMatchObject({
    stays: [],
    cruises: [],
    rail: [],
    bus: [],
    cost: {
      stays: [],
      cruises: [],
      rail: [],
      bus: [],
      ferry: [],
      rentals: [],
      expenses: [],
      bookings: [expect.objectContaining({ segmentCount: 1 })],
    },
  });
});

it("retains all domain reads when visible", async () => {
  jest.mocked(prisma.trip.findMany).mockResolvedValue([]);
  await loadTravelAccountData("user", new Set(AVAILABLE_DOMAINS));
  for (const model of models) expect(model.findMany).toHaveBeenCalledTimes(1);
  expect(prisma.tripExpense.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: "user" } })
  );
  const args = jest.mocked(prisma.trip.findMany).mock.calls[0][0] as Prisma.TripFindManyArgs;
  for (const relation of [
    "lodgingStays",
    "cruises",
    "railJourneys",
    "busJourneys",
    "ferryJourneys",
    "rentalBookings",
    "routes",
  ] as const) {
    expect(args.select?.[relation]).toEqual(expect.objectContaining({ take: undefined }));
  }
});

it.each<{ domains: DomainKey[]; rental: boolean; routes: boolean }>([
  { domains: ["roadtrip"], rental: false, routes: true },
  { domains: ["rental"], rental: true, routes: false },
  { domains: ["roadtrip", "rental"], rental: true, routes: true },
])("gates roadtrip rentals by both domains: $domains", async ({ domains, rental, routes }) => {
  jest.mocked(prisma.trip.findMany).mockResolvedValue([]);
  await loadTravelAccountData("user", new Set(domains));
  expect(prisma.trip.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        rentalBookings: { ...TRIP_COST_SELECT.rentalBookings, take: rental ? undefined : 0 },
        routes: {
          take: routes ? undefined : 0,
          select: {
            expenses: TRIP_COST_SELECT.routes.select.expenses,
            rentals: { ...TRIP_COST_SELECT.routes.select.rentals, take: rental ? undefined : 0 },
          },
        },
      }),
    })
  );
});

it("keeps ungated flights and their stored local days", async () => {
  const flight = {
    id: "flight",
    status: "flown",
    flightNumber: "LH400",
    depIata: "NRT",
    arrIata: "MUC",
    depIcao: null,
    arrIcao: null,
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    depTimezone: "Asia/Tokyo",
    arrTimezone: "Europe/Berlin",
    departureTime: new Date("2025-12-31T20:00:00Z"),
    arrivalTime: new Date("2026-01-01T09:00:00Z"),
  };
  jest
    .mocked(prisma.flight.findMany)
    .mockResolvedValue([flight] as unknown as Awaited<ReturnType<typeof prisma.flight.findMany>>);
  const result = await loadTravelAccountData("user", new Set());
  expect(result.flights).toHaveLength(1);
  expect(result.flights[0].depLocalDay?.toISOString().slice(0, 10)).toBe("2026-01-01");
});

it("keeps roadtrip expenses when rentals are hidden", async () => {
  const amount = {
    amount: new Prisma.Decimal(12),
    currency: "EUR",
    amountBase: null,
    fxBaseCurrency: null,
  };
  const row = { ...trip, routes: [{ expenses: [amount], rentals: [] }] };
  jest
    .mocked(prisma.trip.findMany)
    .mockResolvedValue([row] as unknown as Awaited<ReturnType<typeof prisma.trip.findMany>>);
  const result = await loadTravelAccountData("user", new Set(["roadtrip"]));
  expect(result.trips[0].cost.expenses).toEqual([
    { amount: 12, currency: "EUR", amountBase: null, fxBaseCurrency: null },
  ]);
  expect(result.trips[0].cost.rentals).toEqual([]);
});
