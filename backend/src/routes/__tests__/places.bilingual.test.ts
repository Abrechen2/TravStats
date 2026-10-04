jest.mock("../../services/geo/nominatim", () => ({
  completeAddressFromCoordinates: jest.fn().mockResolvedValue(null),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { toDbDate } from "../../shared/time/localDate";
import { mintWriteToken } from "../../shared/time/__tests__/patFixture";

/**
 * forgejo#199: a place keeps two names, and a visit saved without a trip
 * finds the one trip its local day falls in.
 */
const USERS = ["bilingualplaces", "bilingualplaces2"];
// Seoul City Hall — Asia/Seoul, UTC+9 all year.
const SEOUL = { category: "landmark", lat: 37.5663, lon: 126.9779 };

describe("Places — two names and the trip a visit belongs to", () => {
  let userId: string;
  let otherUserId: string;
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.apiToken.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.placeVisit.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.place.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.trip.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const [u, other] = await Promise.all(
      USERS.map(async (username) =>
        prisma.user.create({
          data: { username, passwordHash: await hashPassword("password123") },
        })
      )
    );
    userId = u.id;
    otherUserId = other.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  const createPlace = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/places")
      .set("Cookie", cookie)
      .send({ ...SEOUL, ...body });

  describe("two names", () => {
    it("stores and returns the picker hit's local name", async () => {
      const res = await createPlace({ name: "Seoul Station", localName: "서울역" });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name: "Seoul Station", localName: "서울역" });

      const list = await request(app).get("/api/v1/places").set("Cookie", cookie);
      expect(list.body.data[0]).toMatchObject({ name: "Seoul Station", localName: "서울역" });
    });

    it("splits a name glued from both scripts when no local name is sent", async () => {
      const res = await createPlace({
        name: "Banpo Bridge Moonlight Rainbow Fountain 반포대교 달빛무지개분수",
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: "Banpo Bridge Moonlight Rainbow Fountain",
        localName: "반포대교 달빛무지개분수",
      });
    });

    it("leaves a name in one script alone", async () => {
      const res = await createPlace({ name: "교촌치킨 서울시청점" });
      expect(res.body.data).toMatchObject({ name: "교촌치킨 서울시청점", localName: null });
    });

    it("refuses a local name longer than a name may be", async () => {
      const res = await createPlace({ name: "Seoul Station", localName: "가".repeat(201) });
      expect(res.status).toBe(400);
    });

    it("clears the local name on an explicit null and keeps it when only the name changes", async () => {
      const id = (await createPlace({ name: "Seoul Station", localName: "서울역" })).body.data.id;
      const patch = (body: unknown) =>
        request(app).patch(`/api/v1/places/${id}`).set("Cookie", cookie).send(body);

      const renamed = await patch({ name: "Seoul Stn" });
      expect(renamed.body.data).toMatchObject({ name: "Seoul Stn", localName: "서울역" });

      const cleared = await patch({ localName: null });
      expect(cleared.body.data).toMatchObject({ name: "Seoul Stn", localName: null });

      const glued = await patch({ name: "Seoul Station 서울역" });
      expect(glued.body.data).toMatchObject({ name: "Seoul Station", localName: "서울역" });
    });
  });

  describe("a visit without a trip", () => {
    const trip = (owner: string, name: string, first: string, last: string) =>
      prisma.trip.create({
        data: { userId: owner, name, startDay: toDbDate(first), endDay: toDbDate(last) },
      });

    const visit = async (body: Record<string, unknown>, auth?: string) => {
      const placeId = (
        await prisma.place.create({ data: { userId, name: "Gyeongbokgung", ...SEOUL } })
      ).id;
      const req = request(app).post(`/api/v1/places/${placeId}/visits`);
      if (auth) req.set("Authorization", auth);
      else req.set("Cookie", cookie);
      const res = await req.send(body);
      expect(res.status).toBe(201);
      return prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    };

    it("joins the one trip whose days hold the visit's day", async () => {
      const korea = await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      await trip(userId, "Rom", "2026-05-01", "2026-05-08");
      const row = await visit({ visitedAt: "2026-10-04" });
      expect(row.tripId).toBe(korea.id);
    });

    it("counts both ends of a trip as inside it", async () => {
      const korea = await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      expect((await visit({ visitedAt: "2026-10-03" })).tripId).toBe(korea.id);
      expect((await visit({ visitedAt: "2026-10-19" })).tripId).toBe(korea.id);
      expect((await visit({ visitedAt: "2026-10-20" })).tripId).toBeNull();
    });

    it("reads the day at the place, not in UTC (the Companion sends an instant)", async () => {
      // 2026-10-02T16:30Z is 01:30 on 3 October in Seoul — inside the trip,
      // although its UTC date is the day before.
      const korea = await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      const bearer = await mintWriteToken(userId, { deviceId: "phone-bilingual" });
      const row = await visit({ visitedAt: "2026-10-02T16:30:00Z" }, bearer);
      expect(row.tripId).toBe(korea.id);
    });

    it("joins no trip when no trip's days hold the day", async () => {
      await trip(userId, "Rom", "2026-05-01", "2026-05-08");
      expect((await visit({ visitedAt: "2026-10-04" })).tripId).toBeNull();
    });

    it("joins no trip when several trips hold the day — that is the user's choice", async () => {
      await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      await trip(userId, "Seoul weekend", "2026-10-03", "2026-10-05");
      expect((await visit({ visitedAt: "2026-10-04" })).tripId).toBeNull();
    });

    it("keeps an explicit tripId: null although one trip would match", async () => {
      await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      expect((await visit({ visitedAt: "2026-10-04", tripId: null })).tripId).toBeNull();
    });

    it("keeps an explicit trip although another one would match by date", async () => {
      const rome = await trip(userId, "Rom", "2026-05-01", "2026-05-08");
      await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      expect((await visit({ visitedAt: "2026-10-04", tripId: rome.id })).tripId).toBe(rome.id);
    });

    it("never files a visit under another user's trip", async () => {
      await trip(otherUserId, "Fremd", "2026-10-01", "2026-10-31");
      expect((await visit({ visitedAt: "2026-10-04" })).tripId).toBeNull();
    });

    it("ignores a cancelled trip", async () => {
      await prisma.trip.create({
        data: {
          userId,
          name: "Abgesagt",
          status: "cancelled",
          startDay: toDbDate("2026-10-01"),
          endDay: toDbDate("2026-10-31"),
        },
      });
      expect((await visit({ visitedAt: "2026-10-04" })).tripId).toBeNull();
    });

    it("joins no trip when the visit has no date", async () => {
      await trip(userId, "Korea", "2026-10-03", "2026-10-19");
      expect((await visit({})).tripId).toBeNull();
    });
  });
});
