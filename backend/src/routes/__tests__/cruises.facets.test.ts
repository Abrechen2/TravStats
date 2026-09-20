import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /cruises/facets` — the option lists and figures drawn around the table.
 *
 * These are why the cruise logbook could not paginate: the year and line
 * dropdowns and the "N Kreuzfahrten · N Hafenanläufe · N Seetage ·
 * N Reedereien" strip were all computed from the complete row set in the
 * browser, so paging the rows underneath would have changed nothing.
 *
 * The behaviour worth pinning is the faceting rule, because a reasonable
 * reading gets it wrong: an option list is counted under every other filter
 * but NOT its own. Applying a facet to itself leaves the dropdown holding
 * only the value you picked, with no way back out.
 */
describe("GET /api/v1/cruises/facets", () => {
  let user: { id: string };
  let authCookie: string;
  let shipId: number;
  let portId: number;

  const facets = (query: Record<string, string | number> = {}) =>
    request(app).get("/api/v1/cruises/facets").query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const stamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `cruises-facets-${stamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const port = await prisma.port.create({
      data: { name: `Kiel ${stamp}`, city: "Kiel", lat: 54.3, lon: 10.1, isUserAdded: true },
    });
    portId = port.id;
    const ship = await prisma.ship.create({
      data: { name: `Mein Schiff ${stamp}`, cruiseLine: "TUI Cruises", isUserAdded: true },
    });
    shipId = ship.id;

    // Two AIDA sailings in 2023, one with two calls and a sea day.
    await prisma.cruise.create({
      data: {
        userId: user.id,
        cruiseLine: "AIDA Cruises",
        startDate: new Date("2023-05-01T00:00:00Z"),
        status: "flown",
        stops: {
          create: [
            { dayNumber: 1, portId, isAtSea: false },
            { dayNumber: 2, isAtSea: true },
            { dayNumber: 3, portId, isAtSea: false },
          ],
        },
      },
    });
    await prisma.cruise.create({
      data: {
        userId: user.id,
        cruiseLine: "AIDA Cruises",
        startDate: new Date("2023-09-01T00:00:00Z"),
        status: "flown",
        stops: { create: [{ dayNumber: 1, portId, isAtSea: false }] },
      },
    });
    // One TUI sailing in 2024 whose line is known only through the ship.
    await prisma.cruise.create({
      data: {
        userId: user.id,
        shipId,
        startDate: new Date("2024-02-01T00:00:00Z"),
        status: "scheduled",
        stops: { create: [{ dayNumber: 1, isAtSea: true }] },
      },
    });
    // A sailing that names no line at all — it is not a line, and the figure
    // must not invent one.
    await prisma.cruise.create({
      data: {
        userId: user.id,
        startDate: new Date("2024-07-01T00:00:00Z"),
        status: "scheduled",
      },
    });
  });

  afterAll(async () => {
    await prisma.cruiseStop.deleteMany({ where: { cruise: { userId: user?.id } } }).catch(() => {});
    await prisma.cruise.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.port.deleteMany({ where: { id: portId } }).catch(() => {});
    await prisma.ship.deleteMany({ where: { id: shipId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("answers in the cruise router's own envelope", async () => {
    const res = await facets();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("summary");
  });

  it("lists sailing years with counts, newest first", async () => {
    const { body } = await facets();
    expect(body.data.years).toEqual([
      { value: 2024, count: 2 },
      { value: 2023, count: 2 },
    ]);
  });

  it("lists lines with counts, most sailings first", async () => {
    const { body } = await facets();
    expect(body.data.lines).toEqual([
      { value: "AIDA Cruises", count: 2 },
      // Counted through the SHIP, which the `cruise_line` column alone cannot
      // see — the dropdown lists it, so the count has to reach it.
      { value: "TUI Cruises", count: 1 },
    ]);
  });

  it("leaves a sailing that names no line out of the list and the figure", async () => {
    const { body } = await facets();
    expect(body.data.lines.map((l: { value: string }) => l.value)).not.toContain("");
    expect(body.data.summary.lines).toBe(2);
  });

  it("summarises the filtered set — sailings, calls and sea days", async () => {
    const { body } = await facets();
    expect(body.data.summary.cruises).toBe(4);
    // Three port calls (a sea day is not a call), two sea days.
    expect(body.data.summary.portCalls).toBe(3);
    expect(body.data.summary.seaDays).toBe(2);
  });

  describe("faceting — a list is counted under every filter but its own", () => {
    it("keeps every line in the line list when one line is picked", async () => {
      const { body } = await facets({ shipLine: "AIDA Cruises" });
      expect(body.data.lines).toEqual([
        { value: "AIDA Cruises", count: 2 },
        { value: "TUI Cruises", count: 1 },
      ]);
      // …while everything else DOES narrow: that is the point of the rule.
      expect(body.data.years).toEqual([{ value: 2023, count: 2 }]);
      expect(body.data.summary.cruises).toBe(2);
    });

    it("keeps every year in the year list when one year is picked", async () => {
      const { body } = await facets({ year: 2024 });
      expect(body.data.years).toEqual([
        { value: 2024, count: 2 },
        { value: 2023, count: 2 },
      ]);
      expect(body.data.lines).toEqual([{ value: "TUI Cruises", count: 1 }]);
      expect(body.data.summary.cruises).toBe(2);
    });

    it("narrows the year list by a month, because a month is not the year facet", async () => {
      const { body } = await facets({ month: 5 });
      expect(body.data.years).toEqual([{ value: 2023, count: 1 }]);
    });
  });

  it("honours the same filters the list endpoint takes", async () => {
    const byStatus = await facets({ status: "scheduled" });
    expect(byStatus.body.data.summary.cruises).toBe(2);

    const bySearch = await facets({ q: "Mein Schiff" });
    expect(bySearch.body.data.summary.cruises).toBe(1);
    expect(bySearch.body.data.years).toEqual([{ value: 2024, count: 1 }]);
  });

  it("answers an empty result with empty lists, not with an error", async () => {
    const { body } = await facets({ q: "no-such-sailing-anywhere" });
    expect(body.data.years).toEqual([]);
    expect(body.data.lines).toEqual([]);
    expect(body.data.summary).toEqual({ cruises: 0, portCalls: 0, seaDays: 0, lines: 0 });
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/v1/cruises/facets")).status).toBe(401);
  });

  // "/facets" must not be read as a cruise id. Registration order decides
  // that, and nothing else would notice if it were reversed.
  it("is not swallowed by the /:id route", async () => {
    const { body } = await facets();
    expect(body.data).toHaveProperty("years");
  });
});
