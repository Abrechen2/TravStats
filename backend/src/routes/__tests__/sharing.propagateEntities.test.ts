import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Trip sharing S2 — propagation through the stay, house, cruise, rail,
 * rental and timeline-stop routes: a fact reaches the other copy with a
 * notice, a private field does not, a delete is a notice only.
 */
describe("sharing — propagation of every entry type", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  const as = (who: TestAccount) => ({
    patch: (url: string, body: object) =>
      request(app).patch(`/api/v1${url}`).set("Cookie", who.cookie).send(body),
    post: (url: string, body: object) =>
      request(app).post(`/api/v1${url}`).set("Cookie", who.cookie).send(body),
    del: (url: string) => request(app).delete(`/api/v1${url}`).set("Cookie", who.cookie),
  });

  const urls = () => ({
    stay: `/lodging/${pair.full.lodging.id}/stays/${pair.full.stay.id}`,
    cruise: `/cruises/${pair.full.cruise.id}`,
    rail: `/rail/${pair.full.rail.id}`,
    rental: `/rentals/${pair.full.rental.id}`,
    stop: `/trips/${pair.full.trip.id}/stops/${pair.full.stops[1].id}`,
  });

  const notices = (who: TestAccount) =>
    prisma.shareNotice.findMany({ where: { userId: who.id }, orderBy: { createdAt: "asc" } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
    // Settle what the fixture left underived, then start from a clean inbox.
    const u = urls();
    await as(anna).patch(u.stay, { notes: "settle" }).expect(200);
    await as(anna).patch(u.cruise, { notes: "settle" }).expect(200);
    await as(anna).patch(u.rail, { notes: "settle" }).expect(200);
    await as(anna).patch(u.rental, { notes: "settle" }).expect(200);
    await as(anna).patch(u.stop, { notes: "settle" }).expect(200);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bens = {
    stay: () =>
      prisma.lodgingStay.findFirstOrThrow({
        where: { userId: ben.id },
        include: { lodging: true },
      }),
    cruise: () =>
      prisma.cruise.findFirstOrThrow({
        where: { userId: ben.id },
        include: { stops: { orderBy: { dayNumber: "asc" } } },
      }),
    rail: () => prisma.railJourney.findFirstOrThrow({ where: { userId: ben.id } }),
    rental: () => prisma.rentalBooking.findFirstOrThrow({ where: { userId: ben.id } }),
    stop: (title: string) =>
      prisma.tripStop.findFirstOrThrow({ where: { tripId: pair.memberTrip.id, title } }),
  };

  it("updates: stay board, cruise route, rail number, rental class, stop title", async () => {
    const u = urls();
    await as(anna).patch(u.stay, { board: "half" }).expect(200);
    await as(anna).patch(u.cruise, { routeName: "Kanaren" }).expect(200);
    await as(anna).patch(u.rail, { trainNumber: "131" }).expect(200);
    await as(anna).patch(u.rental, { vehicleClass: "Kombi" }).expect(200);
    await as(anna).patch(u.stop, { title: "Belém Tower" }).expect(200);

    expect((await bens.stay()).board).toBe("half");
    expect((await bens.cruise()).routeName).toBe("Kanaren");
    expect((await bens.rail()).trainNumber).toBe("131");
    expect((await bens.rental()).vehicleClass).toBe("Kombi");
    expect(await bens.stop("Belém Tower")).toBeTruthy();
    const kinds = (await notices(ben)).map((n) => [n.kind, n.entityType]);
    expect(kinds).toEqual([
      ["updated", "lodgingStay"],
      ["updated", "cruise"],
      ["updated", "rail"],
      ["updated", "rental"],
      ["updated", "stop"],
    ]);
  });

  it("private-only edits propagate nothing", async () => {
    const u = urls();
    await as(anna).patch(u.stay, { roomNumber: "501", notes: "x" }).expect(200);
    await as(anna).patch(u.cruise, { cabinNumber: "9001" }).expect(200);
    await as(anna).patch(u.rail, { seat: "12" }).expect(200);
    await as(anna).patch(u.rental, { notes: "mine" }).expect(200);
    await as(anna).patch(u.stop, { notes: "mine" }).expect(200);
    expect(await notices(ben)).toHaveLength(0);
    expect((await bens.stay()).roomNumber).toBeNull();
    expect((await bens.cruise()).cabinNumber).toBeNull();
    expect((await bens.rail()).seat).toBeNull();
  });

  it("a cruise's port calls follow, and a member's own excursion note stays on its day", async () => {
    const copy = await bens.cruise();
    await prisma.cruiseStop.update({
      where: { id: copy.stops[1].id },
      data: { excursionNote: "Bens Levada-Wanderung" },
    });
    await as(anna)
      .patch(urls().cruise, {
        stops: [
          { dayNumber: 1, isAtSea: true },
          { dayNumber: 2, isAtSea: false, unresolvedPortName: "Funchal (Madeira)" },
          { dayNumber: 3, isAtSea: true },
        ],
      })
      .expect(200);
    const after = await bens.cruise();
    expect(after.stops.map((s) => [s.dayNumber, s.unresolvedPortName])).toEqual([
      [1, null],
      [2, "Funchal (Madeira)"],
      [3, null],
    ]);
    expect(after.stops[1].excursionNote).toBe("Bens Levada-Wanderung");
  });

  it("a change to the house itself reaches the other member's house", async () => {
    await as(anna)
      .patch(`/lodging/${pair.full.lodging.id}`, { website: "https://avenidapalace.pt" })
      .expect(200);
    expect((await bens.stay()).lodging.website).toBe("https://avenidapalace.pt");
    const [notice] = await notices(ben);
    expect(notice).toMatchObject({ kind: "updated", entityType: "lodgingStay" });
  });

  it("a new timeline stop is copied; deletes of every type are notices only", async () => {
    await as(anna).post(`/trips/${pair.full.trip.id}/stops`, { title: "Sintra" }).expect(201);
    expect(await bens.stop("Sintra")).toBeTruthy();

    const u = urls();
    await as(anna).del(u.stay).expect(204);
    await as(anna).del(u.cruise).expect(204);
    await as(anna).del(u.rail).expect(204);
    await as(anna).del(u.rental).expect(204);
    await as(anna).del(u.stop).expect(204);
    expect(await bens.stay()).toBeTruthy();
    expect(await bens.cruise()).toBeTruthy();
    expect(await bens.rail()).toBeTruthy();
    expect(await bens.rental()).toBeTruthy();
    expect(await bens.stop("Belém")).toBeTruthy();
    const deleted = (await notices(ben)).filter((n) => n.kind === "deleted");
    expect(deleted.map((n) => n.entityType).sort()).toEqual(
      ["cruise", "lodgingStay", "rail", "rental", "stop"].sort()
    );
  });
});
