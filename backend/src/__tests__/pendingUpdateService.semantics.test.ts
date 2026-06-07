/**
 * applyPendingUpdate must upgrade dep/arr time-semantics flags when applying
 * real-UTC times from a live API.
 *
 * Prod audit 2026-06-07: flights imported with LEGACY_FAKE_UTC semantics kept
 * that flag after a live update applied true-UTC values — display logic then
 * re-interpreted the corrected timestamps via the airport timezone, shifting
 * every shown time by the airport's UTC offset (2-3h). The same path must NOT
 * touch the flags for historical-aggregation updates (whose values inherit
 * whatever semantics the source flights had) or when no time field is applied.
 */
import { prisma } from "../db";
import { applyPendingUpdate } from "../services/pendingUpdateService";

describe("applyPendingUpdate time-semantics upgrade", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `testsemantics${Date.now()}`,
        passwordHash: "testhash",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.pendingUpdateStatistics.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function createLegacyFlight() {
    return prisma.flight.create({
      data: {
        userId,
        airline: "Ethiopian",
        flightNumber: "ET706",
        depIata: "ADD",
        arrIata: "FRA",
        depLat: 8.9779,
        depLon: 38.7993,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2026-06-02T20:55:00.000Z"),
        arrivalTime: new Date("2026-06-03T03:25:00.000Z"),
        status: "flown",
        depTimeSemantics: "LEGACY_FAKE_UTC",
        arrTimeSemantics: "LEGACY_FAKE_UTC",
      },
    });
  }

  async function createUpdate(
    flightId: string,
    apiSource: string,
    proposedData: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    return prisma.pendingFlightUpdate.create({
      data: {
        flightId,
        userId,
        status: "pending",
        originalData: {},
        proposedData,
        changes: [],
        apiSource,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  it("upgrades LEGACY_FAKE_UTC flags to UTC when a live update applies times", async () => {
    const flight = await createLegacyFlight();
    const update = await createUpdate(flight.id, "airlabs", {
      departureTime: "2026-06-02T18:05:00.000Z",
      arrivalTime: "2026-06-03T02:25:00.000Z",
    });

    const applied = await applyPendingUpdate(update.id, userId);
    expect(applied).not.toBeNull();

    const reloaded = await prisma.flight.findUnique({
      where: { id: flight.id },
    });
    expect(reloaded?.depTimeSemantics).toBe("UTC");
    expect(reloaded?.arrTimeSemantics).toBe("UTC");
    expect(reloaded?.departureTime?.toISOString()).toBe(
      "2026-06-02T18:05:00.000Z",
    );
  });

  it("marks aerodatabox-sourced updates as live tracking too", async () => {
    const flight = await createLegacyFlight();
    const update = await createUpdate(flight.id, "aerodatabox", {
      departureTime: "2026-06-02T18:05:00.000Z",
    });

    const applied = await applyPendingUpdate(update.id, userId);
    expect(applied).not.toBeNull();

    const reloaded = await prisma.flight.findUnique({
      where: { id: flight.id },
    });
    expect(reloaded?.depTimeSemantics).toBe("UTC");
    expect(reloaded?.hasLiveTracking).toBe(true);
    expect(reloaded?.routeSource).toBe("live_tracking");
  });

  it("upgrades only the side whose time is actually applied", async () => {
    const flight = await createLegacyFlight();
    const update = await createUpdate(flight.id, "aviationstack", {
      departureTime: "2026-06-02T18:05:00.000Z",
      // no arrivalTime in the proposed data
    });

    const applied = await applyPendingUpdate(update.id, userId);
    expect(applied).not.toBeNull();

    const reloaded = await prisma.flight.findUnique({
      where: { id: flight.id },
    });
    expect(reloaded?.depTimeSemantics).toBe("UTC");
    expect(reloaded?.arrTimeSemantics).toBe("LEGACY_FAKE_UTC");
  });

  it("does not touch semantics when the update applies no time fields", async () => {
    const flight = await createLegacyFlight();
    const update = await createUpdate(flight.id, "airlabs", { gate: "A14" });

    const applied = await applyPendingUpdate(update.id, userId);
    expect(applied).not.toBeNull();

    const reloaded = await prisma.flight.findUnique({
      where: { id: flight.id },
    });
    expect(reloaded?.depTimeSemantics).toBe("LEGACY_FAKE_UTC");
    expect(reloaded?.arrTimeSemantics).toBe("LEGACY_FAKE_UTC");
  });

  it("does not touch semantics for historical-aggregation updates", async () => {
    const flight = await createLegacyFlight();
    const update = await createUpdate(
      flight.id,
      "historical_aggregation",
      { departureTime: "2026-06-02T18:05:00.000Z" },
      { isHistoricalEnrichment: true, confidence: 90, sourceFlightsCount: 5 },
    );

    const applied = await applyPendingUpdate(update.id, userId);
    expect(applied).not.toBeNull();

    const reloaded = await prisma.flight.findUnique({
      where: { id: flight.id },
    });
    expect(reloaded?.depTimeSemantics).toBe("LEGACY_FAKE_UTC");
    expect(reloaded?.arrTimeSemantics).toBe("LEGACY_FAKE_UTC");
  });
});
