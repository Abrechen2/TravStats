import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { makeFullTrip, type TestAccount } from "./sharingFixtures";

/**
 * Settings → Mitreisende (owner, 2026-10-22): rename, merge and delete a
 * companion. "Norbert", "Norber" and "Norbert Wittke" were three rows for one
 * person; these are the rules that make them one without losing a link, an
 * expense or another account's data.
 */
const PREFIX = "companions-manage-";

async function account(name: string): Promise<TestAccount> {
  const user = await prisma.user.create({
    data: { username: `${PREFIX}${name}`, passwordHash: "x", firstName: name },
  });
  // Rail and cruise visible; rental stays behind its beta switch.
  await prisma.userSettings.create({
    data: { userId: user.id, data: {}, enabledDomains: ["flight", "cruise", "rail", "rental"] },
  });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

const companion = (userId: string, name: string, linkedUserId: string | null = null) =>
  prisma.companion.create({
    data: {
      userId,
      canonicalName: name.toLowerCase(),
      displayName: name,
      searchName: name.toLowerCase(),
      linkedUserId,
    },
  });

describe("companions — manage", () => {
  let anna: TestAccount;
  let eve: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    anna = await account("anna");
    eve = await account("eve");
    full = await makeFullTrip(anna);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const patch = (who: TestAccount, id: string, name: string) =>
    request(app).patch(`/api/v1/companions/${id}`).set("Cookie", who.cookie).send({ name });
  const merge = (who: TestAccount, id: string, into: string) =>
    request(app).post(`/api/v1/companions/${id}/merge`).set("Cookie", who.cookie).send({ into });

  it("renames a companion and every list of names that spells them", async () => {
    const norber = await companion(anna.id, "Norber");
    await prisma.flightCompanion.create({
      data: { flightId: full.flight.id, companionId: norber.id, position: 0 },
    });
    await prisma.flight.update({
      where: { id: full.flight.id },
      data: { companions: ["Norber", "Ben"] },
    });
    await prisma.trip.update({ where: { id: full.trip.id }, data: { companions: ["norber"] } });
    // A stay has no join row: its array is matched by the name alone.
    await prisma.lodgingStay.update({
      where: { id: full.stay.id },
      data: { companions: ["NORBER", "Ben"] },
    });
    const before = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });

    const res = await patch(anna, norber.id, "  Norbert   Wittke ").expect(200);
    expect(res.body.companion).toEqual({ id: norber.id, name: "Norbert Wittke" });

    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(flight.companions).toEqual(["Norbert Wittke", "Ben"]);
    // The phone re-reads an entry whose `updated_at` moved.
    expect(flight.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    expect(trip.companions).toEqual(["Norbert Wittke"]);
    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: full.stay.id } });
    expect(stay.companions).toEqual(["Norbert Wittke", "Ben"]);
    const row = await prisma.companion.findUniqueOrThrow({ where: { id: norber.id } });
    expect(row).toMatchObject({ canonicalName: "norbert wittke", searchName: "norbert wittke" });
  });

  it("refuses a rename onto another companion's name, and names that companion", async () => {
    const norber = await companion(anna.id, "Norber");
    const norbert = await companion(anna.id, "Norbert");
    await prisma.flight.update({ where: { id: full.flight.id }, data: { companions: ["Norber"] } });

    const res = await patch(anna, norber.id, "NORBERT").expect(409);
    expect(res.body).toMatchObject({
      code: "COMPANION_NAME_TAKEN",
      companionId: norbert.id,
      companionName: "Norbert",
    });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(flight.companions).toEqual(["Norber"]);
  });

  it("answers 404 for another account's companion and leaves it alone", async () => {
    const evesNorbert = await companion(eve.id, "Norbert");
    const annas = await companion(anna.id, "Norber");
    await patch(anna, evesNorbert.id, "Mallory").expect(404);
    await request(app)
      .delete(`/api/v1/companions/${evesNorbert.id}`)
      .set("Cookie", anna.cookie)
      .expect(404);
    await merge(anna, annas.id, evesNorbert.id).expect(404);
    await merge(anna, evesNorbert.id, annas.id).expect(404);
    await request(app)
      .get(`/api/v1/companions/${annas.id}/merge-preview?into=${evesNorbert.id}`)
      .set("Cookie", anna.cookie)
      .expect(404);
    expect(await prisma.companion.findUnique({ where: { id: evesNorbert.id } })).toMatchObject({
      displayName: "Norbert",
    });
  });

  it("merges entries, a shared entry once at the lower position, expenses and lists", async () => {
    const source = await companion(anna.id, "Norber");
    const target = await companion(anna.id, "Norbert");
    // Both on the flight: the source listed first.
    await prisma.flightCompanion.createMany({
      data: [
        { flightId: full.flight.id, companionId: source.id, position: 0 },
        { flightId: full.flight.id, companionId: target.id, position: 2 },
      ],
    });
    await prisma.flight.update({
      where: { id: full.flight.id },
      data: { companions: ["Norber", "Ben", "Norbert"] },
    });
    await prisma.railJourneyCompanion.create({
      data: { railJourneyId: full.rail.id, companionId: source.id, position: 1 },
    });
    await prisma.railJourney.update({
      where: { id: full.rail.id },
      data: { companions: ["Ben", "Norber"] },
    });
    // Rental is behind its beta switch: hidden, but it moves too.
    await prisma.rentalBookingCompanion.create({
      data: { rentalBookingId: full.rental.id, companionId: source.id, position: 0 },
    });
    const expense = await prisma.tripExpense.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        kind: "food",
        amount: 12,
        currency: "EUR",
        payerCompanionId: source.id,
      },
    });
    // Eve's own entry naming a "Norber" is not Anna's to rewrite.
    const evesTrip = await prisma.trip.create({
      data: { userId: eve.id, name: "Eve", companions: ["Norber"] },
    });

    const preview = await request(app)
      .get(`/api/v1/companions/${source.id}/merge-preview?into=${target.id}`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(preview.body.preview).toMatchObject({
      entries: { flight: { entries: 1, shared: 1 }, rail: { entries: 1, shared: 0 } },
      hiddenEntries: 1,
      expensesPaid: 1,
      renamedLists: 2,
      link: "none",
      allowed: true,
    });
    expect(preview.body.preview.entries.rental).toBeUndefined();

    await merge(anna, source.id, target.id).expect(200);

    expect(await prisma.companion.findUnique({ where: { id: source.id } })).toBeNull();
    // The phone hears of both: the source's tombstone and the rewritten entries.
    const changes = await prisma.syncChange.findMany({
      where: { userId: anna.id, entityId: { in: [source.id, full.flight.id, full.rail.id] } },
      select: { entity: true, entityId: true, op: true, changedColumns: true },
    });
    const rewrote = (entity: string, entityId: string) =>
      changes.some(
        (c) =>
          c.entity === entity && c.entityId === entityId && c.changedColumns.includes("companions")
      );
    expect(changes).toContainEqual({
      entity: "companion",
      entityId: source.id,
      op: "delete",
      changedColumns: [],
    });
    expect(rewrote("flight", full.flight.id)).toBe(true);
    expect(rewrote("rail_journey", full.rail.id)).toBe(true);
    expect(await prisma.flightCompanion.findMany({ where: { flightId: full.flight.id } })).toEqual([
      { flightId: full.flight.id, companionId: target.id, position: 0 },
    ]);
    expect(
      await prisma.railJourneyCompanion.findMany({ where: { railJourneyId: full.rail.id } })
    ).toEqual([{ railJourneyId: full.rail.id, companionId: target.id, position: 1 }]);
    expect(await prisma.rentalBookingCompanion.count({ where: { companionId: target.id } })).toBe(
      1
    );
    expect(
      (await prisma.tripExpense.findUniqueOrThrow({ where: { id: expense.id } })).payerCompanionId
    ).toBe(target.id);
    expect(
      (await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } })).companions
    ).toEqual(["Norbert", "Ben"]);
    expect(
      (await prisma.railJourney.findUniqueOrThrow({ where: { id: full.rail.id } })).companions
    ).toEqual(["Ben", "Norbert"]);
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: evesTrip.id } })).companions
    ).toEqual(["Norber"]);
  });

  it("refuses to merge two companions linked to different accounts", async () => {
    const ben = await account("ben");
    const carl = await account("carl");
    const source = await companion(anna.id, "Ben", ben.id);
    const target = await companion(anna.id, "Carl", carl.id);
    const preview = await request(app)
      .get(`/api/v1/companions/${source.id}/merge-preview?into=${target.id}`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(preview.body.preview).toMatchObject({ link: "conflict", allowed: false });
    const res = await merge(anna, source.id, target.id).expect(409);
    expect(res.body.code).toBe("COMPANION_MERGE_LINK_CONFLICT");
    expect(await prisma.companion.findUnique({ where: { id: source.id } })).not.toBeNull();
  });

  it("moves the source's account link onto an unlinked target", async () => {
    const ben = await account("ben");
    const source = await companion(anna.id, "Benny", ben.id);
    const target = await companion(anna.id, "Ben");
    await merge(anna, source.id, target.id).expect(200);
    expect(
      (await prisma.companion.findUniqueOrThrow({ where: { id: target.id } })).linkedUserId
    ).toBe(ben.id);
  });

  it("refuses a merge into itself", async () => {
    const one = await companion(anna.id, "Ben");
    const res = await merge(anna, one.id, one.id).expect(400);
    expect(res.body.code).toBe("COMPANION_MERGE_SELF");
  });

  it("deletes only an unused companion; the bulk delete spares used and linked ones", async () => {
    const ben = await account("ben");
    const used = await companion(anna.id, "Used");
    await prisma.tripCompanion.create({
      data: { tripId: full.trip.id, companionId: used.id, position: 0 },
    });
    const payer = await companion(anna.id, "Payer");
    await prisma.tripExpense.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        kind: "food",
        amount: 5,
        currency: "EUR",
        payerCompanionId: payer.id,
      },
    });
    const linked = await companion(anna.id, "Linked", ben.id);
    const unused = await companion(anna.id, "Unused");
    const alsoUnused = await companion(anna.id, "Also unused");
    const evesUnused = await companion(eve.id, "Eve's unused");

    const res = await request(app)
      .delete(`/api/v1/companions/${used.id}`)
      .set("Cookie", anna.cookie)
      .expect(409);
    expect(res.body).toMatchObject({ code: "COMPANION_IN_USE", entries: 1 });
    await request(app)
      .delete(`/api/v1/companions/${unused.id}`)
      .set("Cookie", anna.cookie)
      .expect(204);

    const bulk = await request(app)
      .post("/api/v1/companions/delete-unused")
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(bulk.body).toEqual({ deleted: 1 });
    const left = await prisma.companion.findMany({ where: { userId: anna.id } });
    expect(left.map((c) => c.id).sort()).toEqual([used.id, payer.id, linked.id].sort());
    expect(await prisma.companion.findUnique({ where: { id: alsoUnused.id } })).toBeNull();
    expect(await prisma.companion.findUnique({ where: { id: evesUnused.id } })).not.toBeNull();
  });

  it("lists companions with uses per visible kind, hidden uses and the link", async () => {
    const ben = await account("ben");
    const norbert = await companion(anna.id, "Norbert", ben.id);
    await prisma.flightCompanion.create({
      data: { flightId: full.flight.id, companionId: norbert.id, position: 0 },
    });
    await prisma.rentalBookingCompanion.create({
      data: { rentalBookingId: full.rental.id, companionId: norbert.id, position: 0 },
    });
    const res = await request(app)
      .get("/api/v1/companions/manage")
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(res.body.kinds).toEqual(["flight", "trip", "cruise", "rail"]);
    expect(res.body.companions).toEqual([
      {
        id: norbert.id,
        name: "Norbert",
        linkedUser: { id: ben.id, username: ben.username, displayName: "ben" },
        uses: { flight: 1, trip: 0, cruise: 0, rail: 0 },
        hiddenUses: 1,
        expensesPaid: 0,
        lastTogether: "2025-05-01",
        inUse: true,
      },
    ]);
  });

  // Found by the Codex review: usage was checked, then the row deleted in a
  // second statement — a link made in between was cascaded away under a 204.
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("refuses a delete when an entry links the companion while it runs", async () => {
    const target = await companion(anna.id, "Racer");
    let answer: Promise<request.Response> | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.flightCompanion.create({
        data: { flightId: full.flight.id, companionId: target.id, position: 0 },
      });
      answer = request(app)
        .delete(`/api/v1/companions/${target.id}`)
        .set("Cookie", anna.cookie)
        .then((r) => r);
      await sleep(400);
    });
    const res = await answer!;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COMPANION_IN_USE");
    expect(await prisma.flightCompanion.count({ where: { companionId: target.id } })).toBe(1);
  });

  it("spares a companion in the bulk delete when an expense names it meanwhile", async () => {
    const target = await companion(anna.id, "Payer later");
    let answer: Promise<request.Response> | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.tripExpense.create({
        data: {
          userId: anna.id,
          tripId: full.trip.id,
          kind: "food",
          amount: 5,
          currency: "EUR",
          payerCompanionId: target.id,
        },
      });
      answer = request(app)
        .post("/api/v1/companions/delete-unused")
        .set("Cookie", anna.cookie)
        .then((r) => r);
      await sleep(400);
    });
    const res = await answer!;
    expect(res.status).toBe(200);
    expect(await prisma.companion.findUnique({ where: { id: target.id } })).not.toBeNull();
    expect(await prisma.tripExpense.count({ where: { payerCompanionId: target.id } })).toBe(1);
  });

  // Found by the Codex review: a stay names its companions as text only, so a
  // person named only on a stay read as unused and could be deleted.
  it("counts a stay that names the companion as a use, even in a hidden domain", async () => {
    const onStay = await companion(anna.id, "Stay Only");
    await prisma.lodgingStay.update({
      where: { id: full.stay.id },
      data: { companions: ["  stay   ONLY "] },
    });
    const del = await request(app)
      .delete(`/api/v1/companions/${onStay.id}`)
      .set("Cookie", anna.cookie)
      .expect(409);
    expect(del.body.code).toBe("COMPANION_IN_USE");
    await request(app)
      .post("/api/v1/companions/delete-unused")
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(await prisma.companion.findUnique({ where: { id: onStay.id } })).not.toBeNull();
    const list = await request(app)
      .get("/api/v1/companions/manage")
      .set("Cookie", anna.cookie)
      .expect(200);
    // Lodging is switched off for Anna: the stay is a hidden use.
    expect(list.body.companions[0]).toMatchObject({ id: onStay.id, hiddenUses: 1, inUse: true });

    await prisma.userSettings.update({
      where: { userId: anna.id },
      data: { enabledDomains: ["flight", "lodging"] },
    });
    const shown = await request(app)
      .get("/api/v1/companions/manage")
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(shown.body.companions[0]).toMatchObject({ uses: { lodging: 1 }, hiddenUses: 0 });
  });
});
