import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Finding I2: every upload route was open to the shared demo account. A
 * visitor's photograph is then shown to the next one, it is not deleted by the
 * nightly reseed (`wipeDemoUser` removes rows, not files), and twenty files of
 * fifteen megabytes per request fills the data volume of a public instance
 * that nobody is watching.
 *
 * So the shared account uploads nothing. Reading and deleting what is already
 * there is untouched — the seed writes no photos, so there is nothing of its
 * own to read, and a visitor tidying up after another is harmless.
 *
 * Each case sends NO file on purpose: the guard sits above multer, so a
 * refused request must answer 403 before a single byte reaches the disk. A
 * guard mounted below it would answer 400 "No photos uploaded" here.
 */
describe("upload routes and the shared demo account", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "uploadUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "uploadUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  const NIL = "00000000-0000-0000-0000-000000000000";
  const uploads: Array<[string, string]> = [
    ["receipt", "/api/v1/uploads/receipt"],
    ["trip photos", `/api/v1/trips/${NIL}/photos`],
    ["trip cover", `/api/v1/trips/${NIL}/cover`],
    ["place visit photos", `/api/v1/places/visits/${NIL}/photos`],
    ["lodging photos", `/api/v1/lodging/${NIL}/photos`],
    ["parser training sample", "/api/v1/training/upload"],
    // Found by an independent review on 2026-09-17 (finding A5): the GPX
    // upload for a tour route section was the one upload route this list had
    // missed, and it reaches multer and an XML parser. A track is location
    // history, which is worse than a photograph to accept from a stranger and
    // then show to the next one.
    ["tour route GPX", `/api/v1/trips/${NIL}/routes/${NIL}/tracks`],
  ];

  it.each(uploads)("refuses the %s upload for the shared demo account", async (_name, path) => {
    const res = await request(app).post(path).set("Cookie", demoCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it.each(uploads)("does not refuse the %s upload for a normal account", async (_name, path) => {
    const res = await request(app).post(path).set("Cookie", userCookie);
    expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it("still lets the shared demo account read what is already there", async () => {
    // A trip of its own, so the read path is exercised rather than a 404 that
    // would pass whatever the guard did. The trip detail carries the photos.
    const trip = await prisma.trip.create({
      data: { userId: ids[0], name: "Demo trip", startDate: new Date("2026-01-01") },
      select: { id: true },
    });
    const res = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", demoCookie);
    expect(res.status).toBe(200);
    await prisma.trip.delete({ where: { id: trip.id } });
  });
});
