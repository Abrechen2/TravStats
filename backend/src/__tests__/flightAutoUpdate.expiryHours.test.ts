import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { createPendingUpdate } from "../services/flightAutoUpdate";

/**
 * forgejo#389: "Expiry (hours)" was saved and returned but the service
 * hard-coded 24 h. A pending suggestion now lives as long as the user's
 * setting says (or until the flight has ended, whichever is later).
 */
const HOUR = 3_600_000;

describe("createPendingUpdate honours autoUpdateExpiryHours", () => {
  let userId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "expiryhours" } });
    const u = await prisma.user.create({
      data: { username: "expiryhours", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    await prisma.userSettings.create({ data: { userId, data: {}, autoUpdateExpiryHours: 72 } });
    const f = await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH400",
        depIata: "FRA",
        depIcao: "EDDF",
        arrIata: "JFK",
        arrIcao: "KJFK",
        depLat: 50,
        depLon: 8,
        arrLat: 40,
        arrLon: -73,
        departureTime: new Date(Date.now() + 10 * HOUR),
        arrivalTime: new Date(Date.now() + 19 * HOUR),
        status: "scheduled",
        dataSource: "manual",
      },
    });
    flightId = f.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "expiryhours" } });
  });

  const change = [{ field: "gate", oldValue: null, newValue: "B12", type: "added" as const }];

  it("expires a new suggestion after the configured hours, not a fixed 24", async () => {
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    const id = await createPendingUpdate(flight, { gate: "B12" }, change, "airlabs");
    const row = await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: id! } });
    const hours = (row.expiresAt.getTime() - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
  });

  it("applies the same window when an open suggestion is refreshed", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { autoUpdateExpiryHours: 48 } });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    const id = await createPendingUpdate(flight, { gate: "C3" }, change, "airlabs");
    const row = await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: id! } });
    const hours = (row.expiresAt.getTime() - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
  });
});
