import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/** Exactly-once lodging and stay creates for the Companion's outbox (forgejo#283). */
const lodging = { name: "Hotel Ref", city: "Zürich", country: "CH" };
const stay = { checkIn: "2024-07-01T00:00:00.000Z", checkOut: "2024-07-03T00:00:00.000Z" };

describe("lodging clientRef", () => {
  let userId: string;
  let cookie: string;
  const post = (path: string, payload: object) =>
    request(app).post(`/api/v1/lodging${path}`).set("Cookie", cookie).send(payload);
  const lodgings = () => prisma.lodging.count({ where: { userId } });
  const stays = () => prisma.lodgingStay.count({ where: { userId } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    userId = (
      await prisma.user.create({ data: { username: `lodging_ref_${Date.now()}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  // The geocoder is a network call; "found nothing" is a path the route handles.
  beforeEach(() => {
    jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.clientWriteRef.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("POST /lodging", () => {
    it("answers a repeat with the lodging the first POST made, geocoding once", async () => {
      const first = await post("", { ...lodging, clientRef: "lodging:one" }).expect(201);
      const again = await post("", { ...lodging, clientRef: "lodging:one" }).expect(200);
      expect(again.body.data).toEqual(first.body.data);
      expect(geo.resolveCoordinates).toHaveBeenCalledTimes(1);
      expect(await lodgings()).toBe(1);
    });
    it("refuses the same key with a different body", async () => {
      const first = await post("", { ...lodging, clientRef: "lodging:edit" }).expect(201);
      const changed = await post("", { ...lodging, name: "Other", clientRef: "lodging:edit" });
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({
        code: "CLIENT_REF_REUSED",
        kind: "lodging",
        entityId: first.body.data.id,
      });
      expect(await lodgings()).toBe(1);
    });
    it("does not resurrect a deleted lodging", async () => {
      const first = await post("", { ...lodging, clientRef: "lodging:gone" }).expect(201);
      await prisma.lodging.delete({ where: { id: first.body.data.id } });
      const again = await post("", { ...lodging, clientRef: "lodging:gone" }).expect(410);
      expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
      expect(await lodgings()).toBe(0);
    });
    it("keeps creating without a key", async () => {
      await post("", lodging).expect(201);
      await post("", lodging).expect(201);
      expect(await lodgings()).toBe(2);
    });
  });

  describe("POST /lodging/:id/stays", () => {
    let lodgingId: string;
    beforeEach(async () => {
      lodgingId = (await prisma.lodging.create({ data: { userId, ...lodging } })).id;
    });

    it("answers a repeat with the stay the first POST made", async () => {
      const first = await post(`/${lodgingId}/stays`, { ...stay, clientRef: "stay:one" });
      expect(first.status).toBe(201);
      const again = await post(`/${lodgingId}/stays`, { ...stay, clientRef: "stay:one" });
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual(first.body.data);
      expect(await stays()).toBe(1);
    });
    it("refuses the same key with a different body or under another lodging", async () => {
      const first = await post(`/${lodgingId}/stays`, { ...stay, clientRef: "stay:edit" });
      expect(first.status).toBe(201);
      const changed = await post(`/${lodgingId}/stays`, {
        ...stay,
        notes: "Zimmer 12",
        clientRef: "stay:edit",
      });
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({
        code: "CLIENT_REF_REUSED",
        kind: "lodgingStay",
        entityId: first.body.data.id,
      });
      const other = (await prisma.lodging.create({ data: { userId, name: "Elsewhere" } })).id;
      expect((await post(`/${other}/stays`, { ...stay, clientRef: "stay:edit" })).status).toBe(409);
      expect(await stays()).toBe(1);
    });
    it("does not resurrect a deleted stay", async () => {
      const first = await post(`/${lodgingId}/stays`, { ...stay, clientRef: "stay:gone" });
      await prisma.lodgingStay.delete({ where: { id: first.body.data.id } });
      const again = await post(`/${lodgingId}/stays`, { ...stay, clientRef: "stay:gone" });
      expect(again.status).toBe(410);
      expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
      expect(await stays()).toBe(0);
    });
    it("files documents with the stay once and keeps them there on a repeat", async () => {
      const doc = await prisma.document.create({
        data: {
          userId,
          storedName: "stay-ref.pdf",
          mimetype: "application/pdf",
          sizeBytes: 1,
          sha256: "e".repeat(64),
          format: "pdf",
        },
      });
      try {
        const payload = { ...stay, documentIds: [doc.id], clientRef: "stay:doc" };
        const first = await post(`/${lodgingId}/stays`, payload);
        expect(first.status).toBe(201);
        expect((await post(`/${lodgingId}/stays`, payload)).status).toBe(200);
        const filed = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
        expect(filed.lodgingStayId).toBe(first.body.data.id);
      } finally {
        await prisma.document.deleteMany({ where: { id: doc.id } });
      }
    });
  });
});
