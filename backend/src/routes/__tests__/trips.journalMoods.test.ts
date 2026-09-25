import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /trips/journal-moods` — the journal editor's mood chips. Pinned: the
 * ranking (count, then recency, surrounding space ignored), that blank moods
 * are no mood, and that another account's journal is never offered.
 */
describe("GET /api/v1/trips/journal-moods", () => {
  let user: { id: string };
  let other: { id: string };

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("moods");
    other = await make("moods-other");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "A", color: "#fff" } });
    const trip2 = await prisma.trip.create({ data: { userId: user.id, name: "B", color: "#fff" } });
    const foreign = await prisma.trip.create({
      data: { userId: other.id, name: "C", color: "#fff" },
    });
    const entry = (tripId: string, mood: string | null, createdAt: string) => ({
      tripId,
      date: new Date("2025-01-01"),
      body: "x",
      mood,
      createdAt: new Date(createdAt),
    });
    await prisma.tripJournalEntry.createMany({
      data: [
        // 🙂 twice, once with a trailing space, across two trips.
        entry(trip.id, "🙂", "2025-01-01T00:00:00Z"),
        entry(trip2.id, "🙂 ", "2025-01-02T00:00:00Z"),
        // Once each: the later one ranks first.
        entry(trip.id, "müde", "2025-01-03T00:00:00Z"),
        entry(trip.id, "🌟", "2025-01-04T00:00:00Z"),
        entry(trip.id, "", "2025-01-05T00:00:00Z"),
        entry(trip.id, null, "2025-01-05T00:00:00Z"),
        entry(foreign.id, "secret-mood", "2025-01-06T00:00:00Z"),
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  });

  it("ranks the user's own moods by use, then by recency", async () => {
    const res = await request(app)
      .get("/api/v1/trips/journal-moods")
      .set("Cookie", `auth_token=${generateToken(user.id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moods: ["🙂", "🌟", "müde"] });
  });

  it("offers another account nothing of this one's journal", async () => {
    const res = await request(app)
      .get("/api/v1/trips/journal-moods")
      .set("Cookie", `auth_token=${generateToken(other.id)}`);
    expect(res.body).toEqual({ moods: ["secret-mood"] });
  });
});
