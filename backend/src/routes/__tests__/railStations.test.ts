import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { seedRailStations, RAIL_STATIONS_PATH } from "../../seedRailStations";
import { railCreationLimiter, railStationSearchLimiter } from "../../middleware/rateLimit";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The rail station catalogue: the idempotent seeder, the typeahead, and a
 * journey picked from it (spec 2026-09-25-rail-domain, phase 2).
 */

const PREFIX = "rst-";
const HEADER = "id,name,uic,db_id,lat,lon,country,time_zone,parent";
const FIXTURE_ROWS = [
  `${PREFIX}1,Zürich HB,8503000,8503000,47.378177,8.540192,CH,Europe/Zurich,`,
  `${PREFIX}2,Zürich Frohburg,,,47.40,8.55,CH,Europe/Zurich,`,
  `${PREFIX}3,Frankfurt (Main) Hbf,8011068,8000105,50.107149,8.663785,DE,Europe/Berlin,${PREFIX}4`,
  `${PREFIX}4,Frankfurt (Main),8096021,,50.107149,8.663785,DE,Europe/Berlin,`,
  `${PREFIX}5,Frankfurt Hbf (tief),8067016,8098105,50.10741,8.6632,DE,Europe/Berlin,${PREFIX}3`,
  `${PREFIX}6,"Nowhere, no position",,,,,DE,Europe/Berlin,`,
];

function writeFixture(rows: string[]): string {
  const file = path.join(os.tmpdir(), `rail-stations-${process.pid}-${Date.now()}.csv.gz`);
  fs.writeFileSync(file, zlib.gzipSync(`${[HEADER, ...rows].join("\n")}\n`));
  return file;
}

describe("Rail station catalogue", () => {
  let cookie: string;
  let userId: string;
  let fixture: string;

  const search = (q: string, extra = "") =>
    request(app)
      .get(`/api/v1/rail/stations?q=${encodeURIComponent(q)}${extra}`)
      .set("Cookie", cookie);
  const stationIdOf = async (name: string): Promise<number> =>
    (
      await prisma.railStation.findFirstOrThrow({
        where: { name, sourceId: { startsWith: PREFIX } },
      })
    ).id;

  beforeAll(async () => {
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.railStation.deleteMany({ where: { isUserAdded: true, name: "Mein Bahnsteig" } });
    await prisma.user.deleteMany({ where: { username: "railstationtest" } });
    const user = await prisma.user.create({
      data: { username: "railstationtest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    fixture = writeFixture(FIXTURE_ROWS);
    await seedRailStations(fixture);
  });

  afterEach(async () => {
    await railStationSearchLimiter.resetKey(`user:${userId}`);
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.railStation.deleteMany({ where: { isUserAdded: true, name: "Mein Bahnsteig" } });
    await prisma.user.deleteMany({ where: { id: userId } });
    fs.rmSync(fixture, { force: true });
    await prisma.$disconnect();
  });

  describe("seedRailStations", () => {
    it("reads the vendored file from backend/data/rail, where the Dockerfile copies it", () => {
      expect(RAIL_STATIONS_PATH.replace(/\\/g, "/")).toMatch(
        /backend\/data\/rail\/stations\.csv\.gz$/
      );
      expect(fs.existsSync(RAIL_STATIONS_PATH)).toBe(true);
      const dockerfile = fs.readFileSync(
        path.resolve(__dirname, "../../../../Dockerfile"),
        "utf-8"
      );
      expect(dockerfile).toMatch(/^COPY backend\/data\/rail \.\/data\/rail$/m);
    });

    it("stored the rows with a position, folded for search, and skipped the one without", async () => {
      const rows = await prisma.railStation.findMany({
        where: { sourceId: { startsWith: PREFIX } },
        orderBy: { sourceId: "asc" },
      });
      expect(rows.map((r) => r.sourceId)).toEqual([1, 2, 3, 4, 5].map((n) => `${PREFIX}${n}`));
      const fra = rows.find((r) => r.sourceId === `${PREFIX}3`)!;
      expect(fra).toMatchObject({
        name: "Frankfurt (Main) Hbf",
        searchName: "frankfurt main hbf",
        uic: "8011068",
        dbId: "8000105",
        country: "DE",
        timezone: "Europe/Berlin",
        parentSourceId: `${PREFIX}4`,
        isUserAdded: false,
      });
      expect(rows.find((r) => r.sourceId === `${PREFIX}1`)!.searchName).toBe("zurich hb");
    });

    it("inserts nothing on a second run and never overwrites a row already there", async () => {
      await prisma.railStation.update({
        where: { sourceId: `${PREFIX}2` },
        data: { name: "Zürich Frohburg (renamed by hand)" },
      });
      const userRow = await prisma.railStation.create({
        data: {
          name: "Mein Bahnsteig",
          searchName: "mein bahnsteig",
          lat: 47.378,
          lon: 8.54,
          isUserAdded: true,
        },
      });

      expect(await seedRailStations(fixture)).toBe(0);

      const renamed = await prisma.railStation.findUniqueOrThrow({
        where: { sourceId: `${PREFIX}2` },
      });
      expect(renamed.name).toBe("Zürich Frohburg (renamed by hand)");
      expect(await prisma.railStation.findUnique({ where: { id: userRow.id } })).toMatchObject({
        name: "Mein Bahnsteig",
        isUserAdded: true,
      });
      await prisma.railStation.update({
        where: { sourceId: `${PREFIX}2` },
        data: { name: "Zürich Frohburg" },
      });
    });

    it("adds only the rows a newer file brings", async () => {
      const newer = writeFixture([
        ...FIXTURE_ROWS,
        `${PREFIX}7,Basel SBB,8500010,8500010,47.547,7.589,CH,Europe/Zurich,`,
      ]);
      try {
        expect(await seedRailStations(newer)).toBe(1);
      } finally {
        fs.rmSync(newer, { force: true });
        await prisma.railStation.deleteMany({ where: { sourceId: `${PREFIX}7` } });
      }
    });
  });

  describe("GET /api/v1/rail/stations", () => {
    it("requires authentication", async () => {
      expect((await request(app).get("/api/v1/rail/stations?q=zurich")).status).toBe(401);
    });

    it("refuses a one-letter query", async () => {
      expect((await search("z")).status).toBe(400);
    });

    it("matches across diacritics and at the start of words only", async () => {
      const res = await search("zurich hb");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // "hb" sits inside "Frohburg" too, but not at the start of a word.
      expect(res.body.data.map((s: { name: string }) => s.name)).toEqual(["Zürich HB"]);
    });

    it("finds a name by its words in any spelling of the punctuation", async () => {
      const res = await search("frankfurt hbf");
      const names = res.body.data.map((s: { name: string }) => s.name);
      expect(names).toEqual(
        expect.arrayContaining(["Frankfurt (Main) Hbf", "Frankfurt Hbf (tief)"])
      );
      expect(names).not.toContain("Frankfurt (Main)");
    });

    it("finds a station by its UIC or its EVA number, exactly", async () => {
      const byUic = await search("8011068");
      const byEva = await search("8000105");
      expect(byUic.body.data.map((s: { name: string }) => s.name)).toEqual([
        "Frankfurt (Main) Hbf",
      ]);
      expect(byEva.body.data[0]).toMatchObject({
        name: "Frankfurt (Main) Hbf",
        uic: "8011068",
        dbId: "8000105",
        country: "DE",
        timezone: "Europe/Berlin",
      });
      expect((await search("801106")).body.data).toEqual([]);
    });

    it("puts a name that starts with the query first and honours the limit", async () => {
      const res = await search("frankfurt", "&limit=2");
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].name.toLowerCase().startsWith("frankfurt")).toBe(true);
    });

    it("is answered by the catalogue router, not taken for a journey id", async () => {
      const res = await search("zurich");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("a journey picked from the catalogue", () => {
    const base = {
      departureLocal: "2026-07-01T08:15",
      arrivalLocal: "2026-07-01T12:09",
    };

    it("takes position, code and country from the catalogue and keeps the reference", async () => {
      const fraId = await stationIdOf("Frankfurt (Main) Hbf");
      const zrhId = await stationIdOf("Zürich HB");
      const res = await request(app)
        .post("/api/v1/rail")
        .set("Cookie", cookie)
        .send({
          ...base,
          // A client that sends a stale position is overruled by the catalogue.
          departureStation: { stationId: fraId, name: "Frankfurt Hbf", lat: 0, lon: 0 },
          arrivalStation: { stationId: zrhId, name: "Zürich HB", lat: 47.37, lon: 8.54 },
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        depStationName: "Frankfurt Hbf",
        depStationId: fraId,
        depStationCode: "8011068",
        depLat: 50.107149,
        depLon: 8.663785,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationId: zrhId,
        arrStationCode: "8503000",
        arrCountry: "CH",
        geometrySource: "straight",
        geometry: null,
      });
    });

    it("refuses a station id the catalogue does not have", async () => {
      const res = await request(app)
        .post("/api/v1/rail")
        .set("Cookie", cookie)
        .send({
          ...base,
          departureStation: { stationId: 2_000_000_000, name: "Ghost", lat: 50, lon: 8 },
          arrivalStation: { name: "Basel", lat: 47.547, lon: 7.589 },
        });
      expect(res.status).toBe(400);
    });

    it("forgets the catalogue reference when the station is re-picked from the geocoder", async () => {
      const fraId = await stationIdOf("Frankfurt (Main) Hbf");
      const created = await request(app)
        .post("/api/v1/rail")
        .set("Cookie", cookie)
        .send({
          ...base,
          departureStation: { stationId: fraId, name: "Frankfurt (Main) Hbf", lat: 50.1, lon: 8.6 },
          arrivalStation: { name: "Basel SBB", lat: 47.547, lon: 7.589 },
        });
      const patched = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({
          departureStation: { name: "Mainz Hbf", lat: 50.0013, lon: 8.2588, country: "DE" },
        });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({
        depStationName: "Mainz Hbf",
        depStationId: null,
        depStationCode: null,
      });
    });
  });
});
