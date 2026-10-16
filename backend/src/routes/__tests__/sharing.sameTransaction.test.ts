import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ADAPTERS } from "../../services/sharing/adapters";
import { applyPendingUpdate } from "../../services/pendingUpdateService";
import { updateStayRecord } from "../../services/lodging/stayWrites";
import {
  sharedPair,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A member never sees "saved" for a change the others did not get (spec
 * 2026-10-16, D8). These three paths wrote first and propagated in a
 * transaction of their own; a failed propagation left the write stored.
 */
describe("trip sharing — propagation shares the write's transaction", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-tx");
    ben = await makeAccount("ben-tx");
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("assigning a flight to the shared trip rolls back when the copy fails", async () => {
    const { full } = await sharedPair(anna, ben);
    const loose = await prisma.flight.create({
      data: {
        userId: anna.id,
        flightNumber: "LH1170",
        depIata: "FRA",
        depLat: 50.0379,
        depLon: 8.5622,
        arrIata: "LIS",
        arrLat: 38.7742,
        arrLon: -9.1342,
      },
    });
    jest.spyOn(ADAPTERS.flight, "createCopy").mockRejectedValueOnce(new Error("copy failed"));
    const res = await request(app)
      .post(`/api/v1/trips/${full.trip.id}/flights`)
      .set("Cookie", anna.cookie)
      .send({ flightIds: [loose.id], action: "add" });
    expect(res.status).toBe(500);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: loose.id } })).tripId).toBeNull();
  });

  it("assigning several flights to the shared trip copies each to the member", async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    const base = {
      userId: anna.id,
      depIata: "FRA",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "LIS",
      arrLat: 38.7742,
      arrLon: -9.1342,
    };
    const loose = await Promise.all(
      ["LH1170", "LH1171", "LH1172", "LH1173"].map((flightNumber) =>
        prisma.flight.create({ data: { ...base, flightNumber } })
      )
    );
    const before = await prisma.flight.count({ where: { userId: ben.id, tripId: memberTrip.id } });
    const res = await request(app)
      .post(`/api/v1/trips/${full.trip.id}/flights`)
      .set("Cookie", anna.cookie)
      .send({ flightIds: loose.map((f) => f.id), action: "add" });
    expect(res.status).toBe(200);
    expect(await prisma.flight.count({ where: { userId: ben.id, tripId: memberTrip.id } })).toBe(
      before + loose.length
    );
  });

  it("a stay edit rolls back when the copy cannot follow", async () => {
    const { full } = await sharedPair(anna, ben);
    jest.spyOn(ADAPTERS.lodgingStay, "apply").mockRejectedValueOnce(new Error("apply failed"));
    await expect(updateStayRecord(anna.id, full.stay, { board: "half_board" })).rejects.toThrow(
      "apply failed"
    );
    expect(
      (await prisma.lodgingStay.findUniqueOrThrow({ where: { id: full.stay.id } })).board
    ).toBe("breakfast");
  });

  it("an accepted pending update stays pending when the copy cannot follow", async () => {
    const { full } = await sharedPair(anna, ben);
    const update = await prisma.pendingFlightUpdate.create({
      data: {
        flightId: full.flight.id,
        userId: anna.id,
        status: "pending",
        originalData: { gate: null },
        proposedData: { gate: "B12" },
        changes: [{ field: "gate", type: "added", oldValue: null, newValue: "B12" }],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    jest.spyOn(ADAPTERS.flight, "apply").mockRejectedValueOnce(new Error("apply failed"));
    // applyPendingUpdate catches every error and answers null.
    await expect(applyPendingUpdate(update.id, anna.id)).resolves.toBeNull();
    expect(
      (await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } })).gate
    ).toBeNull();
    expect(
      (await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: update.id } })).status
    ).toBe("pending");
  });
});
