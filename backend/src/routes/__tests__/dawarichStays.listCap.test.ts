import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * forgejo#385 (RULE-25): the stay inbox stopped at 200 rows and said nothing,
 * so a 201st pending finding was simply unreachable. `meta.truncated` says it.
 */
let userId: string;
let cookie: string;

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-cap-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

const stay = (i: number) => ({
  userId,
  fingerprint: `cap-${i}`,
  sourceStartAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
  sourceEndAt: new Date(Date.UTC(2026, 0, 1, 0, i, 30)),
  sourceLat: 37.5,
  sourceLon: 126.9,
  startAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
  endAt: new Date(Date.UTC(2026, 0, 1, 0, i, 30)),
  lat: 37.5,
  lon: 126.9,
  zone: "Asia/Seoul",
  pointCount: 4,
  evidence: {},
});

it("says meta.truncated=false while the inbox fits", async () => {
  await prisma.dawarichStay.createMany({ data: [stay(0)] });
  const res = await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie);
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(1);
  expect(res.body.meta).toEqual({ truncated: false });
});

it("says meta.truncated=true when more than 200 findings are pending", async () => {
  await prisma.dawarichStay.createMany({
    data: Array.from({ length: 200 }, (_, i) => stay(i + 1)),
  });
  const res = await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie);
  expect(res.body.data).toHaveLength(200);
  expect(res.body.meta).toEqual({ truncated: true });
});
