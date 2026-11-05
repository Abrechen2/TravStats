import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Lodging rating categories", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let otherId: string;
  let lodgingId: string;
  const names = ["ratcatuser", "ratcatother"];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: names } } });
    const u = await prisma.user.create({
      data: { username: names[0], passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: names[1], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    lodgingId = (await prisma.lodging.create({ data: { userId, name: "Rated Inn" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  const api = (method: "get" | "put" | "post" | "patch" | "delete", url: string, as = cookie) =>
    request(app)[method](`/api/v1/lodging/rating-categories${url}`).set("Cookie", as);
  const stay = (body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/lodging/${lodgingId}/stays`)
      .set("Cookie", cookie)
      .send({ checkIn: "2024-03-01T15:00:00.000Z", checkOut: "2024-03-03T11:00:00.000Z", ...body });

  it("offers today's three categories before anything is switched", async () => {
    const res = await api("get", "");
    expect(res.status).toBe(200);
    expect(res.body.data.active).toEqual(["room", "breakfast", "service"]);
    expect(res.body.data.builtIn).toContain("parking");
  });

  it("switches the set (Bett and Parkplatz instead of Frühstück) and refuses unknown keys", async () => {
    const ok = await api("put", "/active").send({ categories: ["room", "bed", "parking"] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.active).toEqual(["room", "bed", "parking"]);
    const bad = await api("put", "/active").send({ categories: ["room", "nonsense"] });
    expect(bad.status).toBe(400);
    const dup = await api("put", "/active").send({ categories: ["room", "room"] });
    expect(dup.status).toBe(400);
  });

  it("derives the overall from the values a stay has, across built-in and own categories", async () => {
    const created = await api("post", "/custom").send({ name: "  Aussicht " });
    expect(created.status).toBe(201);
    const custom = created.body.data.custom[0];
    expect(custom.name).toBe("Aussicht");

    const res = await stay({ ratings: { bed: 5, parking: 4, [custom.key]: 3 } });
    expect(res.status).toBe(201);
    expect(res.body.data.ratings).toEqual({ bed: 5, parking: 4, [custom.key]: 3 });
    expect(res.body.data.ratingOverall).toBe(4);
  });

  it("does not move a stay's overall when a category is switched off (the stay keeps its values)", async () => {
    const res = await stay({ ratings: { breakfast: 2, room: 4 } });
    expect(res.body.data.ratingOverall).toBe(3);
    // Frühstück is not in the active set any more; a later unrelated edit re-derives.
    await api("put", "/active").send({ categories: ["room"] });
    const patched = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}/stays/${res.body.data.id}`)
      .set("Cookie", cookie)
      .send({ notes: "unrelated edit" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.ratings).toEqual({ breakfast: 2, room: 4 });
    expect(patched.body.data.ratingOverall).toBe(3);
  });

  it("merges a PATCH of one category and lets an explicit null clear it", async () => {
    const res = await stay({ ratings: { room: 5, bed: 3 } });
    const url = `/api/v1/lodging/${lodgingId}/stays/${res.body.data.id}`;
    const one = await request(app)
      .patch(url)
      .set("Cookie", cookie)
      .send({ ratings: { bed: 5 } });
    expect(one.body.data.ratings).toEqual({ room: 5, bed: 5 });
    expect(one.body.data.ratingOverall).toBe(5);
    const cleared = await request(app)
      .patch(url)
      .set("Cookie", cookie)
      .send({ ratings: { bed: null } });
    expect(cleared.body.data.ratings).toEqual({ room: 5 });
  });

  it("mirrors the three legacy columns and still accepts the legacy field names", async () => {
    const res = await stay({ ratingRoom: 4, ratingBreakfast: 5 });
    expect(res.body.data.ratings).toEqual({ room: 4, breakfast: 5 });
    expect(res.body.data.ratingRoom).toBe(4);
    expect(res.body.data.ratingOverall).toBe(4.5);
    const viaMap = await stay({ ratings: { service: 3 } });
    expect(viaMap.body.data.ratingService).toBe(3);
  });

  it("refuses a rating for a category the caller does not own or that does not exist", async () => {
    const theirs = await api("post", "/custom", otherCookie).send({ name: "Fremd" });
    const foreignKey = theirs.body.data.custom[0].key;
    expect((await stay({ ratings: { [foreignKey]: 5 } })).status).toBe(400);
    expect((await stay({ ratings: { mystery: 5 } })).status).toBe(400);
  });

  describe("own categories", () => {
    it("rejects an empty or over-long name and a duplicate (case-insensitive)", async () => {
      expect((await api("post", "/custom").send({ name: "   " })).status).toBe(400);
      expect((await api("post", "/custom").send({ name: "x".repeat(41) })).status).toBe(400);
      await api("post", "/custom").send({ name: "Lärm" });
      expect((await api("post", "/custom").send({ name: "lärm" })).status).toBe(409);
    });

    it("renames, and deleting keeps the values already given readable and counting", async () => {
      const made = await api("post", "/custom").send({ name: "Rooftop" });
      const cat = made.body.data.custom.find((c: { name: string }) => c.name === "Rooftop");
      const rated = await stay({ ratings: { [cat.key]: 5, room: 3 } });
      expect(rated.body.data.ratingOverall).toBe(4);

      const renamed = await api("patch", `/custom/${cat.id}`).send({ name: "Dachterrasse" });
      expect(renamed.body.data.custom.find((c: { id: string }) => c.id === cat.id).name).toBe(
        "Dachterrasse"
      );

      const del = await api("delete", `/custom/${cat.id}`);
      expect(del.status).toBe(200);
      const gone = del.body.data.custom.find((c: { id: string }) => c.id === cat.id);
      expect(gone).toMatchObject({ deleted: true, name: "Dachterrasse" });

      // The stay still carries the value, and an unrelated edit keeps it in the overall.
      const patched = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${rated.body.data.id}`)
        .set("Cookie", cookie)
        .send({ notes: "x" });
      expect(patched.body.data.ratings[cat.key]).toBe(5);
      expect(patched.body.data.ratingOverall).toBe(4);
      // ...but it can be cleared by the user.
      const cleared = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${rated.body.data.id}`)
        .set("Cookie", cookie)
        .send({ ratings: { [cat.key]: null } });
      expect(cleared.body.data.ratingOverall).toBe(3);
      // Creating it again revives instead of duplicating.
      const again = await api("post", "/custom").send({ name: "dachterrasse" });
      expect(
        again.body.data.custom.filter((c: { name: string }) => /dachterrasse/i.test(c.name))
      ).toHaveLength(1);
    });

    it("cannot touch another user's category", async () => {
      const theirs = await api("post", "/custom", otherCookie).send({ name: "Privat" });
      const id = theirs.body.data.custom.find((c: { name: string }) => c.name === "Privat").id;
      expect((await api("patch", `/custom/${id}`).send({ name: "Mine" })).status).toBe(404);
      expect((await api("delete", `/custom/${id}`)).status).toBe(404);
    });
  });
});
