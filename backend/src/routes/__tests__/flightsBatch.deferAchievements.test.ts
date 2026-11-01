import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as achievements from "../../utils/achievements";

/**
 * forgejo#334. A chunked import posts 20 rows at a time and every chunk re-read
 * the whole account for badges. `?deferAchievements=1` lets the importer run
 * one check after its last chunk; without the flag nothing changes.
 */
const stamp = Date.now();

describe("POST /flights/batch — deferAchievements", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `fb-defer-${stamp}`, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  let seq = 0;
  const row = () => {
    seq += 1;
    const day = String(seq).padStart(2, "0");
    return {
      flightNumber: `LH${4000 + seq}`,
      departure: { iata: "FRA", lat: 50.03, lon: 8.57 },
      arrival: { iata: "MUC", lat: 48.35, lon: 11.79 },
      departureLocal: `2026-11-${day}T08:00`,
      arrivalLocal: `2026-11-${day}T09:00`,
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
    };
  };
  const post = (query: string) =>
    request(app).post(`/api/v1/flights/batch${query}`).set("Cookie", cookie).send([row()]);

  it("skips the per-chunk achievement check when the importer defers it", async () => {
    const spy = jest.spyOn(achievements, "checkAndUpdateAchievements");
    await post("?deferAchievements=1").expect(201);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still checks achievements after a batch that does not defer", async () => {
    const spy = jest.spyOn(achievements, "checkAndUpdateAchievements");
    await post("").expect(201);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
