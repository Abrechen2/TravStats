import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import type { Flight } from "../../prisma";
import type { ChangeEntry, FlightDataSnapshot } from "../../services/pendingUpdates/snapshot";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import {
  sharedPair,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * One provider change reaches a member once (spec 2026-10-16, D7): when
 * another member's change brings the copy to what a pending update proposes,
 * that update is superseded — the share notice is the item. Only when it
 * proposes nothing the copy lacks.
 */
describe("trip sharing — a propagated change supersedes the member's own suggestion", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annasFlightId: string;
  let bensFlightId: string;

  /**
   * What `convertApiDataToProposed` writes: the WHOLE snapshot, every field the
   * provider reported, with only the ones in `changes` actually proposed. The
   * route arrives as an object and the overflown countries as an array, which
   * no `===` against the stored column will ever match.
   */
  const fullSnapshot = (flight: Flight, over: FlightDataSnapshot): FlightDataSnapshot => ({
    airline: flight.airline,
    aircraft: "Airbus A320neo",
    gate: flight.gate,
    terminal: flight.terminal,
    depIata: flight.depIata,
    depIcao: "EDDF",
    depName: "Frankfurt am Main",
    arrIata: flight.arrIata,
    arrIcao: "LPPT",
    arrName: "Lisboa Humberto Delgado",
    departureTime: flight.departureTime?.toISOString() ?? null,
    arrivalTime: flight.arrivalTime?.toISOString() ?? null,
    actualDeparture: "2025-05-01T08:12:00.000Z",
    actualArrival: "2025-05-01T11:04:00.000Z",
    status: flight.status,
    actualRoute: {
      type: "LineString",
      coordinates: [
        [8.5622, 50.0379],
        [-1.2, 44.1],
        [-9.1342, 38.7742],
      ],
    },
    overflownCountries: ["DE", "FR", "ES", "PT"],
    routeDistance: 1890,
    ...over,
  });

  const change = (field: string, oldValue: string | null, newValue: string): ChangeEntry => ({
    field,
    oldValue,
    newValue,
    type: oldValue === null ? "added" : "changed",
  });

  const pendingFor = async (
    userId: string,
    flightId: string,
    proposed: FlightDataSnapshot,
    changes: ChangeEntry[],
    edit?: { data: FlightDataSnapshot; changes: ChangeEntry[] }
  ) => {
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    return prisma.pendingFlightUpdate.create({
      data: {
        flightId,
        userId,
        status: edit ? "edited" : "pending",
        originalData: fullSnapshot(flight, {}) as object,
        proposedData: proposed as object,
        changes: changes as unknown as object,
        ...(edit
          ? {
              editedData: edit.data as object,
              editedChanges: edit.changes as unknown as object,
            }
          : {}),
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  };
  const bensFlight = () => prisma.flight.findUniqueOrThrow({ where: { id: bensFlightId } });
  const annaChanges = async (data: { gate?: string; terminal?: string }) => {
    const before = await shareSnapshot(prisma, "flight", annasFlightId);
    await prisma.flight.update({ where: { id: annasFlightId }, data });
    await propagateWrite(prisma, anna.id, "flight", annasFlightId, before);
  };
  const statusOf = async (id: string) =>
    (await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id } })).status;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-sup");
    ben = await makeAccount("ben-sup");
    const { full } = await sharedPair(anna, ben);
    annasFlightId = full.flight.id;
    bensFlightId = (await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } })).id;
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("supersedes a full provider snapshot whose every proposed field the change brought", async () => {
    const copy = await bensFlight();
    const update = await pendingFor(ben.id, bensFlightId, fullSnapshot(copy, { gate: "B12" }), [
      change("gate", copy.gate, "B12"),
    ]);
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("superseded");
    const meta = (await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: update.id } }))
      .metadata as { supersededBy?: { actorId: string; noticeId: string } };
    expect(meta.supersededBy?.actorId).toBe(anna.id);
    const notice = await prisma.shareNotice.findUniqueOrThrow({
      where: { id: meta.supersededBy?.noticeId as string },
    });
    expect(notice.userId).toBe(ben.id);
  });

  it("keeps a partially satisfied update open", async () => {
    const copy = await bensFlight();
    const update = await pendingFor(
      ben.id,
      bensFlightId,
      fullSnapshot(copy, { gate: "B12", terminal: "2" }),
      [change("gate", copy.gate, "B12"), change("terminal", copy.terminal, "2")]
    );
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("pending");
  });

  it("keeps an edited update whose edit differs", async () => {
    const copy = await bensFlight();
    const update = await pendingFor(
      ben.id,
      bensFlightId,
      fullSnapshot(copy, { gate: "B12" }),
      [change("gate", copy.gate, "B12")],
      { data: { gate: "C3" }, changes: [change("gate", copy.gate, "C3")] }
    );
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("edited");
  });

  it("supersedes an edited update whose edit the change brought", async () => {
    const copy = await bensFlight();
    const update = await pendingFor(
      ben.id,
      bensFlightId,
      fullSnapshot(copy, { gate: "B12" }),
      [change("gate", copy.gate, "B12")],
      { data: { gate: "C3" }, changes: [change("gate", copy.gate, "C3")] }
    );
    await annaChanges({ gate: "C3" });
    expect(await statusOf(update.id)).toBe("superseded");
  });

  it("accepting a suggestion supersedes the other member's identical one, which leaves the inbox", async () => {
    const annas = await prisma.flight.findUniqueOrThrow({ where: { id: annasFlightId } });
    const copy = await bensFlight();
    const annasUpdate = await pendingFor(
      anna.id,
      annasFlightId,
      fullSnapshot(annas, { gate: "B12" }),
      [change("gate", annas.gate, "B12")]
    );
    const bensUpdate = await pendingFor(ben.id, bensFlightId, fullSnapshot(copy, { gate: "B12" }), [
      change("gate", copy.gate, "B12"),
    ]);

    await request(app)
      .post(`/api/v1/pending-updates/${annasUpdate.id}/apply`)
      .set("Cookie", anna.cookie)
      .expect(200);

    expect((await bensFlight()).gate).toBe("B12");
    expect(await statusOf(bensUpdate.id)).toBe("superseded");
    // The inbox and the navigation badge ask for exactly these two statuses.
    for (const status of ["pending", "edited"]) {
      const res = await request(app)
        .get(`/api/v1/pending-updates?status=${status}`)
        .set("Cookie", ben.cookie)
        .expect(200);
      expect(res.body.count).toBe(0);
    }
  });
});
