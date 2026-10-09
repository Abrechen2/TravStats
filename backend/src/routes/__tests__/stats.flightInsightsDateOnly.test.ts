import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { loadFlightInsightRows } from "../../services/stats/flightInsights/rows";

/**
 * Review of forgejo#256, fix round 1: the date-only and odd-zone handling of
 * the flight-insight loader, pinned against `shared/time/dateOnlyFlights.json`
 * (forgejo#273) through the real table — a date-only flight is filed on its
 * LOCAL day, never on the stored UTC date, so a New Year's Day flight in
 * Auckland discovers its airport in the new year.
 */
interface DateOnlyCase {
  id: string;
  iata: string;
  zone: string;
  day: string;
  stored: string;
}

const cases = (
  JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../../shared/time/dateOnlyFlights.json"), "utf8")
  ) as { cases: DateOnlyCase[] }
).cases;

describe("flight insights over date-only flights", () => {
  let userId: string;
  let cookie: string;
  const idByCase = new Map<string, string>();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `insights-dateonly-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    for (const c of cases) {
      const flight = await prisma.flight.create({
        data: {
          userId,
          status: "historical",
          depIata: c.iata,
          arrIata: null,
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
          depTimezone: c.zone,
          arrTimezone: c.zone,
          depTimeSemantics: "DATE_ONLY",
          arrTimeSemantics: "DATE_ONLY",
          departureTime: new Date(c.stored),
          arrivalTime: new Date(c.stored),
        },
      });
      idByCase.set(c.id, flight.id);
    }
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("files each case on its local day, as an exact day", async () => {
    const rows = new Map((await loadFlightInsightRows(userId)).map((r) => [r.id, r]));
    for (const c of cases) {
      const r = rows.get(idByCase.get(c.id)!)!;
      expect([c.id, r.departureDay, r.departureDayExact]).toEqual([c.id, c.day, true]);
    }
  });

  it("discovers the Auckland New Year's Day airport in the new year", async () => {
    const res = await request(app).get("/api/v1/stats/flight-insights").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const yearOf = (code: string): number | undefined =>
      res.body.years.find((y: { newAirports: string[] }) => y.newAirports.includes(code))?.year;
    const akl = cases
      .filter((c) => c.iata === "AKL")
      .map((c) => c.day)
      .sort()[0];
    expect(yearOf("AKL")).toBe(Number(akl.slice(0, 4)));
    expect(res.body.history.placeholderDateFlights).toBe(0);
  });
});
