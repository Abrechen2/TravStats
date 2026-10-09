import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { toUtcDate } from "../../services/flights/mergedChronology";

/**
 * forgejo#273 — a date-only arrival near a place is offered on the day it was
 * recorded. Such a row is written as a LOCAL wall clock through the airport's
 * zone (the form's noon, the cruise import's midnight), so its UTC date — what
 * the suggestion used to take — is the day before for Frankfurt at midnight
 * and for Auckland at noon in summer.
 */
describe("GET /api/v1/places/:id/visit-date-suggestions — date-only arrivals", () => {
  let userId: string;
  let cookie: string;
  let frankfurtPlace: string;
  let aucklandPlace: string;

  const suggest = (id: string) =>
    request(app).get(`/api/v1/places/${id}/visit-date-suggestions`).set("Cookie", cookie);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `visit-date-dateonly-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    frankfurtPlace = (
      await prisma.place.create({
        data: { userId, name: "Römer", lat: 50.1106, lon: 8.6821 },
      })
    ).id;
    aucklandPlace = (
      await prisma.place.create({
        data: { userId, name: "Sky Tower", lat: -36.8485, lon: 174.7622 },
      })
    ).id;

    const arrival = (
      arrIata: string,
      arrLat: number,
      arrLon: number,
      zone: string,
      local: string
    ) => {
      const at = toUtcDate(local, zone) as Date;
      return {
        userId,
        depLat: 52.36,
        depLon: 13.5,
        arrIata,
        arrLat,
        arrLon,
        arrTimezone: zone,
        departureTime: at,
        arrivalTime: at,
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
        status: "historical",
      };
    };
    await prisma.flight.createMany({
      data: [
        // The cruise import's midnight: 22:00Z on 9 May.
        arrival("FRA", 50.0379, 8.5622, "Europe/Berlin", "2025-05-10T00:00"),
        // The form's noon in Auckland's summer: 23:00Z on 14 January.
        arrival("AKL", -37.0082, 174.785, "Pacific/Auckland", "2025-01-15T12:00"),
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it.each([
    ["Frankfurt, cruise import midnight", () => frankfurtPlace, "2025-05-10"],
    ["Auckland, form noon in summer", () => aucklandPlace, "2025-01-15"],
  ])("offers the recorded day (%s)", async (_name, place, day) => {
    const res = await suggest(place());
    expect(res.status).toBe(200);
    const flights = res.body.data.suggestions.filter(
      (s: { source: string }) => s.source === "flight"
    );
    expect(flights.map((s: { date: string }) => s.date)).toEqual([day]);
  });
});
