import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

/**
 * Owner decision 2026-11-05: an ordinary account gets a diagnostic package with
 * only its own data; the server-wide package stays admin-only. (Between
 * 2026-09-25 and 2026-11-05 an ordinary account was refused with 403.)
 */

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-diag-scope-"));
process.env.TRAVSTATS_LOG_DIR = logDir;

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Db = typeof import("../db");
let prisma: Db["prisma"];
let app: import("express").Express;
const ids: string[] = [];
let adminCookie: string;
let userCookie: string;
let otherCookie: string;

beforeAll(async () => {
  ({ prisma } = await import("../db"));
  app = (await import("../index")).default;
  const { hashPassword } = await import("../utils/password");
  const { generateToken } = await import("../utils/jwt");
  await prisma.user.deleteMany({
    where: { username: { in: ["diagScopeAdmin", "diagScopeUser", "diagScopeOther"] } },
  });
  const passwordHash = await hashPassword("password123");
  const admin = await prisma.user.create({
    data: { username: "diagScopeAdmin", passwordHash, isAdmin: true },
  });
  const user = await prisma.user.create({ data: { username: "diagScopeUser", passwordHash } });
  const other = await prisma.user.create({ data: { username: "diagScopeOther", passwordHash } });
  ids.push(admin.id, user.id, other.id);
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  userCookie = `auth_token=${generateToken(user.id)}`;
  otherCookie = `auth_token=${generateToken(other.id)}`;

  await prisma.trip.createMany({
    data: [
      { userId: user.id, name: "mine 1" },
      { userId: user.id, name: "mine 2" },
      { userId: other.id, name: "theirs 1" },
      { userId: other.id, name: "theirs 2" },
      { userId: other.id, name: "theirs 3" },
    ],
  });

  const lines = [
    { level: "error", time: iso(5000), operation: "own_failure", userId: user.id },
    {
      level: "info",
      time: iso(4000),
      operation: "http_request",
      context: { userId: user.id, path: "/x" },
    },
    { level: "error", time: iso(3000), operation: "other_failure", userId: other.id },
    { level: "info", time: iso(2000), operation: "background_job_tick" },
  ];
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(path.join(logDir, "app.log"), body);
  fs.writeFileSync(path.join(logDir, "error.log"), body);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  const { closeAllFileStreams } = await import("../utils/logging/fileStreams");
  await closeAllFileStreams();
  delete process.env.TRAVSTATS_LOG_DIR;
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe("GET /diagnostic-export has two scopes", () => {
  it("gives an ordinary account a user-scoped package, not a 403 and not the server-wide one", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("user");
    for (const serverOnly of ["runtime", "settings", "database"]) {
      expect(res.body).not.toHaveProperty(serverOnly);
    }
  });

  it("counts only the caller's own rows and never the instance totals", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
    expect(res.body.counts.data.trips).toBe(2);
    expect(res.body.counts.data).not.toHaveProperty("users");
    expect(res.body.counts.data).not.toHaveProperty("backups");
    const other = await request(app).get("/api/v1/diagnostic-export").set("Cookie", otherCookie);
    expect(other.body.counts.data.trips).toBe(3);
  });

  it("carries only log lines written on the caller's behalf, and no file listing", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
    const events = (res.body.logs.data.recent as Array<{ event: string }>).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["own_failure", "http_request"]));
    expect(events).not.toContain("other_failure");
    expect(events).not.toContain("background_job_tick");
    expect(res.body.logs.data.errors.map((e: { event: string }) => e.event)).not.toContain(
      "other_failure"
    );
    expect(res.body.logs.data.files).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(os.hostname());
  });

  it("keeps the server-wide package for an admin, unchanged", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("server");
    expect(res.body.schema).toBe("travstats-diagnostic/2");
    expect(res.body.runtime).toBeDefined();
    expect(res.body.settings).toBeDefined();
    expect(res.body.database).toBeDefined();
    const events = (res.body.logs.data.recent as Array<{ event: string }>).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["own_failure", "other_failure"]));
    expect(res.body.counts.data.users).toBeGreaterThanOrEqual(3);
  });

  // `/diagnostics` returned up to 100 of the caller's flights with seats,
  // prices and descriptions unredacted, and nothing called it. Removed.
  it("no longer serves the removed per-user /diagnostics snapshot", async () => {
    const res = await request(app).get("/api/v1/diagnostics").set("Cookie", userCookie);
    expect(res.status).toBe(404);
  });
});
