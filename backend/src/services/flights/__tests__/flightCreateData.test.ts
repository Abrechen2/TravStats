import { buildFlightCreateData, type FlightCreateContext } from "../flightCreateData";
import type { CreateFlightInput } from "../../../schemas/flight";
import { flightZoneColumns } from "../../../routes/flights/timeInput";
import { Prisma } from "../../../prisma";

// Only infrastructure boundaries are replaced. Time conversion, status, CO2,
// aircraft normalization and the create-field mapping run their real code.
jest.mock("../../../db", () => {
  throw new Error("This unit test must not load the database");
});
jest.mock("../../../prisma", () => ({ Prisma: { JsonNull: "test-json-null" } }));
jest.mock("../../../middleware/errorHandler", () => ({ AppError: class extends Error {} }));
jest.mock("../../airlineCatalogCache", () => ({ getAirlineCatalogSync: () => [] }));
jest.mock("../../aircraftCatalogCache", () => ({ getAircraftCatalogSync: () => [] }));
jest.mock("../../../routes/flights/timeInput", () => ({ flightZoneColumns: jest.fn() }));

const input = (): CreateFlightInput => ({
  airline: "Lufthansa",
  operatingAirline: "British Airways",
  flightNumber: "LH400",
  departure: { iata: "FRA", lat: 50.03, lon: 8.57 },
  arrival: { iata: "JFK", lat: 40.64, lon: -73.78 },
  departureLocal: "2026-06-01T10:00",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2026-06-01T13:00",
  arrTimezone: "America/New_York",
  actualDepartureLocal: "2026-06-01T10:25",
  actualDepartureTz: "Europe/Berlin",
  actualArrivalLocal: "2026-06-01T13:10",
  actualArrivalTz: "America/New_York",
  companions: [],
  status: "scheduled",
  seatClass: "first",
  aircraft: "A380",
  aircraftRegistration: "D-TEST",
  aircraftModeS: "123abc",
  specialType: "training",
  patternLat: 48.1,
  patternLon: 11.6,
  price: 123,
  taxes: 10,
  fees: 2,
  currency: "EUR",
  seatNumber: "1A",
  bookingReference: "TEST01",
  baggageBelt: "4",
  isCargo: false,
  aerodataboxQualityTags: ["test"],
});

const context = (): FlightCreateContext => ({
  mode: "import",
  userId: "test-user",
  externalRef: "test-reference",
  importBatchId: "test-batch",
  enriched: {
    departure: { iata: "FRA", icao: "EDDF", name: "Frankfurt", lat: 50.03, lon: 8.57 },
    arrival: { iata: "JFK", icao: "KJFK", name: "New York", lat: 40.64, lon: -73.78 },
  },
  companionNames: ["Resolved Name"],
  fx: {
    priceBase: 123,
    fxRate: 1,
    fxRateDate: new Date("2026-06-01T00:00:00Z"),
    fxBaseCurrency: "EUR",
    fxSource: "manual",
  },
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-13T12:00:00Z"));
  jest.mocked(flightZoneColumns).mockResolvedValue({
    depTimezone: "Europe/Berlin",
    arrTimezone: "America/New_York",
    depPrecision: "minute",
    arrPrecision: "minute",
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("flight create data", () => {
  it("keeps the enriched airports, resolved companions, metadata and caller's FX snapshot", async () => {
    const ctx = context();
    const row = await buildFlightCreateData(input(), ctx);
    expect(row).toMatchObject({
      userId: ctx.userId,
      externalRef: ctx.externalRef,
      importBatchId: ctx.importBatchId,
      depIcao: "EDDF",
      depName: "Frankfurt",
      arrIcao: "KJFK",
      arrName: "New York",
      companions: ["Resolved Name"],
      ...ctx.fx,
      seatClass: "first",
      aircraft: "Airbus A380-800",
      aircraftRegistration: "D-TEST",
      aircraftModeS: "123abc",
      specialType: "training",
      patternLat: 48.1,
      patternLon: 11.6,
      seatNumber: "1A",
      bookingReference: "TEST01",
      baggageBelt: "4",
      isCargo: false,
      aerodataboxQualityTags: ["test"],
      price: 123,
      taxes: 10,
      fees: 2,
      currency: "EUR",
      dataSource: "email_import",
      lastModifiedBy: "user",
    });
  });

  it("converts each airport clock and derives delay, status, distance and cabin-weighted CO2", async () => {
    const row = await buildFlightCreateData(input(), context());
    expect(row).toMatchObject({
      departureTime: new Date("2026-06-01T08:00:00Z"),
      arrivalTime: new Date("2026-06-01T17:00:00Z"),
      actualDeparture: new Date("2026-06-01T08:25:00Z"),
      actualArrival: new Date("2026-06-01T17:10:00Z"),
      delayMinutes: 25,
      status: "flown",
      nextApiCheckAt: null,
    });
    expect(row.routeDistance).toBeGreaterThan(6100);
    expect(row.routeDistance).toBeLessThan(6300);
    expect(row.co2Kg).toBeGreaterThan(4700);
    expect(row.co2Kg).toBeLessThan(5000);
  });

  it.each(["cancelled", "historical", "duplicated"] as const)(
    "preserves the explicit %s status",
    async (status) => {
      expect((await buildFlightCreateData({ ...input(), status }, context())).status).toBe(status);
    }
  );

  it("retains empty and nullable defaults for an undated flight", async () => {
    const row = await buildFlightCreateData(
      {
        airline: undefined,
        operatingAirline: undefined,
        flightNumber: undefined,
        aircraftRegistration: undefined,
        departure: input().departure,
        arrival: input().arrival,
        status: "scheduled",
        companions: [],
        aerodataboxQualityTags: [],
      },
      context()
    );
    expect(row).toMatchObject({
      departureTime: null,
      arrivalTime: null,
      actualDeparture: null,
      delayMinutes: null,
      aircraft: null,
      tags: [],
      coPassengers: [],
      specialType: null,
      specialData: Prisma.JsonNull,
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
    });
  });

  it("resolves both airline names for imports but preserves supplied designators and source", async () => {
    expect(await buildFlightCreateData(input(), context())).toMatchObject({
      airlineIata: "LH",
      operatingAirlineIata: "BA",
    });
    expect(
      await buildFlightCreateData(
        { ...input(), airlineIata: "XX", operatingAirlineIcao: "XXX", dataSource: "bulk_import" },
        context()
      )
    ).toMatchObject({ airlineIata: "XX", operatingAirlineIcao: "XXX", dataSource: "bulk_import" });
  });

  it("keeps single-create provenance, checked trip and token context", async () => {
    const ctx: FlightCreateContext = {
      ...context(),
      mode: "single",
      tripId: "owned-trip",
      apiToken: { id: "test-token" },
    };
    const row = await buildFlightCreateData(input(), ctx);
    expect(row).toMatchObject({ dataSource: "manual", tripId: "owned-trip", airlineIata: "LH" });
    expect(row.operatingAirlineIata).toBeUndefined();
    expect(row.operatingAirlineIcao).toBeUndefined();
    expect(flightZoneColumns).toHaveBeenCalledWith(input(), ctx.enriched, undefined, {
      userId: ctx.userId,
      apiToken: ctx.apiToken,
    });
    expect(
      await buildFlightCreateData(
        { ...input(), dataSource: "email_import", operatingAirlineIata: "BA" },
        ctx
      )
    ).toMatchObject({ dataSource: "email_import", operatingAirlineIata: "BA" });
  });

  it("gives single create and import identical shared columns", async () => {
    const data: CreateFlightInput = {
      ...input(),
      operatingAirlineIata: "BA",
      operatingAirlineIcao: "BAW",
      dataSource: "bulk_import",
    };
    const imported = await buildFlightCreateData(data, context());
    const single = await buildFlightCreateData(data, { ...context(), mode: "single" });
    expect(single).toEqual(imported);
  });

  it("does not invent a trip association for package imports or mix per-flight FX amounts", async () => {
    const ctx = context();
    const first = await buildFlightCreateData(input(), ctx);
    const second = await buildFlightCreateData(
      { ...input(), price: 500 },
      { ...ctx, fx: { ...ctx.fx, priceBase: 500 } }
    );
    expect(first).not.toHaveProperty("tripId");
    expect(first.priceBase).toBe(123);
    expect(second.priceBase).toBe(500);
    expect(ctx.fx.priceBase).toBe(123);
  });
});
