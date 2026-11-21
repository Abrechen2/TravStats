import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /lodging/:id/delete-facts` - what deleting a house takes with it, in one
 * request: its photographs and the kept originals of ALL its stays. The
 * confirmation used to ask once per stay.
 */
describe("GET /api/v1/lodging/:id/delete-facts", () => {
  let userId: string;
  let otherId: string;
  let authCookie: string;
  let houseId: string;
  let emptyHouseId: string;
  let foreignHouseId: string;
  const tag = `dfacts-${Date.now()}`;

  const doc = (owner: string, name: string, stayId: string | null) =>
    prisma.document.create({
      data: {
        userId: owner,
        storedName: `${tag}-${name}.pdf`,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: `${tag}-${name}`,
        format: "pdf",
        lodgingStayId: stayId,
      },
    });

  beforeAll(async () => {
    const make = async (suffix: string) =>
      prisma.user.create({
        data: { username: `${tag}-${suffix}`, passwordHash: await hashPassword("password123") },
      });
    userId = (await make("u")).id;
    otherId = (await make("o")).id;
    authCookie = `auth_token=${generateToken(userId)}`;

    houseId = (await prisma.lodging.create({ data: { userId, name: "Haus", type: "hotel" } })).id;
    emptyHouseId = (await prisma.lodging.create({ data: { userId, name: "Leer", type: "hotel" } }))
      .id;
    foreignHouseId = (
      await prisma.lodging.create({ data: { userId: otherId, name: "Fremd", type: "hotel" } })
    ).id;
    const stayA = await prisma.lodgingStay.create({ data: { lodgingId: houseId, userId } });
    const stayB = await prisma.lodgingStay.create({ data: { lodgingId: houseId, userId } });
    const foreignStay = await prisma.lodgingStay.create({
      data: { lodgingId: foreignHouseId, userId: otherId },
    });
    await doc(userId, "a1", stayA.id);
    await doc(userId, "a2", stayA.id);
    await doc(userId, "b1", stayB.id);
    await doc(userId, "unfiled", null);
    await doc(otherId, "foreign", foreignStay.id);
    await prisma.lodgingPhoto.createMany({
      data: [1, 2, 3].map((n) => ({
        lodgingId: houseId,
        filename: `${tag}-${n}.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
      })),
    });
  });

  afterAll(async () => {
    const owners = { in: [userId, otherId] };
    await prisma.document.deleteMany({ where: { userId: owners } });
    await prisma.lodgingPhoto.deleteMany({ where: { lodging: { userId: owners } } });
    await prisma.lodgingStay.deleteMany({ where: { userId: owners } });
    await prisma.lodging.deleteMany({ where: { userId: owners } });
    await prisma.user.deleteMany({ where: { id: owners } });
  });

  const facts = (id: string, cookie = authCookie) =>
    request(app).get(`/api/v1/lodging/${id}/delete-facts`).set("Cookie", cookie);

  it("counts the photographs and the originals of all the stays in one answer", async () => {
    const res = await facts(houseId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { photoCount: 3, documentCount: 3 } });
  });

  it("answers zero for a house with nothing - a count, not an absence", async () => {
    const res = await facts(emptyHouseId);
    expect(res.body.data).toEqual({ photoCount: 0, documentCount: 0 });
  });

  it("does not answer for another account's house", async () => {
    expect((await facts(foreignHouseId)).status).toBe(404);
  });

  it("requires authentication", async () => {
    expect((await request(app).get(`/api/v1/lodging/${houseId}/delete-facts`)).status).toBe(401);
  });
});
