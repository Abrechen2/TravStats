import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { createPendingUpdate } from "../../services/flightAutoUpdate";

/**
 * Observed takeoff/landing from a paired phone (forgejo#194), through the
 * provider path: a past landing ends "scheduled" at once, the times queue as a
 * `device_gps` suggestion under the user's review rule, and nothing the phone
 * says ever silently replaces a value already on the flight.
 *
 * The flight left two hours ago and is due in ten minutes — the live window in
 * which a phone actually reports.
 */

const HOUR = 3_600_000;

describe("POST /flights/:id/observed-times", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;
  let flightId: string;
  let otherFlightId: string;
  let departure: Date;
  let arrival: Date;

  const post = (id: string, body: unknown, auth = cookie) =>
    request(app)
      .post(`/api/v1/flights/${id}/observed-times`)
      .set(auth.startsWith("Bearer") ? "Authorization" : "Cookie", auth)
      .send(body as object);

  const flightRow = (owner: string) => ({
    userId: owner,
    flightNumber: "LH718",
    depIata: "MUC",
    depIcao: "EDDM",
    arrIata: "ICN",
    arrIcao: "RKSI",
    depLat: 48.354,
    depLon: 11.786,
    arrLat: 37.469,
    arrLon: 126.451,
    departureTime: departure,
    arrivalTime: arrival,
    status: "scheduled",
    dataSource: "manual",
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["flobs", "flobsother"] } } });
    const u = await prisma.user.create({
      data: { username: "flobs", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "flobsother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    const now = Date.now();
    departure = new Date(now - 2 * HOUR);
    arrival = new Date(now + 10 * 60_000);
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    flightId = (await prisma.flight.create({ data: flightRow(userId) })).id;
    otherFlightId = (await prisma.flight.create({ data: flightRow(otherUserId) })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it("marks the flight flown on a past landing and queues the times as the phone's", async () => {
    const token = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "Companion",
        lookupHash: token.lookupHash,
        hash: token.hash,
        scope: "write",
        deviceId: "phone-1",
      },
    });
    const landed = minutesAgo(3);
    const res = await post(
      flightId,
      { observationId: "obs-1", arrival: { at: landed, airport: "icn" } },
      `Bearer ${token.plaintext}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "pending", markedFlown: true });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.status).toBe("flown");
    expect(flight.lastModifiedBy).toBe("device_gps");
    // Approval is on by default: the time itself waits for review.
    expect(flight.actualArrival).toBeNull();

    const pending = await prisma.pendingFlightUpdate.findUniqueOrThrow({
      where: { id: res.body.pendingUpdateId },
    });
    expect(pending.apiSource).toBe("device_gps");
    expect(pending.status).toBe("pending");
    expect(pending.metadata).toMatchObject({
      evidence: "device_gps",
      via: "paired_device",
      deviceId: "phone-1",
      observationId: "obs-1",
      arrivalAirport: "ICN",
    });
    expect((pending.proposedData as { actualArrival: string }).actualArrival).toBe(landed);
  });

  it("fills an empty time at once when approval is switched off — and says it was the phone", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateRequireApproval: false },
    });
    const tookOff = minutesAgo(110);
    const landed = minutesAgo(2);
    const res = await post(flightId, { departure: { at: tookOff }, arrival: { at: landed } });

    expect(res.body.outcome).toBe("applied");
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.actualDeparture?.toISOString()).toBe(tookOff);
    expect(flight.actualArrival?.toISOString()).toBe(landed);
    expect(flight.status).toBe("flown");
    expect(flight.lastModifiedBy).toBe("device_gps");
    // Where the row came from is not what the phone observed.
    expect(flight.dataSource).toBe("manual");
  });

  it("never overwrites an applied observation without review", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateRequireApproval: false },
    });
    const first = minutesAgo(40);
    await post(flightId, { arrival: { at: first } });

    const later = await post(flightId, { arrival: { at: minutesAgo(5) } });
    expect(later.body.outcome).toBe("pending");
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.actualArrival?.toISOString()).toBe(first);
  });

  it("never overwrites a time the user typed, even with approval off", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateRequireApproval: false },
    });
    const typed = new Date(Date.now() - 50 * 60_000);
    await prisma.flight.update({
      where: { id: flightId },
      data: { actualArrival: typed, lastModifiedBy: "user" },
    });
    const res = await post(flightId, { arrival: { at: minutesAgo(10) } });
    expect(res.body.outcome).toBe("pending");
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.actualArrival?.toISOString()).toBe(typed.toISOString());
  });

  it("answers an observation the flight already carries with 'unchanged'", async () => {
    const landed = new Date(Date.now() - 20 * 60_000);
    await prisma.flight.update({ where: { id: flightId }, data: { actualArrival: landed } });
    const res = await post(flightId, { arrival: { at: landed.toISOString() } });
    expect(res.body.outcome).toBe("unchanged");
    expect(await prisma.pendingFlightUpdate.count({ where: { flightId } })).toBe(0);
  });

  it("refuses a landing at another airport — a diversion is not an arrival here", async () => {
    const res = await post(flightId, { arrival: { at: minutesAgo(3), airport: "PEK" } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "OBSERVED_AIRPORT_MISMATCH", field: "arrival.airport" });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.status).toBe("scheduled");
    expect(await prisma.pendingFlightUpdate.count({ where: { flightId } })).toBe(0);
  });

  it("accepts the destination by its ICAO code too", async () => {
    const res = await post(flightId, { arrival: { at: minutesAgo(3), airport: "RKSI" } });
    expect(res.status).toBe(200);
  });

  it("refuses an observation a day away from the schedule", async () => {
    const res = await post(flightId, {
      departure: { at: new Date(departure.getTime() - 26 * HOUR).toISOString() },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("OBSERVED_TIME_OUTSIDE_FLIGHT");
  });

  it("refuses a landing in the future", async () => {
    const res = await post(flightId, {
      arrival: { at: new Date(Date.now() + 30 * 60_000).toISOString() },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "OBSERVED_TIME_IN_FUTURE", field: "arrival.at" });
  });

  it.each([
    ["an empty body", {}],
    [
      "an arrival before the departure",
      { departure: { at: minutesAgo(5) }, arrival: { at: minutesAgo(50) } },
    ],
    ["a malformed airport code", { arrival: { at: minutesAgo(5), airport: "I-C-N" } }],
    ["a time that is not an instant", { arrival: { at: "yesterday" } }],
  ])("refuses %s with 400 VALIDATION_FAILED", async (_label, body) => {
    const res = await post(flightId, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("answers another user's flight like a missing one", async () => {
    const res = await post(otherFlightId, { arrival: { at: minutesAgo(3) } });
    expect(res.status).toBe(404);
    const other = await prisma.flight.findUniqueOrThrow({ where: { id: otherFlightId } });
    expect(other.status).toBe("scheduled");
    expect(await prisma.pendingFlightUpdate.count({ where: { flightId: otherFlightId } })).toBe(0);
  });

  it("keeps the phone's suggestion apart from a provider's", async () => {
    const res = await post(flightId, { arrival: { at: minutesAgo(3) } });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    const providerId = await createPendingUpdate(
      flight,
      { gate: "B12" },
      [{ field: "gate", oldValue: null, newValue: "B12", type: "added" }],
      "airlabs"
    );

    expect(providerId).not.toBe(res.body.pendingUpdateId);
    const device = await prisma.pendingFlightUpdate.findUniqueOrThrow({
      where: { id: res.body.pendingUpdateId },
    });
    expect(device.apiSource).toBe("device_gps");
    expect(await prisma.pendingFlightUpdate.count({ where: { flightId, status: "pending" } })).toBe(
      2
    );
  });
});
