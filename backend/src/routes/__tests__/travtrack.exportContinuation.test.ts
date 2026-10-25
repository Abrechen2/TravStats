import request from "supertest";
import { jest } from "@jest/globals";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * A span over the export's point cap is exported in parts (Codex P2): the
 * truncated answer names where the rest starts (`X-TravTrack-Next`) and
 * where the span ends (`X-TravTrack-Until`), and asking for exactly that
 * span returns the rest — so even a single day over the cap comes out
 * whole. The cap is lowered to two points here.
 */

jest.mock("../../services/travtrack/exportFormats", () => {
  const actual = jest.requireActual<typeof import("../../services/travtrack/exportFormats")>(
    "../../services/travtrack/exportFormats"
  );
  return {
    ...actual,
    buildTravTrackExport: (userId: string, window: { fromMs: number; untilMs: number }) =>
      actual.buildTravTrackExport(userId, window, 2),
  };
});

const PREFIX = "travtrack-export-parts-";
const MIN = 60_000;
const T0 = Date.parse("2026-10-12T00:00:00Z");

describe("TravTrack — an export in parts", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    for (let i = 0; i < 5; i++) {
      await storePoint(userId, { t: T0 + i * MIN, lat: 37.5 + i * 0.001, lon: 127 });
    }
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("names where the rest of an over-cap day starts and ends, and the rest follows from there", async () => {
    const times: string[] = [];
    let parts = 0;
    let query: Record<string, string> = { fromDay: "2026-10-12", toDay: "2026-10-12" };
    for (let part = 0; part < 5; part++) {
      const res = await request(app)
        .get("/api/v1/travtrack/export")
        .query({ ...query, format: "json" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      parts += 1;
      const body = JSON.parse(res.text);
      times.push(...body.points.map((p: { t: string }) => p.t));
      if (res.headers["x-travtrack-coverage"] === "complete") {
        expect(res.headers["x-travtrack-next"]).toBeUndefined();
        break;
      }
      expect(res.headers["x-travtrack-until"]).toBe(body.to);
      query = { from: res.headers["x-travtrack-next"], to: res.headers["x-travtrack-until"] };
    }
    // Two points per part: five points are three files.
    expect(parts).toBe(3);
    expect(times).toEqual(
      Array.from({ length: 5 }, (_, i) => new Date(T0 + i * MIN).toISOString())
    );
  });

  it("lets a browser on another origin read the continuation", async () => {
    const res = await request(app)
      .get("/api/v1/travtrack/export")
      .query({ fromDay: "2026-10-12", toDay: "2026-10-12", format: "gpx" })
      .set("Origin", "http://localhost:3000")
      .set("Cookie", cookie);
    const exposed = String(res.headers["access-control-expose-headers"] ?? "");
    expect(exposed).toContain("X-TravTrack-Next");
    expect(exposed).toContain("X-TravTrack-Until");
  });
});
