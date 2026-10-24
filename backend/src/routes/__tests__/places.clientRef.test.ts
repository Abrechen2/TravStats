import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/** Exactly-once place and visit creates for the Companion's outbox (forgejo#283). */
const place = { name: "Kolosseum", category: "landmark", lat: 41.8902, lon: 12.4922 };
const visit = { visitedAt: "2024-05-01", notes: "Morgens" };

describe("place clientRef", () => {
  let userId: string;
  let cookie: string;
  const post = (path: string, payload: object) =>
    request(app).post(`/api/v1/places${path}`).set("Cookie", cookie).send(payload);
  const places = () => prisma.place.count({ where: { userId } });
  const visits = () => prisma.placeVisit.count({ where: { userId } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    userId = (
      await prisma.user.create({ data: { username: `place_ref_${Date.now()}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  // The geocoder is a network call; "found nothing" is a path the route handles.
  beforeEach(() => {
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.clientWriteRef.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("POST /places", () => {
    it("answers a repeat with the place the first POST made, geocoding once", async () => {
      const first = await post("", { ...place, clientRef: "place:one" }).expect(201);
      const again = await post("", { ...place, clientRef: "place:one" }).expect(200);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect(again.body.deduped).toBeUndefined();
      expect(geo.completeAddressFromCoordinates).toHaveBeenCalledTimes(1);
      expect(await places()).toBe(1);
    });
    it("refuses the same key with a different body", async () => {
      const first = await post("", { ...place, clientRef: "place:edit" }).expect(201);
      const changed = await post("", { ...place, name: "Forum", clientRef: "place:edit" }).expect(
        409
      );
      expect(changed.body).toMatchObject({
        code: "CLIENT_REF_REUSED",
        kind: "place",
        entityId: first.body.data.id,
      });
      expect(await places()).toBe(1);
    });
    it("does not resurrect a deleted place", async () => {
      const first = await post("", { ...place, clientRef: "place:gone" }).expect(201);
      await request(app)
        .delete(`/api/v1/places/${first.body.data.id}`)
        .set("Cookie", cookie)
        .expect(200);
      const again = await post("", { ...place, clientRef: "place:gone" }).expect(410);
      expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
      expect(await places()).toBe(0);
    });
    it("answers a known externalRef as deduped without spending the key", async () => {
      const ref = { ...place, externalRef: "osm:node/42" };
      const first = await post("", ref).expect(201);
      const deduped = await post("", { ...ref, clientRef: "place:dedup" }).expect(200);
      expect(deduped.body).toMatchObject({ deduped: true, data: { id: first.body.data.id } });
      expect(await prisma.clientWriteRef.count({ where: { userId } })).toBe(0);
      expect(await places()).toBe(1);
    });
  });

  describe("POST /places/:id/visits", () => {
    let placeId: string;
    beforeEach(async () => {
      placeId = (await prisma.place.create({ data: { userId, ...place } })).id;
    });

    it("answers a repeat with the visit the first POST made", async () => {
      const first = await post(`/${placeId}/visits`, { ...visit, clientRef: "visit:one" }).expect(
        201
      );
      const again = await post(`/${placeId}/visits`, { ...visit, clientRef: "visit:one" }).expect(
        200
      );
      expect(again.body.data).toEqual(first.body.data);
      expect(await visits()).toBe(1);
    });
    it("refuses the same key with a different body or on another place", async () => {
      const first = await post(`/${placeId}/visits`, { ...visit, clientRef: "visit:edit" }).expect(
        201
      );
      const changed = await post(`/${placeId}/visits`, {
        ...visit,
        notes: "Abends",
        clientRef: "visit:edit",
      }).expect(409);
      expect(changed.body).toMatchObject({
        code: "CLIENT_REF_REUSED",
        kind: "placeVisit",
        entityId: first.body.data.id,
      });
      const other = (await prisma.place.create({ data: { userId, ...place, name: "Forum" } })).id;
      await post(`/${other}/visits`, { ...visit, clientRef: "visit:edit" }).expect(409);
      expect(await visits()).toBe(1);
    });
    it("does not resurrect a deleted visit", async () => {
      const first = await post(`/${placeId}/visits`, { ...visit, clientRef: "visit:gone" }).expect(
        201
      );
      await request(app)
        .delete(`/api/v1/places/visits/${first.body.data.id}`)
        .set("Cookie", cookie)
        .expect(200);
      const again = await post(`/${placeId}/visits`, { ...visit, clientRef: "visit:gone" }).expect(
        410
      );
      expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
      expect(await visits()).toBe(0);
    });
    it("still promotes the place and records separate visits without a key", async () => {
      await post(`/${placeId}/visits`, visit).expect(201);
      await post(`/${placeId}/visits`, visit).expect(201);
      expect(await visits()).toBe(2);
      expect((await prisma.place.findUniqueOrThrow({ where: { id: placeId } })).visited).toBe(true);
    });
  });
});
