import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../db";
import { backfillSharedFerries } from "../../services/sharing/backfillFerries";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import { shareTrip } from "../../services/sharing/shareTrip";
import { undoNotice } from "../../services/sharing/undo";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Owner decision 2026-10-16: a recipient's own entry that IS the shared one
 * but sits on ANOTHER of their trips is moved into their trip of the group
 * and stays linked. Before, it took the key where it was: no copy lookup found
 * it (copies are looked for on group trips only), the shared trip never showed
 * it, and the recipient's next own edit cleared the key again. The notice says
 * where it came from, and undoing it puts it back.
 */
describe("sharing — the recipient's own entry on another trip is moved in", () => {
  jest.setTimeout(30_000);
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-move");
    ben = await makeAccount("ben-move");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const tp576 = (userId: string, tripId: string, seatNumber?: string) =>
    prisma.flight.create({
      data: {
        userId,
        tripId,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
        ...(seatNumber ? { seatNumber } : {}),
      },
    });

  /** Ben's TP576 on his own "Lissabon allein" trip, Anna's on the shared one, propagated. */
  async function bensFlightJoinedFromOtherTrip() {
    const pair = await sharedPair(anna, ben);
    const other = await prisma.trip.create({ data: { userId: ben.id, name: "Lissabon allein" } });
    const bens = await tp576(ben.id, other.id, "BEN-SEAT");
    const annas = await tp576(anna.id, pair.full.trip.id);
    await propagateWrite(prisma, anna.id, "flight", annas.id);
    return { ...pair, other, bens, annas };
  }

  const createdNotice = () =>
    prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "created", entityType: "flight" },
    });

  it("moves it onto the shared trip, keyed, and a later change of Anna's reaches it", async () => {
    const { memberTrip, other, bens, annas } = await bensFlightJoinedFromOtherTrip();

    const joined = await prisma.flight.findUniqueOrThrow({ where: { id: bens.id } });
    const keyed = await prisma.flight.findUniqueOrThrow({ where: { id: annas.id } });
    expect(joined.tripId).toBe(memberTrip.id);
    expect(joined.shareKey).toBe(keyed.shareKey);
    expect(joined.seatNumber).toBe("BEN-SEAT");
    const after = (await createdNotice()).after as Record<string, unknown>;
    expect(after.joined).toBe(true);
    expect(after.movedFrom).toEqual({ tripId: other.id, tripName: "Lissabon allein" });

    const before = await shareSnapshot(prisma, "flight", annas.id);
    await prisma.flight.update({ where: { id: annas.id }, data: { aircraft: "A321neo" } });
    await propagateWrite(prisma, anna.id, "flight", annas.id, before);
    const reached = await prisma.flight.findUniqueOrThrow({ where: { id: bens.id } });
    expect(reached.aircraft).toBe("A321neo");
  });

  it("moves it in on a share too, with a notice naming the trip it came from", async () => {
    const full = await makeFullTrip(anna);
    const other = await prisma.trip.create({ data: { userId: ben.id, name: "Portugal 2025" } });
    const bens = await prisma.flight.create({
      data: {
        userId: ben.id,
        tripId: other.id,
        flightNumber: "TP 571",
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 38.7742,
        arrLon: -9.1342,
        departureTime: new Date("2025-05-01T05:30:00.000Z"),
        depTimezone: "Europe/Berlin",
      },
    });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, full.trip.id, companion.id);

    const bensTrip = await prisma.trip.findFirstOrThrow({
      where: { userId: ben.id, shareGroupId: { not: null } },
    });
    const moved = await prisma.flight.findUniqueOrThrow({ where: { id: bens.id } });
    expect(moved.tripId).toBe(bensTrip.id);
    expect(moved.shareKey).not.toBeNull();
    const after = (await createdNotice()).after as Record<string, unknown>;
    expect(after.movedFrom).toEqual({ tripId: other.id, tripName: "Portugal 2025" });
  });

  it("undoing the notice moves it back and unlinks it", async () => {
    const { other, bens } = await bensFlightJoinedFromOtherTrip();
    const notice = await createdNotice();

    await undoNotice(ben.id, notice.id);

    const back = await prisma.flight.findUniqueOrThrow({ where: { id: bens.id } });
    expect(back.tripId).toBe(other.id);
    expect(back.shareKey).toBeNull();
    expect(back.seatNumber).toBe("BEN-SEAT");
    const done = await prisma.shareNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect(done.undoneAt).not.toBeNull();
  });

  it("keeps the key through Ben's next own edit", async () => {
    const { bens, annas } = await bensFlightJoinedFromOtherTrip();
    const key = (await prisma.flight.findUniqueOrThrow({ where: { id: annas.id } })).shareKey;

    const before = await shareSnapshot(prisma, "flight", bens.id);
    await prisma.flight.update({ where: { id: bens.id }, data: { seatNumber: "15A" } });
    await propagateWrite(prisma, ben.id, "flight", bens.id, before);

    const edited = await prisma.flight.findUniqueOrThrow({ where: { id: bens.id } });
    expect(edited.shareKey).toBe(key);
  });

  it("counts a crossing moved in by the ferry backfill apart from plain joins", async () => {
    const annasTrip = await prisma.trip.create({ data: { userId: anna.id, name: "Fjorde" } });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, annasTrip.id, companion.id);
    const bensOther = await prisma.trip.create({ data: { userId: ben.id, name: "Norwegen" } });
    const crossing = (userId: string, tripId: string) =>
      prisma.ferryJourney.create({
        data: {
          userId,
          tripId,
          operator: "Fjord Line",
          depStationName: "Hirtshals",
          depLat: 57.5927,
          depLon: 9.9628,
          depTimezone: "Europe/Copenhagen",
          arrStationName: "Bergen",
          arrLat: 60.3958,
          arrLon: 5.3141,
          arrTimezone: "Europe/Oslo",
          departureTime: new Date("2026-07-01T18:00:00Z"),
          status: "scheduled",
        },
      });
    await crossing(anna.id, annasTrip.id);
    const bens = await crossing(ben.id, bensOther.id);

    const result = await backfillSharedFerries({ apply: false });
    expect(result).toMatchObject({ keyed: 1, joined: 0, moved: 1, copied: 0 });
    const untouched = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: bens.id } });
    expect(untouched.tripId).toBe(bensOther.id);
  });
});
