import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { seedCuratedPlacesFromCSV } from "../../seedCuratedPlacesFromCSV";

const USERS = ["listtest", "listother"];
const NEW7 = "world-wonders-new7";
const COLOSSEUM = `${NEW7}:colosseum`;
const PETRA = `${NEW7}:petra`;

describe("Place lists API", () => {
  let authCookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.place.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.placeList.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    // The checklist tests need the shipped catalog present; the seed is
    // idempotent, so running it here costs nothing on an already-seeded DB.
    await seedCuratedPlacesFromCSV();

    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.placeList.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  const makePlace = (name: string, over: Record<string, unknown> = {}) =>
    prisma.place.create({
      data: {
        userId,
        name,
        category: "restaurant",
        lat: 41.9,
        lon: 12.5,
        isoCountryCode: "IT",
        visited: true,
        ...over,
      },
    });

  // ---------------------------------------------------------------- own lists

  describe("own lists", () => {
    it("creates a list and reports its figures", async () => {
      const res = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Maccis weltweit", color: "#e3b341" });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: "Maccis weltweit",
        color: "#e3b341",
        curatedKey: null,
        placeCount: 0,
        visitedCount: 0,
        countryCount: 0,
      });
    });

    it("never shows one user's list to another", async () => {
      const mine = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Privat" });

      const seen = await request(app).get("/api/v1/place-lists").set("Cookie", otherCookie);
      expect(seen.body.data).toHaveLength(0);

      const direct = await request(app)
        .get(`/api/v1/place-lists/${mine.body.data.id}`)
        .set("Cookie", otherCookie);
      expect(direct.status).toBe(404);
    });

    it("counts a wishlist entry as a member but not as visited", async () => {
      const list = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Gemischt" });
      const been = await makePlace("Kolosseum");
      const want = await makePlace("Machu Picchu", { visited: false, isoCountryCode: "PE" });

      await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: been.id });
      const res = await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: want.id });

      // Two rows in the list, one place that happened, one country — the
      // wishlist entry's PE must not appear among the countries.
      expect(res.body.data).toMatchObject({ placeCount: 2, visitedCount: 1, countryCount: 1 });
    });

    it("refuses to add someone else's place", async () => {
      const list = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Meins" });
      const foreign = await prisma.place.create({
        data: { userId: otherUserId, name: "Fremd", category: "other", lat: 1, lon: 1 },
      });

      const res = await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: foreign.id });

      // A foreign key proves the row exists, never that it is the caller's —
      // adding it would leak its name and coordinates back through the list.
      expect(res.status).toBe(404);
    });

    it("treats adding the same place twice as a no-op", async () => {
      const list = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Doppelt" });
      const place = await makePlace("Trevi");

      await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: place.id });
      const second = await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: place.id });

      expect(second.status).toBe(201);
      expect(second.body.data.placeCount).toBe(1);
    });

    it("reorders entries and renumbers them from zero", async () => {
      const list = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Reihenfolge" });
      const a = await makePlace("A");
      const b = await makePlace("B");
      for (const p of [a, b]) {
        await request(app)
          .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
          .set("Cookie", authCookie)
          .send({ placeId: p.id });
      }

      const res = await request(app)
        .put(`/api/v1/place-lists/${list.body.data.id}/entries/order`)
        .set("Cookie", authCookie)
        .send({ placeIds: [b.id, a.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.entries.map((e: { placeId: string }) => e.placeId)).toEqual([
        b.id,
        a.id,
      ]);
    });

    it("deletes the grouping and leaves the places in the logbook", async () => {
      const list = await request(app)
        .post("/api/v1/place-lists")
        .set("Cookie", authCookie)
        .send({ name: "Weg damit" });
      const place = await makePlace("Bleibt");
      await request(app)
        .post(`/api/v1/place-lists/${list.body.data.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: place.id });

      const res = await request(app)
        .delete(`/api/v1/place-lists/${list.body.data.id}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(200);
      expect(await prisma.place.findUnique({ where: { id: place.id } })).not.toBeNull();
      expect(await prisma.placeListEntry.count({ where: { listId: list.body.data.id } })).toBe(0);
    });
  });

  // --------------------------------------------------------------- checklists

  describe("curated checklists", () => {
    const catalog = () => request(app).get("/api/v1/place-lists/curated").set("Cookie", authCookie);
    const progress = () =>
      request(app).get(`/api/v1/place-lists/curated/${NEW7}/progress`).set("Cookie", authCookie);
    const tick = (itemId: string) =>
      request(app)
        .post(`/api/v1/place-lists/curated/items/${itemId}/tick`)
        .set("Cookie", authCookie)
        .send({});

    it("lists the shipped checklists with the user's own progress at zero", async () => {
      const res = await catalog();
      expect(res.status).toBe(200);
      const new7 = res.body.data.find((c: { key: string }) => c.key === NEW7);
      expect(new7).toMatchObject({ itemCount: 7, tickedCount: 0, subscribed: false });
      // The English mirror has to reach the client, or the column is dead.
      expect(new7.nameEn).toBe("New 7 Wonders of the World");
    });

    it("shows every target as a ghost before anything is ticked", async () => {
      const res = await progress();
      expect(res.body.data.items).toHaveLength(7);
      expect(res.body.data.items.every((i: { ticked: boolean }) => !i.ticked)).toBe(true);
      expect(res.body.data.items.every((i: { placeId: null }) => i.placeId === null)).toBe(true);
    });

    it("subscribing writes ONE row, not a copy of the catalog", async () => {
      await request(app)
        .post(`/api/v1/place-lists/curated/${NEW7}/subscribe`)
        .set("Cookie", authCookie)
        .send({});

      expect(await prisma.placeList.count({ where: { userId } })).toBe(1);
      // The whole argument for lazy materialisation: no places are created.
      expect(await prisma.place.count({ where: { userId } })).toBe(0);
    });

    it("ticking turns a target into a real place and files it in the list", async () => {
      const res = await tick(COLOSSEUM);
      expect(res.status).toBe(201);

      const place = await prisma.place.findFirst({ where: { userId, curatedItemId: COLOSSEUM } });
      expect(place).toMatchObject({ visited: true, category: "landmark", dataSource: "curated" });
      expect(place?.lat).toBeCloseTo(41.8902, 3);

      // Ticking implies subscribing, and files the place in the subscription —
      // so a checklist behaves like every other list everywhere else.
      const list = await prisma.placeList.findFirst({ where: { userId, curatedKey: NEW7 } });
      expect(list).not.toBeNull();
      expect(
        await prisma.placeListEntry.count({ where: { listId: list!.id, placeId: place!.id } })
      ).toBe(1);
    });

    it("unticking deletes nothing — the visit, notes and photos survive", async () => {
      await tick(COLOSSEUM);
      const place = await prisma.place.findFirst({ where: { userId, curatedItemId: COLOSSEUM } });
      await prisma.placeVisit.create({
        data: { placeId: place!.id, userId, visitedAt: new Date("2024-06-12"), notes: "Südtor" },
      });

      const res = await request(app)
        .delete(`/api/v1/place-lists/curated/items/${COLOSSEUM}/tick`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);

      const after = await prisma.place.findUnique({
        where: { id: place!.id },
        include: { visits: true },
      });
      expect(after).not.toBeNull();
      expect(after?.visited).toBe(false);
      expect(after?.visits).toHaveLength(1);
      expect(after?.visits[0].notes).toBe("Südtor");
    });

    it("counts progress per checklist, not across all of them", async () => {
      await tick(COLOSSEUM);
      await tick(PETRA);
      const res = await progress();
      expect(res.body.data.tickedCount).toBe(2);
      expect(res.body.data.itemCount).toBe(7);

      const ancient = await request(app)
        .get("/api/v1/place-lists/curated/world-wonders-ancient/progress")
        .set("Cookie", authCookie);
      expect(ancient.body.data.tickedCount).toBe(0);
    });

    it("unsubscribing keeps every place the user ticked", async () => {
      await tick(COLOSSEUM);
      const res = await request(app)
        .delete(`/api/v1/place-lists/curated/${NEW7}/subscribe`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);

      // Losing the record of standing in front of the Colosseum because a
      // checklist was tidied away would be indefensible.
      expect(await prisma.place.count({ where: { userId, curatedItemId: COLOSSEUM } })).toBe(1);
      expect(await prisma.placeList.count({ where: { userId, curatedKey: NEW7 } })).toBe(0);
    });

    it("refuses to rename a subscription or edit its membership", async () => {
      await request(app)
        .post(`/api/v1/place-lists/curated/${NEW7}/subscribe`)
        .set("Cookie", authCookie)
        .send({});
      const list = await prisma.placeList.findFirst({ where: { userId, curatedKey: NEW7 } });
      const place = await makePlace("Nicht hier rein");

      const renamed = await request(app)
        .patch(`/api/v1/place-lists/${list!.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Meine Wunder" });
      expect(renamed.status).toBe(409);

      const added = await request(app)
        .post(`/api/v1/place-lists/${list!.id}/entries`)
        .set("Cookie", authCookie)
        .send({ placeId: place.id });
      expect(added.status).toBe(409);
    });

    it("still allows recolouring a subscription — that is presentation", async () => {
      await request(app)
        .post(`/api/v1/place-lists/curated/${NEW7}/subscribe`)
        .set("Cookie", authCookie)
        .send({});
      const list = await prisma.placeList.findFirst({ where: { userId, curatedKey: NEW7 } });

      const res = await request(app)
        .patch(`/api/v1/place-lists/${list!.id}`)
        .set("Cookie", authCookie)
        .send({ color: "#e3b341" });
      expect(res.status).toBe(200);
      expect(res.body.data.color).toBe("#e3b341");
    });

    it("resolves a continent for every target, splitting the transcontinental ones", async () => {
      const res = await request(app)
        .get("/api/v1/place-lists/curated/world-heritage/progress")
        .set("Cookie", authCookie);

      const items: Array<{ name: string; continent: string | null; isoCountryCode: string }> =
        res.body.data.items;
      expect(items.length).toBeGreaterThan(1000);
      expect(items.every((i) => i.continent !== null)).toBe(true);

      // The reason this is resolved on the SERVER: a country code alone cannot
      // answer Turkey. Istanbul is on the European side of the Bosphorus and
      // Cappadocia is not, and both are on this list.
      const istanbul = items.find((i) => /Istanbul/i.test(i.name));
      const goreme = items.find((i) => /Cappadocia/i.test(i.name));
      expect(istanbul?.continent).toBe("Europe");
      expect(goreme?.continent).toBe("Asia");
    });

    it("404s on an unknown checklist rather than inventing an empty one", async () => {
      const res = await request(app)
        .get("/api/v1/place-lists/curated/does-not-exist/progress")
        .set("Cookie", authCookie);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------- suggestions

  describe("suggestions", () => {
    const suggestions = () =>
      request(app).get(`/api/v1/place-lists/curated/${NEW7}/suggestions`).set("Cookie", authCookie);

    /** A stay in Rome, 3 km from the Colosseum. */
    const stayInRome = async (checkIn = "2024-06-10", checkOut = "2024-06-14") => {
      const lodging = await prisma.lodging.create({
        data: { userId, name: "Hotel Roma", type: "hotel", lat: 41.9009, lon: 12.4833 },
      });
      await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date(checkIn),
          checkOut: new Date(checkOut),
        },
      });
    };

    afterEach(async () => {
      await prisma.lodgingStay.deleteMany({ where: { userId } });
      await prisma.lodging.deleteMany({ where: { userId } });
    });

    it("says nothing when the user has recorded no travel at all", async () => {
      const res = await suggestions();
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ anchorCount: 0, suggestions: [] });
      // openCount still travels, so the UI can tell "no travel yet" apart from
      // "nothing of yours is near an open target".
      expect(res.body.data.openCount).toBe(7);
    });

    it("proposes the Colosseum from a hotel in Rome, with the reason attached", async () => {
      await stayInRome();
      const res = await suggestions();

      const hit = res.body.data.suggestions.find(
        (s: { itemId: string }) => s.itemId === COLOSSEUM
      );
      expect(hit).toMatchObject({
        confidence: "high",
        anchorKind: "lodging",
        anchorLabel: "Hotel Roma",
      });
      expect(hit.distanceKm).toBeLessThan(10);
      expect(hit.visitedAt).toContain("2024-06-10");
    });

    it("never proposes something already ticked", async () => {
      await stayInRome();
      await request(app)
        .post(`/api/v1/place-lists/curated/items/${COLOSSEUM}/tick`)
        .set("Cookie", authCookie)
        .send({});

      const res = await suggestions();
      expect(
        res.body.data.suggestions.some((s: { itemId: string }) => s.itemId === COLOSSEUM)
      ).toBe(false);
    });

    it("ignores a stay that has not happened yet", async () => {
      const future = new Date(Date.now() + 60 * 24 * 3600 * 1000);
      await stayInRome(future.toISOString(), new Date(future.getTime() + 86400000).toISOString());
      const res = await suggestions();
      expect(res.body.data.anchorCount).toBe(0);
    });

    it("keeps one user's travel out of another's suggestions", async () => {
      await stayInRome();
      const res = await request(app)
        .get(`/api/v1/place-lists/curated/${NEW7}/suggestions`)
        .set("Cookie", otherCookie);
      expect(res.body.data.anchorCount).toBe(0);
    });

    it("accepting a suggestion records the visit ON that date", async () => {
      await stayInRome();
      const res = await request(app)
        .post(`/api/v1/place-lists/curated/items/${COLOSSEUM}/tick`)
        .set("Cookie", authCookie)
        .send({ visitedAt: new Date("2024-06-10").toISOString() });
      expect(res.status).toBe(201);

      const place = await prisma.place.findFirst({
        where: { userId, curatedItemId: COLOSSEUM },
        include: { visits: true },
      });
      expect(place?.visits).toHaveLength(1);
      expect(place?.visits[0].visitedAt?.toISOString()).toContain("2024-06-10");
    });

    it("does not stack a second identical visit when a tick is repeated", async () => {
      await stayInRome();
      const body = { visitedAt: new Date("2024-06-10").toISOString() };
      for (let i = 0; i < 2; i += 1) {
        await request(app)
          .post(`/api/v1/place-lists/curated/items/${COLOSSEUM}/tick`)
          .set("Cookie", authCookie)
          .send(body);
      }
      const place = await prisma.place.findFirst({
        where: { userId, curatedItemId: COLOSSEUM },
        include: { visits: true },
      });
      expect(place?.visits).toHaveLength(1);
    });

    it("rejects a malformed date rather than storing a broken visit", async () => {
      const res = await request(app)
        .post(`/api/v1/place-lists/curated/items/${COLOSSEUM}/tick`)
        .set("Cookie", authCookie)
        .send({ visitedAt: "irgendwann" });
      expect(res.status).toBe(400);
    });
  });
});
