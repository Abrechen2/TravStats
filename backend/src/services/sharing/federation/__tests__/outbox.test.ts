/**
 * The outbox on one server (spec 2026-10-20 F7, phase F-S4d): a change to a shared trip and its
 * message to the other server commit together or not at all; what is queued is the change with
 * the value held before, a reference by its natural key; nobody on another server means nothing
 * queued; and the backoff schedule is the spec's.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import { propagateWrite, shareSnapshot } from "../../propagate";
import { BACKOFF_MS, backoffAfter, UNREACHABLE_AFTER_MS } from "../outbox";
import { withTripFederation } from "./federationEnv";

const ME = "https://me.trip-outbox.test";
const PEER = "https://peer.trip-outbox.test";
const users: string[] = [];
const ports: number[] = [];
const ships: number[] = [];
let restoreEnv: () => Promise<void>;
const startedAt = new Date();

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.tripShareGroup.deleteMany({
    where: { createdAt: { gte: startedAt }, trips: { none: {} } },
  });
  await prisma.port.deleteMany({ where: { id: { in: ports } } });
  await prisma.ship.deleteMany({ where: { id: { in: ships } } });
  await restoreEnv();
  await prisma.$disconnect();
});

async function user(name: string) {
  const u = await prisma.user.create({
    data: { username: `obx-${randomUUID().slice(0, 8)}`, passwordHash: "x", firstName: name },
  });
  users.push(u.id);
  return u.id;
}

/** Anna's trip, shared with Ben on PEER: an active member with an accepted consent. */
async function sharedTrip(memberState = "active") {
  const anna = await user("Anna");
  const group = await prisma.tripShareGroup.create({
    data: { createdById: anna, federatedRef: randomUUID() },
  });
  const trip = await prisma.trip.create({
    data: { userId: anna, name: "Lissabon", shareGroupId: group.id },
  });
  const remote = await prisma.remoteShareAccount.create({
    data: {
      userId: anna,
      origin: PEER,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "ben",
      displayName: "Ben",
    },
  });
  await prisma.shareConsent.create({
    data: { requesterId: anna, remoteTargetId: remote.id, status: "accepted" },
  });
  const member = await prisma.tripShareRemoteMember.create({
    data: { groupId: group.id, remoteId: remote.id, state: memberState },
  });
  return { anna, group, trip, remote, member };
}

const flight = (userId: string, tripId: string) =>
  prisma.flight.create({
    data: {
      userId,
      tripId,
      shareKey: randomUUID(),
      flightNumber: "TP571",
      depIata: "FRA",
      arrIata: "LIS",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: new Date("2030-06-01T08:00:00.000Z"),
      gate: "A1",
      seatNumber: "12A",
    },
  });

async function editGate(userId: string, flightId: string, gate: string, fail = false) {
  await prisma.$transaction(async (tx) => {
    const before = await shareSnapshot(tx, "flight", flightId);
    await tx.flight.update({ where: { id: flightId }, data: { gate } });
    await propagateWrite(tx, userId, "flight", flightId, before);
    if (fail) throw new Error("the write fails after propagation");
  });
}

describe("a write and its outbound message commit together", () => {
  it("a rolled-back write leaves no message; a committed one leaves exactly one", async () => {
    const { anna, trip, member } = await sharedTrip();
    const f = await flight(anna, trip.id);

    await expect(editGate(anna, f.id, "B2", true)).rejects.toThrow("the write fails");
    expect(await prisma.tripShareOutbox.count({ where: { memberId: member.id } })).toBe(0);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).gate).toBe("A1");

    await editGate(anna, f.id, "B2");
    const rows = await prisma.tripShareOutbox.findMany({ where: { memberId: member.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "fact-update",
      peerOrigin: PEER,
      label: "TP571 FRA → LIS",
    });
    expect(rows[0].payload).toMatchObject({
      entity: "flight",
      shareKey: f.shareKey,
      changes: [{ field: "gate", before: "A1", after: "B2" }],
      actor: { displayName: "Anna" },
    });
    // A private field changed alone sends nothing anywhere.
    await prisma.$transaction(async (tx) => {
      const before = await shareSnapshot(tx, "flight", f.id);
      await tx.flight.update({ where: { id: f.id }, data: { seatNumber: "14C" } });
      await propagateWrite(tx, anna, "flight", f.id, before);
    });
    expect(await prisma.tripShareOutbox.count({ where: { memberId: member.id } })).toBe(1);
    expect(JSON.stringify(rows[0].payload)).not.toContain("12A");
  });

  it("queues nothing for a member who declined, nor for one whose consent was withdrawn", async () => {
    const declined = await sharedTrip("declined");
    const f1 = await flight(declined.anna, declined.trip.id);
    await editGate(declined.anna, f1.id, "B2");
    expect(await prisma.tripShareOutbox.count({ where: { groupId: declined.group.id } })).toBe(0);

    const withdrawn = await sharedTrip();
    await prisma.shareConsent.updateMany({
      where: { remoteTargetId: withdrawn.remote.id },
      data: { status: "withdrawn" },
    });
    const f2 = await flight(withdrawn.anna, withdrawn.trip.id);
    await editGate(withdrawn.anna, f2.id, "B2");
    expect(await prisma.tripShareOutbox.count({ where: { groupId: withdrawn.group.id } })).toBe(0);
  });

  it("still queues for a member whose server is unreachable — they get it once it answers", async () => {
    const { anna, trip, member } = await sharedTrip("unreachable");
    const f = await flight(anna, trip.id);
    await editGate(anna, f.id, "B2");
    expect(await prisma.tripShareOutbox.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("a new entry and a deleted one queue entry-create and entry-removed", async () => {
    const { anna, trip, member } = await sharedTrip();
    const added = await prisma.flight.create({
      data: {
        userId: anna,
        tripId: trip.id,
        flightNumber: "LH1",
        depIata: "MUC",
        arrIata: "LIS",
        depLat: 48.35,
        depLon: 11.79,
        arrLat: 38.77,
        arrLon: -9.13,
      },
    });
    await propagateWrite(prisma, anna, "flight", added.id);
    const keyed = await prisma.flight.findUniqueOrThrow({ where: { id: added.id } });
    expect(keyed.shareKey).not.toBeNull();
    const gone = await shareSnapshot(prisma, "flight", added.id);
    await prisma.$transaction(async (tx) => {
      await tx.flight.delete({ where: { id: added.id } });
      const { propagateDelete } = await import("../../propagate");
      await propagateDelete(tx, anna, gone);
    });
    const rows = await prisma.tripShareOutbox.findMany({
      where: { memberId: member.id },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.kind)).toEqual(["entry-create", "entry-removed"]);
    expect(rows[0].payload).toMatchObject({
      entry: { entity: "flight", shareKey: keyed.shareKey, facts: { flightNumber: "LH1" } },
    });
    expect(rows[1].payload).toMatchObject({ shareKey: keyed.shareKey, reason: "deleted" });
  });
});

describe("a reference travels by its natural key, never by this server's id", () => {
  it("a cruise's new ship is sent as its IMO, with the old one as `before`", async () => {
    const { anna, trip, member } = await sharedTrip();
    const tag = randomUUID().slice(0, 6);
    const [s1, s2] = await Promise.all(
      ["1", "2"].map((n) =>
        prisma.ship.create({
          data: { name: `MS ${n}${tag}`, imo: `9${n}${tag}`.slice(0, 7), cruiseLine: "Teste" },
        })
      )
    );
    ships.push(s1.id, s2.id);
    const cruise = await prisma.cruise.create({
      data: { userId: anna, tripId: trip.id, shareKey: randomUUID(), shipId: s1.id },
    });
    await prisma.$transaction(async (tx) => {
      const before = await shareSnapshot(tx, "cruise", cruise.id);
      await tx.cruise.update({ where: { id: cruise.id }, data: { shipId: s2.id } });
      await propagateWrite(tx, anna, "cruise", cruise.id, before);
    });
    const [row] = await prisma.tripShareOutbox.findMany({ where: { memberId: member.id } });
    const text = JSON.stringify(row.payload);
    expect(row.payload).toMatchObject({
      changes: [
        {
          field: "ship",
          before: { imo: s1.imo, name: s1.name },
          after: { imo: s2.imo, name: s2.name },
        },
      ],
    });
    expect(text).not.toContain("shipId");
  });
});

describe("the retry schedule (spec §7)", () => {
  it("waits 1 min, 5 min, 30 min, 2 h, 12 h, then a day, and calls it unreachable after 14 days", () => {
    const minutes = [1, 2, 3, 4, 5, 6, 7, 30].map((n) => backoffAfter(n) / 60_000);
    expect(minutes).toEqual([1, 5, 30, 120, 720, 1440, 1440, 1440]);
    expect(BACKOFF_MS).toHaveLength(6);
    expect(UNREACHABLE_AFTER_MS).toBe(14 * 86_400_000);
  });
});
