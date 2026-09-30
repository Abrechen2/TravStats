import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { seedRailStations } from "../../seedRailStations";
import {
  RAIL_STATION_CODES_PATH,
  readStationCodes,
  seedRailStationCodes,
} from "../../seedRailStationCodes";
import { railCreationLimiter, railStationSearchLimiter } from "../../middleware/rateLimit";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import logger from "../../utils/logger";

/**
 * Short station codes (DB Ril 100 — KK for Köln Hbf), forgejo#132 item 16.
 * The table is vendored (data/rail/station_codes.csv, CC0), applied to the
 * catalogue at boot, and answered as `shortCode` — null where no source names
 * one, never guessed.
 */

const PREFIX = "rsc-";
const HEADER = "id,name,uic,db_id,lat,lon,country,time_zone,parent";
// EVAs in the 99… range cannot collide with the real catalogue or its table.
const CATALOGUE_ROWS = [
  `${PREFIX}1,Codetest Köln Hbf,9900001,9900001,50.943,6.959,DE,Europe/Berlin,`,
  `${PREFIX}2,Codetest Frankfurt Hbf,9900002,9900002,50.107,8.663,DE,Europe/Berlin,`,
  `${PREFIX}3,Codetest Nirgendwo,9900003,9900003,51.0,9.0,DE,Europe/Berlin,`,
];
const CODES = ["eva,code,source", "9900001,KK,openstation", "9900002,FF,openstation"];

const tmp = (name: string): string =>
  path.join(os.tmpdir(), `rail-codes-${process.pid}-${Date.now()}-${name}`);

describe("Rail station short codes", () => {
  let cookie: string;
  let userId: string;
  let catalogue: string;
  let codes: string;

  const search = (q: string) =>
    request(app)
      .get(`/api/v1/rail/stations?q=${encodeURIComponent(q)}`)
      .set("Cookie", cookie);
  const stationOf = (name: string) =>
    prisma.railStation.findFirstOrThrow({ where: { name, sourceId: { startsWith: PREFIX } } });

  beforeAll(async () => {
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.railStation.deleteMany({ where: { name: "Codetest Eigener Halt" } });
    await prisma.user.deleteMany({ where: { username: "railcodetest" } });
    const user = await prisma.user.create({
      data: { username: "railcodetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    catalogue = tmp("stations.csv.gz");
    fs.writeFileSync(catalogue, zlib.gzipSync(`${[HEADER, ...CATALOGUE_ROWS].join("\n")}\n`));
    codes = tmp("codes.csv");
    fs.writeFileSync(codes, `${CODES.join("\n")}\n`);
    await seedRailStations(catalogue);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await railStationSearchLimiter.resetKey(`user:${userId}`);
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.railStation.deleteMany({ where: { name: "Codetest Eigener Halt" } });
    await prisma.user.deleteMany({ where: { id: userId } });
    fs.rmSync(catalogue, { force: true });
    fs.rmSync(codes, { force: true });
    await prisma.$disconnect();
  });

  describe("the vendored table", () => {
    const table = readStationCodes(RAIL_STATION_CODES_PATH);

    it("lives in backend/data/rail, which the Dockerfile copies whole", () => {
      expect(RAIL_STATION_CODES_PATH.replace(/\\/g, "/")).toMatch(
        /backend\/data\/rail\/station_codes\.csv$/
      );
      const dockerfile = fs.readFileSync(
        path.resolve(__dirname, "../../../../Dockerfile"),
        "utf-8"
      );
      expect(dockerfile).toMatch(/^COPY backend\/data\/rail \.\/data\/rail$/m);
      expect(table.rejected).toBe(0);
    });

    it.each([
      ["8000207", "KK", "Köln Hbf"],
      ["8000105", "FF", "Frankfurt (Main) Hbf"],
      ["8000261", "MH", "München Hbf"],
      ["8011160", "BL", "Berlin Hbf"],
    ])("names EVA %s as %s (%s)", (eva, code) => {
      expect(table.codes.get(eva)).toBe(code);
    });

    it("takes the shortest of several codes, alphabetically on a tie", () => {
      // OpenStation lists FF and FFT for the deep-level Frankfurt platforms,
      // BWKR/BWKS/BWKRR for Berlin Westkreuz, BSPA/BSPD for Berlin-Spandau.
      expect(table.codes.get("8098105")).toBe("FF");
      expect(table.codes.get("8089047")).toBe("BWKR");
      expect(table.codes.get("8010404")).toBe("BSPA");
    });
  });

  describe("seedRailStationCodes", () => {
    it("writes the codes onto the catalogue and leaves a station without one null", async () => {
      const result = await seedRailStationCodes(codes);
      expect(result).toMatchObject({ status: "applied", known: 2, rejected: 0 });
      expect((await stationOf("Codetest Köln Hbf")).shortCode).toBe("KK");
      expect((await stationOf("Codetest Frankfurt Hbf")).shortCode).toBe("FF");
      expect((await stationOf("Codetest Nirgendwo")).shortCode).toBeNull();
    });

    it("changes nothing on a second run", async () => {
      await seedRailStationCodes(codes);
      expect(await seedRailStationCodes(codes)).toMatchObject({ status: "applied", updated: 0 });
    });

    it("never clears a stored code a thinner table no longer names", async () => {
      await seedRailStationCodes(codes);
      const thinner = tmp("thinner.csv");
      fs.writeFileSync(thinner, "eva,code,source\n9900002,FF,openstation\n");
      try {
        await seedRailStationCodes(thinner);
      } finally {
        fs.rmSync(thinner, { force: true });
      }
      expect((await stationOf("Codetest Köln Hbf")).shortCode).toBe("KK");
    });

    it("leaves a user-added station alone, even with a matching EVA", async () => {
      const own = await prisma.railStation.create({
        data: {
          name: "Codetest Eigener Halt",
          searchName: "codetest eigener halt",
          dbId: "9900001",
          lat: 50.9,
          lon: 6.9,
          isUserAdded: true,
        },
      });
      await seedRailStationCodes(codes);
      expect(
        (await prisma.railStation.findUniqueOrThrow({ where: { id: own.id } })).shortCode
      ).toBeNull();
    });

    it("counts a malformed row instead of dropping it silently", () => {
      const bad = tmp("bad.csv");
      fs.writeFileSync(bad, "eva,code,source\n9900001,KK,openstation\nabc,KK,x\n9900002,F F,x\n");
      try {
        expect(readStationCodes(bad)).toMatchObject({ rejected: 2 });
      } finally {
        fs.rmSync(bad, { force: true });
      }
    });

    it("warns loudly when the file is missing and writes nothing", async () => {
      const warn = jest.spyOn(logger, "warn");
      const before = await stationOf("Codetest Nirgendwo");
      const result = await seedRailStationCodes(tmp("does-not-exist.csv"));
      expect(result.status).toBe("missing");
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "seed_rail_station_codes_missing",
          message: expect.stringContaining("shortCode null"),
        })
      );
      expect((await stationOf("Codetest Nirgendwo")).shortCode).toBe(before.shortCode);
    });
  });

  describe("the API", () => {
    beforeAll(async () => {
      await seedRailStationCodes(codes);
    });

    it("answers shortCode on a search hit, and null where none is known", async () => {
      const res = await search("codetest");
      expect(res.status).toBe(200);
      const byName = Object.fromEntries(
        res.body.data.map((s: { name: string; shortCode: string | null }) => [s.name, s.shortCode])
      );
      expect(byName).toMatchObject({
        "Codetest Köln Hbf": "KK",
        "Codetest Frankfurt Hbf": "FF",
        "Codetest Nirgendwo": null,
      });
    });

    it("answers shortCode on a search by EVA number", async () => {
      const res = await search("9900001");
      expect(res.body.data[0]).toMatchObject({ name: "Codetest Köln Hbf", shortCode: "KK" });
    });

    it("carries each station's short code on a journey — list, detail and create", async () => {
      const koeln = await stationOf("Codetest Köln Hbf");
      const nirgendwo = await stationOf("Codetest Nirgendwo");
      const created = await request(app)
        .post("/api/v1/rail")
        .set("Cookie", cookie)
        .send({
          departureLocal: "2026-07-01T08:15",
          arrivalLocal: "2026-07-01T12:09",
          departureStation: { stationId: koeln.id, name: "Köln Hbf", lat: 0, lon: 0 },
          arrivalStation: { stationId: nirgendwo.id, name: "Nirgendwo", lat: 0, lon: 0 },
        });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        depStationShortCode: "KK",
        arrStationShortCode: null,
      });
      expect(created.body.data).not.toHaveProperty("depStation");

      const detail = await request(app)
        .get(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie);
      expect(detail.body.data).toMatchObject({
        depStationShortCode: "KK",
        arrStationShortCode: null,
      });

      const list = await request(app).get("/api/v1/rail").set("Cookie", cookie);
      const row = list.body.data.find((j: { id: string }) => j.id === created.body.data.id);
      expect(row).toMatchObject({ depStationShortCode: "KK", arrStationShortCode: null });
    });

    it("answers null for a station picked from the geocoder — no catalogue row, no code", async () => {
      const created = await request(app)
        .post("/api/v1/rail")
        .set("Cookie", cookie)
        .send({
          departureLocal: "2026-07-02T08:15",
          arrivalLocal: "2026-07-02T12:09",
          departureStation: { name: "Köln Hbf", lat: 50.943, lon: 6.959 },
          arrivalStation: { name: "Bonn Hbf", lat: 50.732, lon: 7.097 },
        });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        depStationShortCode: null,
        arrStationShortCode: null,
      });
    });
  });
});
