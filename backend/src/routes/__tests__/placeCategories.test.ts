import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/** Own place categories (poi-user-defined-categories). */
describe("own place categories", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;
  const base = { lat: 48.1, lon: 11.5 };
  const cat = (name: string, icon?: string) =>
    request(app).post("/api/v1/place-categories").set("Cookie", cookie).send({ name, icon });
  const place = (body: object, c = cookie) =>
    request(app)
      .post("/api/v1/places")
      .set("Cookie", c)
      .send({ ...base, ...body });

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    const mk = async (tag: string) =>
      (await prisma.user.create({ data: { username: `pcat_${tag}_${Date.now()}`, passwordHash } }))
        .id;
    userId = await mk("a");
    otherId = await mk("b");
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });
  beforeEach(() => {
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.placeCategoryDef.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("creates a category, lists only the caller's, and refuses a repeat", async () => {
    await cat("Schwimmbad", "🏊").expect(201);
    await cat("Schwimmbad").expect(409);
    const list = await request(app).get("/api/v1/place-categories").set("Cookie", otherCookie);
    expect(list.body.data).toEqual([]);
    const mine = await request(app).get("/api/v1/place-categories").set("Cookie", cookie);
    expect(mine.body.data.map((c: { name: string }) => c.name)).toEqual(["Schwimmbad"]);
  });

  it("refuses a name a built-in category already answers to, and an icon outside the set", async () => {
    const clash = await cat("Natur").expect(409);
    expect(clash.body.code).toBe("PLACE_CATEGORY_BUILT_IN");
    await cat("museum").expect(409);
    await cat("Freizeitpark", "💥").expect(400);
  });

  it("lets a place carry an own category but refuses an unknown name and another user's", async () => {
    await cat("Freizeitpark", "🎢").expect(201);
    const ok = await place({ name: "Europa-Park", category: "Freizeitpark" }).expect(201);
    expect(ok.body.data.category).toBe("Freizeitpark");
    const unknown = await place({ name: "X", category: "Nope" }).expect(400);
    expect(unknown.body.code).toBe("PLACE_CATEGORY_UNKNOWN");
    await place({ name: "Y", category: "Freizeitpark" }, otherCookie).expect(400);
  });

  it("filters the list by an own category", async () => {
    await cat("Sportstätte").expect(201);
    await place({ name: "Stadion", category: "Sportstätte" }).expect(201);
    await place({ name: "Dom", category: "landmark" }).expect(201);
    const res = await request(app)
      .get("/api/v1/places")
      .query({ category: "Sportstätte" })
      .set("Cookie", cookie);
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(["Stadion"]);
  });

  it("keeps a place readable when its category is deleted: it folds to other", async () => {
    const created = await cat("Schwimmbad").expect(201);
    const p = await place({ name: "Hallenbad", category: "Schwimmbad" }).expect(201);
    const del = await request(app)
      .delete(`/api/v1/place-categories/${created.body.data.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(del.body.data.movedPlaces).toBe(1);
    const after = await request(app).get(`/api/v1/places/${p.body.data.id}`).set("Cookie", cookie);
    expect(after.body.data.category).toBe("other");
    await request(app)
      .delete(`/api/v1/place-categories/${created.body.data.id}`)
      .set("Cookie", cookie)
      .expect(404);
  });

  it("does not let an edit that leaves a place's imported label alone start failing", async () => {
    const p = await place({ name: "Takeout", category: "landmark" }).expect(201);
    await prisma.place.update({ where: { id: p.body.data.id }, data: { category: "food" } });
    await request(app)
      .patch(`/api/v1/places/${p.body.data.id}`)
      .set("Cookie", cookie)
      .send({ category: "food", notes: "x" })
      .expect(200);
  });
});
