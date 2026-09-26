import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import * as geo from "../../services/geo/nominatim";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A "lodgings nearby" pick carries its OpenStreetMap identity (silent-failure
 * fixes, 2026-09-26). The form took the pick's name, stars and website and
 * dropped the `osm:node/…` reference that says WHICH house it was. It is now
 * stored as `externalRef` — only while the row has none (the form's
 * fill-empty rule), and never at the price of a failed save when another of
 * the user's lodgings already holds that house.
 */
describe("lodging osmRef", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "lodging-osmref" } });
    const u = await prisma.user.create({
      data: { username: "lodging-osmref", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const stored = (id: string) =>
    prisma.lodging.findUniqueOrThrow({ where: { id }, select: { externalRef: true } });

  it("stores the picked house's reference on a new lodging", async () => {
    const res = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", cookie)
      .send({ name: "Adlon Kempinski", lat: 52.5163, lon: 13.3801, osmRef: "osm:node/1" });
    expect(res.status).toBe(201);
    expect((await stored(res.body.data.id)).externalRef).toBe("osm:node/1");
  });

  it("fills an empty reference on edit, but never replaces one the row has", async () => {
    const empty = await prisma.lodging.create({ data: { userId, name: "Adlon" } });
    const held = await prisma.lodging.create({
      data: { userId, name: "Imported", externalRef: "google:ChIJ123" },
    });

    await request(app)
      .patch(`/api/v1/lodging/${empty.id}`)
      .set("Cookie", cookie)
      .send({ osmRef: "osm:way/2" })
      .expect(200);
    await request(app)
      .patch(`/api/v1/lodging/${held.id}`)
      .set("Cookie", cookie)
      .send({ osmRef: "osm:way/3" })
      .expect(200);

    expect((await stored(empty.id)).externalRef).toBe("osm:way/2");
    expect((await stored(held.id)).externalRef).toBe("google:ChIJ123");
  });

  it("saves anyway when another lodging already is that house, without moving the link", async () => {
    const first = await prisma.lodging.create({
      data: { userId, name: "Adlon", externalRef: "osm:node/1" },
    });
    const res = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", cookie)
      .send({ name: "Adlon again", osmRef: "osm:node/1" });
    expect(res.status).toBe(201);
    expect((await stored(res.body.data.id)).externalRef).toBeNull();
    expect((await stored(first.id)).externalRef).toBe("osm:node/1");
  });

  it("refuses a reference that is not an OpenStreetMap element", async () => {
    const res = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", cookie)
      .send({ name: "X", osmRef: "google:ChIJ123" });
    expect(res.status).toBe(400);
  });
});
