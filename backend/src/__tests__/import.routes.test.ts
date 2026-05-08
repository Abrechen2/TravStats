import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { generateToken } from "../utils/jwt";

describe("POST /api/v1/import/preview", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-import-routes-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejects unauthenticated callers", async () => {
    const r = await request(app)
      .post("/api/v1/import/preview")
      .send({ rows: [] });
    expect(r.status).toBe(401);
  });

  it("ignores body-supplied userId (IDOR defense)", async () => {
    const evilUserId = "00000000-0000-0000-0000-000000000000";
    const r = await request(app)
      .post("/api/v1/import/preview")
      .set("Cookie", cookie)
      .send({
        rows: [
          {
            date: "2024-01-15",
            depTimeLocal: "10:00:00",
            arrTimeLocal: "13:00:00",
            durationSeconds: 8 * 3600,
            fromIata: "FRA",
            toIata: "JFK",
            flightNumber: "LH400",
            source: "fr24",
            sourceRowIndex: 0,
          },
        ],
        userId: evilUserId,
      });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(evilUserId);
  });

  it("rejects payload over MAX_PREVIEW_ROWS (1000)", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      date: "2024-01-01",
      depTimeLocal: "10:00:00",
      arrTimeLocal: "12:00:00",
      fromIata: "FRA",
      toIata: "JFK",
      flightNumber: `LH${i}`,
      source: "fr24",
      sourceRowIndex: i,
    }));
    const r = await request(app)
      .post("/api/v1/import/preview")
      .set("Cookie", cookie)
      .send({ rows });
    expect(r.status).toBe(413);
  });

  it("returns enriched rows for a valid request", async () => {
    const r = await request(app)
      .post("/api/v1/import/preview")
      .set("Cookie", cookie)
      .send({
        rows: [
          {
            date: "2024-01-15",
            depTimeLocal: "10:00:00",
            arrTimeLocal: "13:00:00",
            durationSeconds: 8 * 3600 + 25 * 60,
            fromIata: "FRA",
            toIata: "JFK",
            flightNumber: "LH400",
            source: "fr24",
            sourceRowIndex: 0,
          },
        ],
      });
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].depTimezone).toBe("Europe/Berlin");
    expect(r.body.rows[0].arrTimezone).toBe("America/New_York");
    expect(r.body.summary).toMatchObject({
      ok: expect.any(Number),
      problems: expect.any(Number),
      duplicates: expect.any(Number),
      unresolvable: expect.any(Number),
    });
  });
});
