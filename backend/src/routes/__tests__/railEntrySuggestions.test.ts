import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * GET /rail/entry-suggestions: the rail form's chips come from the user's own
 * rides only, the station pair counts in both directions, and every list is
 * bounded. The other user's rides on the same pair are the proof of scoping.
 */
describe("GET /rail/entry-suggestions", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const MUC = { name: "München Hbf", lat: 48.14, lon: 11.56 };
  const BER = { name: "Berlin Hbf", lat: 52.52, lon: 13.37 };
  const NUE = { name: "Nürnberg Hbf", lat: 49.45, lon: 11.08 };

  function ride(
    owner: string,
    from: typeof MUC,
    to: typeof MUC,
    extra: Record<string, unknown>,
    day: string
  ) {
    return {
      userId: owner,
      depStationName: from.name,
      depLat: from.lat,
      depLon: from.lon,
      arrStationName: to.name,
      arrLat: to.lat,
      arrLon: to.lon,
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
      departureTime: new Date(`${day}T08:00:00Z`),
      ...extra,
    };
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (
      await prisma.user.create({ data: { username: `rail-suggest-${stamp}`, passwordHash } })
    ).id;
    otherId = (
      await prisma.user.create({ data: { username: `rail-suggest-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.railJourney.createMany({
      data: [
        ride(
          userId,
          MUC,
          BER,
          {
            operator: "DB Fernverkehr",
            trainCategory: "ICE",
            trainNumber: "578",
            travelClass: "second",
            coach: "12",
            seat: "45",
          },
          "2025-01-10"
        ),
        ride(
          userId,
          MUC,
          BER,
          {
            operator: "DB Fernverkehr",
            trainCategory: "ICE",
            trainNumber: "578",
            travelClass: "second",
            coach: "12",
            seat: "45",
          },
          "2025-02-10"
        ),
        // The way home: the same line, the other direction.
        ride(
          userId,
          BER,
          MUC,
          { operator: "DB Fernverkehr", trainCategory: "ICE", trainNumber: "503", seat: "46" },
          "2025-02-12"
        ),
        // Another pair: must not be offered first for MUC–BER.
        ride(
          userId,
          MUC,
          NUE,
          { operator: "agilis", trainCategory: "RE", trainNumber: "4", travelClass: "first" },
          "2025-03-01"
        ),
        // Someone else's ride on the same pair, with a train the user never took.
        ride(
          otherId,
          MUC,
          BER,
          { operator: "FlixTrain", trainCategory: "FLX", trainNumber: "1234", seat: "99" },
          "2025-03-02"
        ),
      ],
    });
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("offers the pair's trains in both directions, most frequent first, and nobody else's", async () => {
    const res = await request(app)
      .get("/api/v1/rail/entry-suggestions")
      .query({ depName: "münchen hbf", arrName: "Berlin Hbf" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const trains = res.body.data.trains as Array<{ category: string | null; number: string }>;
    expect(trains.slice(0, 2)).toEqual([
      { category: "ICE", number: "578" },
      { category: "ICE", number: "503" },
    ]);
    expect(trains.map((t) => t.number)).not.toContain("1234");
    expect(res.body.data.operators[0]).toBe("DB Fernverkehr");
    expect(res.body.data.operators).not.toContain("FlixTrain");
    expect(res.body.data.seats).not.toContain("99");
  });

  it("gives the usual class, coaches and seats from the whole logbook", async () => {
    const res = await request(app).get("/api/v1/rail/entry-suggestions").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.travelClass).toBe("second");
    expect(res.body.data.coaches).toEqual(["12"]);
    expect(res.body.data.seats.slice(0, 2)).toEqual(["45", "46"]);
  });

  it("falls back to the operator's trains when the pair has none", async () => {
    const res = await request(app)
      .get("/api/v1/rail/entry-suggestions")
      .query({ depName: "Hamburg Hbf", arrName: "Kiel Hbf", operator: "agilis" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.trains).toEqual([{ category: "RE", number: "4" }]);
  });

  it("treats blank parameters as absent and refuses a malformed station id", async () => {
    const blank = await request(app)
      .get("/api/v1/rail/entry-suggestions")
      .query({ depName: "  ", arrName: "", operator: "" })
      .set("Cookie", cookie);
    expect(blank.status).toBe(200);

    const bad = await request(app)
      .get("/api/v1/rail/entry-suggestions")
      .query({ depStationId: "abc" })
      .set("Cookie", cookie);
    expect(bad.status).toBe(400);
  });

  it("answers 401 without a session", async () => {
    const res = await request(app).get("/api/v1/rail/entry-suggestions");
    expect(res.status).toBe(401);
  });
});
