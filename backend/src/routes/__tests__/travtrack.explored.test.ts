import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { utcMidnight } from "../../services/countryDays/store";
import { tileOf } from "../../services/travtrack/explored/cells";
import { createZone } from "../../services/travtrack/zones";
import { circleCells, EXPLORED_MAX_CELLS } from "../../services/travtrack/explored/privacy";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/explored?bbox=w,s,e,n` (TravTrack plan L1, review focus 26):
 * the account's explored zoom-14 cells in the box — always that one
 * resolution, never a time — with privacy zones drawn as explored ground by
 * the fixed neighbour rule. Tier `on`.
 */

const PREFIX = "travtrack-explored-route-";
const BERLIN = "13.0,52.3,13.8,52.7";
const ZONE = { lat: 52.52, lon: 13.405, radiusM: 3_000 };

describe("TravTrack — the explored map", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const explored = (query: Record<string, string>, as = cookie) =>
    request(app).get("/api/v1/travtrack/explored").query(query).set("Cookie", as);
  const seed = (owner: string, cells: Array<{ x: number; y: number }>, day = "2026-10-12") =>
    prisma.travTrackExploredCell.createMany({
      data: cells.map((c) => ({ userId: owner, day: utcMidnight(day), ...c })),
      skipDuplicates: true,
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.travTrackExploredCell.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.travTrackZoneCell.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.travTrackDerivationState.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("answers the cells in the box, each once over every day, and nothing else", async () => {
    const mitte = tileOf(52.52, 13.405);
    const munich = tileOf(48.137, 11.575);
    await seed(userId, [mitte, munich]);
    await seed(userId, [mitte], "2026-10-13");

    const res = await explored({ bbox: BERLIN });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cells: [[mitte.x, mitte.y]] });
  });

  it("the answer carries no time", async () => {
    await seed(userId, [tileOf(52.52, 13.405)]);
    const res = await explored({ bbox: BERLIN });
    expect(Object.keys(res.body)).toEqual(["cells"]);
    expect(JSON.stringify(res.body)).not.toMatch(/2026|day|date|time|at/i);
  });

  it("the answer is the same cell set for any requested zoom", async () => {
    await createZone(userId, { name: "Zuhause", ...ZONE }, true);
    // Explored ground all round the zone, so the zone is drawn too.
    const zoneCells = circleCells(ZONE);
    const inZone = new Set(zoneCells.map((c) => `${c.x}/${c.y}`));
    const xs = zoneCells.map((c) => c.x);
    const ys = zoneCells.map((c) => c.y);
    const beside: Array<{ x: number; y: number }> = [];
    for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x++) {
      for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
        if (!inZone.has(`${x}/${y}`)) beside.push({ x, y });
      }
    }
    await seed(userId, beside);
    const plain = await explored({ bbox: BERLIN });
    expect(plain.body.cells.length).toBeGreaterThan(beside.length);
    for (const zoom of ["3", "10", "18"]) {
      const res = await explored({ bbox: BERLIN, zoom });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(plain.body);
    }
  });

  it("a zone surrounded by explored cells is drawn as explored, never as a hole", async () => {
    await createZone(userId, { name: "Zuhause", ...ZONE }, true);
    const zoneCells = circleCells(ZONE);
    const keys = new Set(zoneCells.map((c) => `${c.x}/${c.y}`));
    const xs = zoneCells.map((c) => c.x);
    const ys = zoneCells.map((c) => c.y);
    const ring: Array<{ x: number; y: number }> = [];
    for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x++) {
      for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
        if (!keys.has(`${x}/${y}`)) ring.push({ x, y });
      }
    }
    await seed(userId, ring);

    const res = await explored({ bbox: BERLIN });
    const drawn = new Set(res.body.cells.map(([x, y]: number[]) => `${x}/${y}`));
    for (const c of zoneCells) expect(drawn.has(`${c.x}/${c.y}`)).toBe(true);
    expect(drawn.size).toBe(zoneCells.length + ring.length);
  });

  it("an isolated zone with no explored neighbour emits nothing", async () => {
    await createZone(userId, { name: "Zuhause", ...ZONE }, true);
    const res = await explored({ bbox: BERLIN });
    expect(res.body).toEqual({ cells: [] });
  });

  it("another account's cells and zones are never read", async () => {
    await seed(otherId, [tileOf(52.52, 13.405)]);
    await createZone(otherId, { name: "Z", ...ZONE }, true);
    await seed(
      otherId,
      circleCells(ZONE).map((c) => ({ x: c.x + 30, y: c.y }))
    );
    expect((await explored({ bbox: BERLIN })).body).toEqual({ cells: [] });
  });

  it("more cells than one answer carries → 400 zoom in", async () => {
    const many = Array.from({ length: EXPLORED_MAX_CELLS + 1 }, (_, i) => ({
      x: 8000 + (i % 300),
      y: 5000 + Math.floor(i / 300),
    }));
    await seed(userId, many);
    const res = await explored({ bbox: "-180,-85,180,85" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAVTRACK_EXPLORED_ZOOM_IN");
  });

  it("refuses a box that is not one", async () => {
    for (const bbox of ["", "1,2,3", "a,b,c,d", "10,60,20,50", "0,-91,10,0", "-181,0,0,10"]) {
      const res = await explored({ bbox });
      expect(res.status).toBe(400);
    }
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED", async () => {
    await seed(userId, [tileOf(52.52, 13.405)]);
    await switches.set({ beta: true, config: false });
    const res = await explored({ bbox: BERLIN });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });

  it("needs a signed-in account", async () => {
    const res = await request(app).get("/api/v1/travtrack/explored").query({ bbox: BERLIN });
    expect(res.status).toBe(401);
  });
});
