import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * The admin user list showed only the flight count. It now carries one total
 * over every entry domain, so an account with a flight, a stay and a place
 * visit reads 3 — and trips are not entries.
 */
const ADMIN = "adminUsersEntryAdmin";
const SUBJECT = "adminUsersEntrySubject";

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

describe("GET /admin/users entry totals", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [ADMIN, SUBJECT] } } });
    await prisma.$disconnect();
  });

  it("sums entries across all domains instead of counting flights only", async () => {
    await prisma.user.deleteMany({ where: { username: { in: [ADMIN, SUBJECT] } } });
    const passwordHash = await hashPassword("password123");
    await prisma.user.create({ data: { username: ADMIN, passwordHash, isAdmin: true } });
    const subject = await prisma.user.create({ data: { username: SUBJECT, passwordHash } });
    const userId = subject.id;
    await prisma.flight.create({
      data: { userId, depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 },
    });
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel" } });
    await prisma.lodgingStay.create({ data: { userId, lodgingId: lodging.id } });
    const place = await prisma.place.create({ data: { userId, name: "Spot", lat: 1, lon: 1 } });
    await prisma.placeVisit.create({ data: { userId, placeId: place.id } });
    await prisma.trip.create({ data: { userId, name: "Not an entry" } });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: ADMIN, password: "password123" });
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", cookiesOf(login));
    expect(res.status).toBe(200);
    const row = res.body.users.find((u: { username: string }) => u.username === SUBJECT);
    expect(row.entryTotal).toBe(3);
    expect(row.entryCounts).toMatchObject({ flight: 1, lodging: 1, poi: 1, rail: 0, tour: 0 });
    const admin = res.body.users.find((u: { username: string }) => u.username === ADMIN);
    expect(admin.entryTotal).toBe(0);
  });
});
