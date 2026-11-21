/**
 * A cruise save replaces its stops; the photo links on a stop (manual picks,
 * automatic links and refusals) must follow the stop by its day and place, not
 * vanish with the old row (defect class 4: a re-derivation destroys good data).
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USER = "cruisephotolinks";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const C = "00000000-0000-4000-8000-0000000000a3";

describe("cruise stop photo links over a cruise save", () => {
  let cookie: string;
  let userId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
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

  it("keeps manual, auto and refused links on a stop that is still there, drops the removed stop's", async () => {
    const stop = (day: number, name: string) => ({
      dayNumber: day,
      isAtSea: false,
      unresolvedPortName: name,
    });
    const created = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({
        cruiseLine: "T",
        startDate: "2026-07-01",
        stops: [stop(1, "Hafen A"), stop(2, "Hafen B")],
      });
    const id = created.body.data.id as string;
    const [first, second] = (
      await prisma.cruiseStop.findMany({ where: { cruiseId: id }, orderBy: { dayNumber: "asc" } })
    ).map((s) => s.id);
    await prisma.entryPhotoLink.createMany({
      data: [
        { userId, cruiseStopId: first, assetId: A, provenance: "manual" },
        { userId, cruiseStopId: first, assetId: B, provenance: "auto" },
        { userId, cruiseStopId: first, assetId: C, provenance: "auto", refused: true },
        { userId, cruiseStopId: second, assetId: A, provenance: "manual" },
      ],
    });

    // The edit keeps day 1, drops day 2.
    const res = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({ stops: [stop(1, "Hafen A")] });
    expect(res.status).toBe(200);

    const [now] = await prisma.cruiseStop.findMany({ where: { cruiseId: id } });
    expect(now.id).not.toBe(first);
    const rows = await prisma.entryPhotoLink.findMany({
      where: { userId },
      orderBy: { assetId: "asc" },
    });
    expect(rows.map((r) => [r.cruiseStopId, r.assetId, r.provenance, r.refused])).toEqual([
      [now.id, A, "manual", false],
      [now.id, B, "auto", false],
      [now.id, C, "auto", true],
    ]);
  });
});
