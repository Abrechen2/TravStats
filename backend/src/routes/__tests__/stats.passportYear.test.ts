import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { loadPassport } from "../../services/stats/passportLoader";

/**
 * `?year=` on the passport and the country page (companion-redesign C4), over
 * a real database.
 *
 * The fixture, one account:
 * - US: a round trip MUC-JFK-MUC in May 2023, so a 2023-only visit.
 * - TH: NRT-BKK departing 2023-12-31 22:30 UTC — 07:30 on 1 January 2024 in
 *   Tokyo — and back on 6 January. On the LOCAL calendar that is 2024 only; a
 *   UTC cut would file the outbound under 2023.
 * - AT: a completed stay in August 2023.
 * - PT and CZ: a place ticked visited with no visit day, and a house with no
 *   stay. Both undated: lifetime only, never under any year.
 */
describe("GET /api/v1/stats/passport and /countries/:code with ?year=", () => {
  let user: { id: string };
  let authCookie: string;
  let catalogReady = false;

  const flight = (dep: string, arr: string, at: string, depTimezone?: string) => ({
    userId: user.id,
    depIata: dep,
    depLat: 0,
    depLon: 0,
    arrIata: arr,
    arrLat: 0,
    arrLon: 0,
    departureTime: new Date(at),
    status: "flown",
    ...(depTimezone ? { depTimezone } : {}),
  });

  const codesOf = (body: { countries: Array<{ code: string }> }): string[] =>
    body.countries.map((c) => c.code).sort();

  const passport = (query = "") =>
    request(app).get(`/api/v1/stats/passport${query}`).set("Cookie", authCookie);
  const country = (code: string, query = "") =>
    request(app).get(`/api/v1/stats/countries/${code}${query}`).set("Cookie", authCookie);

  beforeAll(async () => {
    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "JFK", "NRT", "BKK"] } },
      select: { iata: true, country: true },
    });
    catalogReady = ["MUC", "JFK", "NRT", "BKK"].every((c) =>
      airports.some((a) => a.iata === c && a.country)
    );
    if (!catalogReady) return;

    user = await prisma.user.create({
      data: {
        username: `passport-year-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        flight("MUC", "JFK", "2023-05-01T09:00:00Z"),
        flight("JFK", "MUC", "2023-05-10T22:00:00Z"),
        flight("NRT", "BKK", "2023-12-31T22:30:00Z", "Asia/Tokyo"),
        flight("BKK", "NRT", "2024-01-06T01:00:00Z", "Asia/Bangkok"),
      ],
    });

    const vienna = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Pension Wien",
        country: "Österreich",
        isoCountryCode: "AT",
        visited: true,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: vienna.id,
        checkIn: new Date("2023-08-01T00:00:00Z"),
        checkOut: new Date("2023-08-04T00:00:00Z"),
        status: "completed",
      },
    });

    // Undated evidence: a house with no stay, a place visited on no recorded day.
    await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Penzion bez data",
        country: "Česko",
        isoCountryCode: "CZ",
        visited: true,
      },
    });
    await prisma.place.create({
      data: {
        userId: user.id,
        name: "Torre de Belém",
        lat: 38.69,
        lon: -9.21,
        visited: true,
        isoCountryCode: "PT",
      },
    });
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {});
  });

  it("answers the lifetime passport without a year, plus scope.year null", async () => {
    if (!catalogReady) return;
    const res = await passport();

    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual({ year: null });
    expect(codesOf(res.body)).toEqual(expect.arrayContaining(["AT", "CZ", "PT", "TH", "US"]));
    // Byte for byte what the loader answered before `scope` existed.
    const { scope: _scope, ...rest } = res.body;
    expect(rest).toEqual(JSON.parse(JSON.stringify(await loadPassport(user.id))));
  });

  it("lists a 2023-only country under 2023 and not under 2024", async () => {
    if (!catalogReady) return;
    const [y2023, y2024] = await Promise.all([passport("?year=2023"), passport("?year=2024")]);

    expect(y2023.status).toBe(200);
    expect(y2023.body.scope).toEqual({ year: 2023 });
    expect(codesOf(y2023.body)).toContain("US");
    expect(codesOf(y2023.body)).toContain("AT");
    const us = y2023.body.countries.find((c: { code: string }) => c.code === "US");
    expect(us).toMatchObject({ visited: true, firstYear: 2023, lastYear: 2023 });

    expect(y2024.status).toBe(200);
    expect(y2024.body.scope).toEqual({ year: 2024 });
    expect(codesOf(y2024.body)).not.toContain("US");
    expect(codesOf(y2024.body)).not.toContain("AT");
  });

  it("files a flight by its departure airport's local day, not by UTC", async () => {
    if (!catalogReady) return;
    const [y2023, y2024] = await Promise.all([passport("?year=2023"), passport("?year=2024")]);

    // 2023-12-31 22:30 UTC is 2024-01-01 07:30 in Tokyo.
    expect(codesOf(y2023.body)).not.toContain("TH");
    expect(y2023.body.stamps.map((s: { iata: string }) => s.iata)).not.toContain("BKK");
    const th = y2024.body.countries.find((c: { code: string }) => c.code === "TH");
    expect(th).toMatchObject({ visited: true, firstYear: 2024, lastYear: 2024 });
  });

  it("never puts undated evidence under a year", async () => {
    if (!catalogReady) return;
    for (const year of [2023, 2024, 2026]) {
      const res = await passport(`?year=${year}`);
      expect(codesOf(res.body)).not.toContain("CZ");
      expect(codesOf(res.body)).not.toContain("PT");
      expect(
        res.body.countries.some((c: { hasUndatedEvidence: boolean }) => c.hasUndatedEvidence)
      ).toBe(false);
    }
  });

  it("refuses an invalid year with 400", async () => {
    if (!catalogReady) return;
    for (const bad of ["abc", "1899", "2101", "2023.5"]) {
      expect((await passport(`?year=${bad}`)).status).toBe(400);
      expect((await country("US", `?year=${bad}`)).status).toBe(400);
    }
  });

  it("opens a country page only for a year that has its records", async () => {
    if (!catalogReady) return;
    const [lifetime, y2023, y2024] = await Promise.all([
      country("US"),
      country("US", "?year=2023"),
      country("US", "?year=2024"),
    ]);

    expect(lifetime.status).toBe(200);
    expect(lifetime.body.scope).toEqual({ year: null });
    expect(y2023.status).toBe(200);
    expect(y2023.body.scope).toEqual({ year: 2023 });
    expect(y2023.body).toMatchObject({ code: "US", entries: 2, firstYear: 2023, lastYear: 2023 });
    expect(y2024.status).toBe(404);
  });

  it("dates the country page on the local calendar too", async () => {
    if (!catalogReady) return;
    expect((await country("TH", "?year=2023")).status).toBe(404);
    const y2024 = await country("TH", "?year=2024");
    expect(y2024.status).toBe(200);
    expect(y2024.body).toMatchObject({ entries: 2, visited: true, scope: { year: 2024 } });
  });

  it("opens an undated country's page for lifetime only", async () => {
    if (!catalogReady) return;
    expect((await country("PT")).status).toBe(200);
    expect((await country("CZ")).status).toBe(200);
    expect((await country("PT", "?year=2023")).status).toBe(404);
    expect((await country("CZ", "?year=2024")).status).toBe(404);
  });
});
