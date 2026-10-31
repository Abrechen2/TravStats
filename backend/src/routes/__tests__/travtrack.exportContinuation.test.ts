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
    buildTravTrackExport: (
      userId: string,
      window: { fromMs: number; untilMs: number },
      after: Parameters<typeof actual.buildTravTrackExport>[2]
    ) => actual.buildTravTrackExport(userId, window, after, 2),
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

  /** Follows the continuation to the end; at most `max` parts. */
  const exportAll = async (owner: string, max = 8) => {
    const ownerCookie = `auth_token=${generateToken(owner)}`;
    const times: string[] = [];
    let parts = 0;
    let query: Record<string, string> = { fromDay: "2026-10-12", toDay: "2026-10-12" };
    for (let part = 0; part < max; part++) {
      const res = await request(app)
        .get("/api/v1/travtrack/export")
        .query({ ...query, format: "json" })
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      parts += 1;
      times.push(...JSON.parse(res.text).points.map((p: { t: string }) => p.t));
      if (res.headers["x-travtrack-coverage"] === "complete") return { times, parts, done: true };
      query = {
        from: res.headers["x-travtrack-next"],
        to: res.headers["x-travtrack-until"],
        cursor: res.headers["x-travtrack-cursor"],
      };
    }
    return { times, parts, done: false };
  };

  it("a part boundary between points of one instant neither repeats nor loses one", async () => {
    const other = await makeUser(`${PREFIX}same-instant`);
    // One fix, three sharing the next minute, one more: the first part ends inside the three.
    const at = [0, 1, 1, 1, 2].map((m) => T0 + m * MIN);
    for (const [i, t] of at.entries()) {
      await storePoint(other, { t, lat: 37.5 + i * 0.001, lon: 127 });
    }
    const { times, done } = await exportAll(other);
    expect(done).toBe(true);
    expect(times).toEqual(at.map((t) => new Date(t).toISOString()));
  });

  it("more points at one instant than a part holds still come out, each once", async () => {
    const other = await makeUser(`${PREFIX}one-instant`);
    for (let i = 0; i < 5; i++) {
      await storePoint(other, { t: T0, lat: 37.5 + i * 0.001, lon: 127 + i * 0.001 });
    }
    const { times, done, parts } = await exportAll(other);
    expect(done).toBe(true);
    expect(parts).toBe(3);
    expect(times).toHaveLength(5);
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
    expect(exposed).toContain("X-TravTrack-Cursor");
    // The admin parse-log export's cut flag, read by the web across origins.
    expect(exposed).toContain("X-Truncated");
    expect(exposed).toContain("X-Row-Limit");
  });
});
