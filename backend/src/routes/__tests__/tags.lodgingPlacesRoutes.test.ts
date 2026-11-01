import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/**
 * forgejo#405 item 13: tags for lodging houses, places, roadtrips and tours —
 * until now only the other domains carried them. Each case writes through the
 * public API and reads back through it, and the shared vocabulary (`GET /tags`)
 * offers them.
 */
const USER = "tagsparity";

describe("tags on lodging, places, roadtrips and tours", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(() => {
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
    jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
  });

  afterAll(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("stores a lodging's tags on create and replaces them on patch", async () => {
    const created = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", cookie)
      .send({ name: "Tag Hotel", lat: 1, lon: 2, tags: ["work", "spa"] });
    expect(created.status).toBe(201);
    expect(created.body.data.tags).toEqual(["work", "spa"]);

    const patched = await request(app)
      .patch(`/api/v1/lodging/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ tags: ["family"] });
    expect(patched.body.data.tags).toEqual(["family"]);

    // A patch that does not mention tags leaves them alone.
    const renamed = await request(app)
      .patch(`/api/v1/lodging/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ name: "Tag Hotel 2" });
    expect(renamed.body.data.tags).toEqual(["family"]);
  });

  it("stores a place's tags and keeps both sets when two places are merged", async () => {
    const make = (name: string, tags: string[]) =>
      request(app)
        .post("/api/v1/places")
        .set("Cookie", cookie)
        .send({ name, category: "landmark", lat: 41.89, lon: 12.49, tags });
    const target = await make("Kolosseum", ["Rom", "Antike"]);
    const source = await make("Colosseum", ["rom", "Foto"]);
    expect(target.status).toBe(201);
    expect(target.body.data.tags).toEqual(["Rom", "Antike"]);

    const patched = await request(app)
      .patch(`/api/v1/places/${target.body.data.id}`)
      .set("Cookie", cookie)
      .send({ tags: ["Rom", "Antike", "Pflicht"] });
    expect(patched.body.data.tags).toEqual(["Rom", "Antike", "Pflicht"]);

    const merged = await request(app)
      .post(`/api/v1/places/${target.body.data.id}/merge`)
      .set("Cookie", cookie)
      .send({
        sourceId: source.body.data.id,
        fields: {
          name: "target",
          localName: "target",
          category: "target",
          position: "target",
          address: "target",
          notes: "target",
        },
      });
    expect(merged.status).toBe(200);
    // "rom" is the target's "Rom" once; the duplicate's "Foto" survives its deletion.
    expect(merged.body.data.tags).toEqual(["Rom", "Antike", "Pflicht", "Foto"]);
  });

  it("stores a roadtrip's and a tour's tags and shows them in the answer", async () => {
    const roadtrip = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Norwegen", tags: ["Wohnmobil"] });
    expect(roadtrip.status).toBe(201);
    expect(roadtrip.body.roadtrip.tags).toEqual(["Wohnmobil"]);

    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Gipfel", mode: "foot", tags: ["Gipfel", "Hund"] });
    expect(tour.status).toBe(201);
    expect(tour.body.route.tags).toEqual(["Gipfel", "Hund"]);

    const patched = await request(app)
      .patch(`/api/v1/tours/${tour.body.route.id}`)
      .set("Cookie", cookie)
      .send({ tags: ["Gipfel"] });
    expect(patched.status).toBe(200);
    expect(patched.body.route.tags).toEqual(["Gipfel"]);

    const read = await request(app)
      .get(`/api/v1/roadtrips/${roadtrip.body.roadtrip.id}`)
      .set("Cookie", cookie);
    expect(read.body.roadtrip.tags).toEqual(["Wohnmobil"]);
  });

  it("keeps the tags of a tour section created inside a trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Section trip" } });
    const section = await request(app)
      .post(`/api/v1/trips/${trip.id}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Tag etappe", mode: "foot", tags: ["Etappe"] });
    expect(section.status).toBe(201);
    expect(section.body.route.tags).toEqual(["Etappe"]);
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("offers their tags in the shared vocabulary", async () => {
    const res = await request(app).get("/api/v1/tags").query({ limit: "50" }).set("Cookie", cookie);
    const names = (res.body.tags as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["family", "Rom", "Antike", "Wohnmobil", "Gipfel", "Foto"])
    );
  });

  it("refuses an over-long tag instead of storing it", async () => {
    const res = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", cookie)
      .send({ name: "x", lat: 1, lon: 2, tags: ["t".repeat(41)] });
    expect(res.status).toBe(400);
  });
});
