import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /cruises` answers the questions the cruise logbook asks — on the
 * server, one page at a time.
 *
 * It did neither before. The handler took `limit`/`offset` and the browser
 * called it with neither, so it returned the default 500 rows with no `meta`:
 * from 501 cruises on the list stopped, with no count to contradict it. Every
 * filter, the sort and the paging then happened over the rows it had — which
 * is why it had to have them all.
 *
 * Each case asserts the ROWS and `meta.total` together. A filter that narrows
 * the page but not the count is the defect that makes a pager lie.
 */
describe("GET /api/v1/cruises — server-side search, filters, sort and paging", () => {
  let user: { id: string };
  let authCookie: string;
  const ids: Record<string, string> = {};
  const portIds: Record<string, number> = {};
  let shipId: number;

  const get = (query: Record<string, string | number> = {}) =>
    request(app).get("/api/v1/cruises").query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const stamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `cruises-list-query-${stamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const makePort = async (key: string, name: string, city: string): Promise<void> => {
      const port = await prisma.port.create({
        data: { name, city, lat: 54.3, lon: 10.1, isUserAdded: true, region: "Baltic" },
      });
      portIds[key] = port.id;
    };
    await makePort("kiel", `Kiel ${stamp}`, "Kiel");
    await makePort("oslo", `Oslo ${stamp}`, "Oslo");
    await makePort("dover", `Dover ${stamp}`, "Dover");

    // A ship whose LINE is known only through the catalogue row — the case
    // the `cruiseLine` column filter cannot see.
    const ship = await prisma.ship.create({
      data: { name: `Mein Schiff ${stamp}`, cruiseLine: "TUI Cruises", isUserAdded: true },
    });
    shipId = ship.id;

    const make = async (
      key: string,
      data: Parameters<typeof prisma.cruise.create>[0]["data"]
    ): Promise<void> => {
      const row = await prisma.cruise.create({ data });
      ids[key] = row.id;
    };

    await make("aida", {
      userId: user.id,
      shipNameOverride: "AIDAnova",
      cruiseLine: "AIDA Cruises",
      departurePortId: portIds.kiel,
      arrivalPortId: portIds.kiel,
      startDate: new Date("2023-06-01T00:00:00Z"),
      endDate: new Date("2023-06-08T00:00:00Z"),
      status: "flown",
      price: 1800,
      stops: {
        create: [
          { dayNumber: 1, portId: portIds.oslo, isAtSea: false },
          { dayNumber: 2, isAtSea: true },
        ],
      },
    });
    await make("tui", {
      userId: user.id,
      shipId,
      departurePortId: portIds.dover,
      arrivalPortId: portIds.dover,
      startDate: new Date("2024-03-10T00:00:00Z"),
      endDate: new Date("2024-03-17T00:00:00Z"),
      status: "scheduled",
      price: 2400,
      stops: { create: [{ dayNumber: 1, portId: portIds.oslo, isAtSea: false }] },
    });
    await make("costa", {
      userId: user.id,
      shipNameOverride: "Costa Toscana",
      cruiseLine: "Costa",
      routeName: "Westliches Mittelmeer",
      startDate: new Date("2024-06-01T00:00:00Z"),
      status: "cancelled",
      stops: { create: [{ dayNumber: 1, unresolvedPortName: `Savona ${stamp}`, isAtSea: false }] },
    });
    // An undated sailing: it belongs to no year, and must not be invented into
    // one.
    await make("undated", {
      userId: user.id,
      shipNameOverride: "Zuiderdam",
      cruiseLine: "Holland America",
      startDate: null,
      status: "scheduled",
    });
  });

  afterAll(async () => {
    await prisma.cruiseStop.deleteMany({ where: { cruise: { userId: user?.id } } }).catch(() => {});
    await prisma.cruise.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.port.deleteMany({ where: { id: { in: Object.values(portIds) } } }).catch(() => {});
    await prisma.ship.deleteMany({ where: { id: shipId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  const idsOf = (body: { data: Array<{ id: string }> }): string[] => body.data.map((c) => c.id);

  it("always carries meta, which the old handler never sent at all", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta).toEqual({ total: 4, limit: 500, offset: 0 });
  });

  describe("q — free text", () => {
    it("matches a ship name held in the catalogue", async () => {
      const res = await get({ q: "mein schiff" });
      expect(idsOf(res.body)).toEqual([ids.tui]);
      expect(res.body.meta.total).toBe(1);
    });

    it("matches the free-text ship name a parser wrote", async () => {
      expect(idsOf((await get({ q: "aidanova" })).body)).toEqual([ids.aida]);
    });

    it("matches a line, from the column or from the ship", async () => {
      expect(idsOf((await get({ q: "AIDA Cruises" })).body)).toEqual([ids.aida]);
      expect(idsOf((await get({ q: "TUI" })).body)).toEqual([ids.tui]);
    });

    // The browser search reached ship and line only, because those were the
    // two strings it had in hand. A reader searching for the port they sailed
    // from got nothing.
    it("matches a port the ship called at, which the old search could not", async () => {
      const res = await get({ q: "Dover" });
      expect(idsOf(res.body)).toEqual([ids.tui]);
    });

    it("matches a port the importer could not resolve", async () => {
      expect(idsOf((await get({ q: "Savona" })).body)).toEqual([ids.costa]);
    });

    it("matches the route name", async () => {
      expect(idsOf((await get({ q: "mittelmeer" })).body)).toEqual([ids.costa]);
    });

    it("reports a total for the filtered set, not for the account", async () => {
      const res = await get({ q: "no-such-sailing" });
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe("shipLine", () => {
    it("selects a line the cruise names itself", async () => {
      expect(idsOf((await get({ shipLine: "AIDA Cruises" })).body)).toEqual([ids.aida]);
    });

    /**
     * The case the `cruiseLine` column filter cannot answer. A sailing whose
     * line is known only through its ship is listed under that line in the
     * dropdown — and selecting it used to match nothing.
     */
    it("selects a line known only through the ship", async () => {
      const res = await get({ shipLine: "TUI Cruises" });
      expect(idsOf(res.body)).toEqual([ids.tui]);
      expect(res.body.meta.total).toBe(1);

      const columnOnly = await get({ cruiseLine: "TUI Cruises" });
      expect(columnOnly.body.data).toEqual([]);
    });
  });

  describe("status", () => {
    it("selects one status", async () => {
      expect(idsOf((await get({ status: "cancelled" })).body)).toEqual([ids.costa]);
    });

    /**
     * `in_progress` is derived from the dates and stored by the write path and
     * the nightly sweep; a client never sends it, so it is not in the WRITE
     * enum. The logbook's dropdown has offered it since "#status-from-dates",
     * and the moment the filter reaches the server an unlisted value is a 400
     * on an entry the app itself drew.
     */
    it("accepts in_progress, which no client may WRITE", async () => {
      const res = await get({ status: "in_progress" });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("rejects a status that is not a status", async () => {
      expect((await get({ status: "sunk" })).status).toBe(400);
    });
  });

  describe("year and month", () => {
    it("selects a calendar year", async () => {
      const res = await get({ year: 2024 });
      expect(idsOf(res.body).sort()).toEqual([ids.tui, ids.costa].sort());
      expect(res.body.meta.total).toBe(2);
    });

    it("narrows a year to one month", async () => {
      expect(idsOf((await get({ year: 2024, month: 3 })).body)).toEqual([ids.tui]);
    });

    it("selects a month across every year when no year is named", async () => {
      expect(idsOf((await get({ month: 6 })).body).sort()).toEqual([ids.aida, ids.costa].sort());
    });

    it("leaves an undated sailing out of every year", async () => {
      expect(idsOf((await get({ year: 2024 })).body)).not.toContain(ids.undated);
      expect(idsOf((await get({ month: 6 })).body)).not.toContain(ids.undated);
    });
  });

  describe("sort and order", () => {
    it("defaults to the newest sailing first", async () => {
      const order = idsOf((await get()).body);
      expect(order.slice(0, 3)).toEqual([ids.costa, ids.tui, ids.aida]);
      // An undated sailing sorts last, not first.
      expect(order[3]).toBe(ids.undated);
    });

    it("orders by ship, through the name the row would draw", async () => {
      // "AIDAnova" is the free-text override, "Mein Schiff …" the catalogue
      // name — one coalesce, which is why this cannot be a Prisma orderBy.
      const order = idsOf((await get({ sort: "ship", order: "asc" })).body);
      expect(order.indexOf(ids.aida)).toBeLessThan(order.indexOf(ids.costa));
      expect(order.indexOf(ids.costa)).toBeLessThan(order.indexOf(ids.tui));
    });

    it("orders by line, falling back to the ship's", async () => {
      const order = idsOf((await get({ sort: "line", order: "asc" })).body);
      // AIDA Cruises, Costa, Holland America, TUI Cruises (the last from the ship).
      expect(order).toEqual([ids.aida, ids.costa, ids.undated, ids.tui]);
    });

    it("orders by the number of ports, which is not a column at all", async () => {
      // aida: Kiel + Oslo = 2. tui: Dover + Oslo = 2. costa: 0 (unresolved
      // stops are not counted). undated: 0.
      const order = idsOf((await get({ sort: "ports", order: "desc" })).body);
      expect(order.slice(0, 2).sort()).toEqual([ids.aida, ids.tui].sort());
    });

    it("orders by price with the priceless sailings last in both directions", async () => {
      const asc = idsOf((await get({ sort: "price", order: "asc" })).body);
      expect(asc.slice(0, 2)).toEqual([ids.aida, ids.tui]);
      const desc = idsOf((await get({ sort: "price", order: "desc" })).body);
      expect(desc.slice(0, 2)).toEqual([ids.tui, ids.aida]);
      expect(desc.slice(2).sort()).toEqual([ids.costa, ids.undated].sort());
    });

    it("orders by the status LIFECYCLE, not alphabetically", async () => {
      // scheduled -> in_progress -> flown -> historical -> cancelled. The
      // alphabetical order of the stored strings would put cancelled first.
      const order = idsOf((await get({ sort: "status", order: "asc" })).body);
      expect(order[order.length - 1]).toBe(ids.costa);
      expect(order.indexOf(ids.aida)).toBeGreaterThan(order.indexOf(ids.tui));
    });

    it("rejects a sort key that is not whitelisted", async () => {
      expect((await get({ sort: "price; drop table" })).status).toBe(400);
    });

    /**
     * The tie-breaker, under the coarsest key there is. `status` takes five
     * values across a whole logbook, so ordering by it alone leaves nearly
     * every row's position undefined — and an undefined order across a page
     * boundary silently drops one sailing and repeats another. Walking the
     * set one row at a time must visit every id exactly once.
     */
    it("pages without skipping or repeating a row under a coarse sort", async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < 4; offset += 1) {
        const res = await get({ sort: "status", order: "asc", limit: 1, offset });
        expect(res.body.meta).toEqual({ total: 4, limit: 1, offset });
        expect(res.body.data).toHaveLength(1);
        seen.push(res.body.data[0].id);
      }
      expect(seen.sort()).toEqual([ids.aida, ids.costa, ids.tui, ids.undated].sort());
    });

    it("sorts the whole set and THEN slices, never the page alone", async () => {
      // Page two of "cheapest first" is the sailings that came after the two
      // priced ones — not the top of a truncated slice re-sorted.
      const page = await get({ sort: "price", order: "asc", limit: 2, offset: 2 });
      expect(idsOf(page.body).sort()).toEqual([ids.costa, ids.undated].sort());
      expect(page.body.meta.total).toBe(4);
    });
  });

  it("pages, and the page it returns is the page it was asked for", async () => {
    const first = await get({ limit: 2, offset: 0 });
    expect(idsOf(first.body)).toEqual([ids.costa, ids.tui]);
    expect(first.body.meta).toEqual({ total: 4, limit: 2, offset: 0 });

    const second = await get({ limit: 2, offset: 2 });
    expect(idsOf(second.body)).toEqual([ids.aida, ids.undated]);
    expect(second.body.meta).toEqual({ total: 4, limit: 2, offset: 2 });
  });

  it("still carries what a row draws — ship, ports, stops and legs", async () => {
    const res = await get({ q: "aidanova" });
    const [row] = res.body.data;
    expect(row.departurePort).not.toBeNull();
    expect(row.stops).toHaveLength(2);
    expect(row).toHaveProperty("legs");
  });
});
