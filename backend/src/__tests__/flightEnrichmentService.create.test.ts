import { prisma } from "../db";
import {
  createHistoricalEnrichment,
  type AggregatedFlightData,
} from "../services/flightEnrichmentService";

/**
 * Characterization of `createHistoricalEnrichment` (forgejo#386 REF-15: the
 * function was split into snapshot, proposal, impact and gate steps). It had no
 * test at all; these pin the gates, the full/slim proposal and the
 * create-or-update of the pending row against a real database.
 */
const aggregated = (over: Partial<AggregatedFlightData> = {}): AggregatedFlightData => ({
  aircraft: "A388",
  depIcao: "EDDF",
  depIata: "FRA",
  arrIcao: "RJTT",
  arrIata: "HND",
  gate: "B44",
  terminal: "1",
  typicalRoute: {
    waypoints: [{ lat: 50, lon: 8 }],
    overflownCountries: ["RU"],
    routeDistance: 9300,
  },
  sourceFlightsCount: 5,
  confidence: 80,
  anomalies: [],
  routeConsistency: "high",
  ...over,
});

describe("createHistoricalEnrichment", () => {
  let userId: string;

  const makeFlight = (departureTime: Date) =>
    prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber: "LH716",
        depIata: "FRA",
        arrIata: "HND",
        depLat: 50.03,
        depLon: 8.56,
        arrLat: 35.55,
        arrLon: 139.78,
        departureTime,
        arrivalTime: new Date(departureTime.getTime() + 12 * 3600_000),
        status: "flown",
        gate: null,
        terminal: null,
        aircraft: null,
      },
    });

  const setSettings = (enabled: boolean, minConfidence = 60) =>
    prisma.userSettings.update({
      where: { userId },
      data: {
        historicalEnrichmentEnabled: enabled,
        historicalEnrichmentMinConfidence: minConfidence,
      },
    });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `enrichcreate${Date.now()}`, passwordHash: "testhash" },
    });
    userId = user.id;
    await prisma.userSettings.create({ data: { userId, data: {} } });
  });

  afterEach(async () => {
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns null for an unknown flight and for another user's flight", async () => {
    await setSettings(true);
    const flight = await makeFlight(new Date(Date.now() - 30 * 86400_000));
    expect(await createHistoricalEnrichment("nope", aggregated())).toBeNull();
    expect(await createHistoricalEnrichment(flight.id, aggregated(), "someone-else")).toBeNull();
  });

  it("creates nothing when enrichment is disabled for the user", async () => {
    await setSettings(false);
    const flight = await makeFlight(new Date(Date.now() - 30 * 86400_000));
    expect(await createHistoricalEnrichment(flight.id, aggregated())).toBeNull();
    expect(await prisma.pendingFlightUpdate.count({ where: { userId } })).toBe(0);
  });

  it("creates nothing when the confidence is below the user's threshold", async () => {
    await setSettings(true, 90);
    const flight = await makeFlight(new Date(Date.now() - 30 * 86400_000));
    expect(await createHistoricalEnrichment(flight.id, aggregated({ confidence: 80 }))).toBeNull();
    expect(await prisma.pendingFlightUpdate.count({ where: { userId } })).toBe(0);
  });

  it("proposes aircraft, gate, terminal and route for a flight under a year old (full)", async () => {
    await setSettings(true);
    const flight = await makeFlight(new Date(Date.now() - 30 * 86400_000));
    const id = await createHistoricalEnrichment(flight.id, aggregated());
    expect(id).toEqual(expect.any(String));
    const row = await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: id! } });
    expect(row.apiSource).toBe("historical_aggregation");
    expect(row.status).toBe("pending");
    expect(row.proposedData).toMatchObject({
      aircraft: "A388",
      gate: "B44",
      terminal: "1",
      routeDistance: 9300,
      overflownCountries: ["RU"],
    });
    expect(row.originalData).toMatchObject({ aircraft: null, gate: null, depIata: "FRA" });
    expect(row.metadata).toMatchObject({
      isHistoricalEnrichment: true,
      enrichmentMode: "full",
      sourceFlightsCount: 5,
      confidence: 80,
      routeConsistency: "high",
    });
    const fields = (row.changes as Array<{ field: string }>).map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(["aircraft", "gate", "terminal"]));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
  });

  it("proposes only codes and terminal for a flight over a year old (slim)", async () => {
    await setSettings(true);
    const flight = await makeFlight(new Date(Date.now() - 800 * 86400_000));
    const id = await createHistoricalEnrichment(flight.id, aggregated());
    const row = await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: id! } });
    expect(row.proposedData).toMatchObject({ aircraft: null, gate: null, terminal: "1" });
    expect(row.metadata).toMatchObject({ enrichmentMode: "slim" });
  });

  it("updates the open pending row instead of adding a second one", async () => {
    await setSettings(true);
    const flight = await makeFlight(new Date(Date.now() - 30 * 86400_000));
    const first = await createHistoricalEnrichment(flight.id, aggregated());
    const second = await createHistoricalEnrichment(flight.id, aggregated({ gate: "C1" }));
    expect(second).toBe(first);
    expect(await prisma.pendingFlightUpdate.count({ where: { flightId: flight.id } })).toBe(1);
    const row = await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: first! } });
    expect(row.proposedData).toMatchObject({ gate: "C1" });
  });
});
