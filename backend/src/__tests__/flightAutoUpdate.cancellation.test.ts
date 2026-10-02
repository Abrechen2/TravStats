import { prisma } from "../db";
import {
  calculateChanges,
  convertApiDataToProposed,
  hasSignificantChanges,
  type FlightChange,
} from "../services/flightAutoUpdate";
import { applyPendingUpdate } from "../services/pendingUpdateService";

/**
 * TravStats#156: a provider's cancellation is proposed like any other change
 * (it used to be dropped), a diversion leaves the status alone, and a gate
 * or terminal change counts on its own — it is the one thing a passenger at
 * the airport needs to hear.
 */
type ApiData = Parameters<typeof convertApiDataToProposed>[0];
type StoredFlight = Parameters<typeof convertApiDataToProposed>[1];

const stored = {
  airline: "Lufthansa",
  aircraft: null,
  gate: "A26",
  terminal: "1",
  depIata: "FRA",
  depIcao: null,
  arrIata: "HND",
  arrIcao: null,
  departureTime: new Date("2026-10-14T11:25:00.000Z"),
  arrivalTime: new Date("2026-10-15T05:30:00.000Z"),
  actualDeparture: null,
  actualArrival: null,
  status: "scheduled",
  actualRoute: null,
  overflownCountries: [],
  routeDistance: null,
} as unknown as StoredFlight;

const change = (field: string, oldValue: unknown, newValue: unknown): FlightChange => ({
  field,
  oldValue: oldValue as FlightChange["oldValue"],
  newValue: newValue as FlightChange["newValue"],
  type: "changed",
});

describe("convertApiDataToProposed — status from the provider", () => {
  it("proposes a cancellation", () => {
    const proposed = convertApiDataToProposed(
      { statusOverride: "cancelled" } as unknown as ApiData,
      stored
    );
    expect(proposed.status).toBe("cancelled");
    const changes = calculateChanges(
      {
        ...stored,
        departureTime: stored.departureTime!.toISOString(),
        arrivalTime: stored.arrivalTime!.toISOString(),
      } as never,
      proposed
    );
    expect(changes.map((c) => c.field)).toContain("status");
  });

  it("leaves the status alone on a diversion", () => {
    const proposed = convertApiDataToProposed(
      { statusOverride: "diverted", arrival: { iata: "NRT" } } as unknown as ApiData,
      stored
    );
    expect(proposed.status).toBe("scheduled");
    expect(proposed.arrIata).toBe("NRT");
  });

  it("leaves the status alone without an override", () => {
    expect(convertApiDataToProposed({} as ApiData, stored).status).toBe("scheduled");
  });
});

describe("hasSignificantChanges — what a passenger needs to hear", () => {
  it.each([
    ["a gate change", change("gate", "A26", "B12")],
    ["a terminal change", change("terminal", "1", "2")],
    ["a cancellation", change("status", "scheduled", "cancelled")],
  ])("counts %s on its own", (_label, c) => {
    expect(hasSignificantChanges([c])).toBe(true);
  });

  it("still ignores a lone aircraft swap", () => {
    expect(hasSignificantChanges([change("aircraft", "A320", "A321")])).toBe(false);
  });
});

describe("applyPendingUpdate — status", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "cancellationtest" } });
    userId = (
      await prisma.user.create({ data: { username: "cancellationtest", passwordHash: "x" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function pendingWithStatus(status: string) {
    const flight = await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH712",
        depIata: "FRA",
        arrIata: "HND",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 35.55,
        arrLon: 139.78,
        status: "scheduled",
        departureTime: new Date("2026-10-14T11:25:00.000Z"),
        arrivalTime: new Date("2026-10-15T05:30:00.000Z"),
      },
    });
    const update = await prisma.pendingFlightUpdate.create({
      data: {
        userId,
        flightId: flight.id,
        apiSource: "aerodatabox",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "pending",
        originalData: { status: "scheduled" },
        proposedData: { status },
        changes: [{ field: "status", oldValue: "scheduled", newValue: status, type: "changed" }],
      },
    });
    return { flightId: flight.id, updateId: update.id };
  }

  it("writes a proposed cancellation", async () => {
    const { flightId, updateId } = await pendingWithStatus("cancelled");
    await applyPendingUpdate(updateId, userId);
    expect((await prisma.flight.findUnique({ where: { id: flightId } }))?.status).toBe("cancelled");
  });

  it("never lets a provider set any other status", async () => {
    const { flightId, updateId } = await pendingWithStatus("flown");
    await applyPendingUpdate(updateId, userId);
    expect((await prisma.flight.findUnique({ where: { id: flightId } }))?.status).toBe("scheduled");
  });
});
