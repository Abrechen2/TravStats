import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { mintWriteToken } from "../../shared/time/__tests__/patFixture";

/**
 * A visit that has happened takes its place out of the wishlist — also east of
 * UTC, where the legacy `visitedAt` column (the place's wall clock as fake
 * UTC) runs AHEAD of the real time by the zone's offset.
 *
 * Measured on prod, 2026-10-16: 24 places of a trip to Korea had a past visit
 * and `visited = false`, so "Orte besucht" left them out. Every one was logged
 * within nine hours of the visit — the Companion with an instant, the web with
 * a Seoul wall clock — and the route asked "has it happened?" of the legacy
 * column, which said "not for another few hours".
 */
const USER = "placevisitkst";
// Gamcheon Culture Village, Busan — Asia/Seoul, +09:00 all year (no DST).
const BUSAN = {
  name: "Gamcheon Culture Village",
  category: "landmark",
  lat: 35.0975,
  lon: 129.0106,
};
const HOUR = 3_600_000;
const KST_OFFSET = 9 * HOUR;

/** The Seoul wall clock of an instant, as the web form sends it. */
function seoulLocal(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET).toISOString().slice(0, 16);
}

describe("POST /places/:id/visits — a past visit east of UTC promotes the place", () => {
  let userId: string;
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.apiToken.deleteMany({ where: { user: { username: USER } } });
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const freshPlace = async (): Promise<string> =>
    (await prisma.place.create({ data: { userId, ...BUSAN, visited: false } })).id;

  const visitedFlag = async (placeId: string): Promise<boolean> =>
    (await prisma.place.findUniqueOrThrow({ where: { id: placeId } })).visited;

  it("the Companion's instant one hour ago marks the place visited", async () => {
    const placeId = await freshPlace();
    const bearer = await mintWriteToken(userId, { deviceId: "phone-kst" });
    const at = new Date(Date.now() - HOUR);
    const res = await request(app)
      .post(`/api/v1/places/${placeId}/visits`)
      .set("Authorization", bearer)
      .send({ visitedAt: at.toISOString() });
    expect(res.status).toBe(201);
    const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    // The precondition of the defect: the legacy column reads as the future.
    expect(row.visitedAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.writtenVia).toBe("companion");
    expect(await visitedFlag(placeId)).toBe(true);
  });

  it("a Seoul wall clock one hour ago, typed on the web, marks the place visited", async () => {
    const placeId = await freshPlace();
    const res = await request(app)
      .post(`/api/v1/places/${placeId}/visits`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: seoulLocal(new Date(Date.now() - HOUR)) } });
    expect(res.status).toBe(201);
    expect(await visitedFlag(placeId)).toBe(true);
  });

  it("a visit one hour AHEAD is still a plan and promotes nothing", async () => {
    const placeId = await freshPlace();
    const res = await request(app)
      .post(`/api/v1/places/${placeId}/visits`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: seoulLocal(new Date(Date.now() + HOUR)) } });
    expect(res.status).toBe(201);
    expect(await visitedFlag(placeId)).toBe(false);
  });

  it("moving a planned visit to one hour ago promotes the place (PATCH)", async () => {
    const placeId = await freshPlace();
    const planned = await request(app)
      .post(`/api/v1/places/${placeId}/visits`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: seoulLocal(new Date(Date.now() + 48 * HOUR)) } });
    expect(planned.status).toBe(201);
    expect(await visitedFlag(placeId)).toBe(false);

    const moved = await request(app)
      .patch(`/api/v1/places/visits/${planned.body.data.id}`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: seoulLocal(new Date(Date.now() - HOUR)) } });
    expect(moved.status).toBe(200);
    expect(await visitedFlag(placeId)).toBe(true);
  });
});
