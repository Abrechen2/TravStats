import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import request from "supertest";
import type { Express } from "express";

/**
 * The admin log area end to end, against a log directory of its own
 * (audit 2026-09-26, findings 2, 3, 6 and 9). What each test asserts is what
 * the admin page receives.
 */

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-adminlog-"));
process.env.TRAVSTATS_LOG_DIR = logDir;

let app: Express;
let prisma: typeof import("../../../db").prisma;
let adminCookie: string;
let adminId: string;
let savedSettings: Record<string, unknown> | null = null;
const DAY = 24 * 60 * 60 * 1000;

const line = (i: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: new Date(Date.UTC(2026, 8, 20, 10, i)).toISOString(),
    level: i % 2 ? "warn" : "info",
    category: i % 2 ? "security" : "general",
    operation: `entry_${i}`,
    ...extra,
  });

function writeFile(name: string, content: string | Buffer, ageDays: number): void {
  const full = path.join(logDir, name);
  fs.writeFileSync(full, content);
  const t = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(full, t, t);
}

async function waitForLine(file: string, needle: string): Promise<string | undefined> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const full = path.join(logDir, file);
    const found = fs.existsSync(full)
      ? fs
          .readFileSync(full, "utf8")
          .split("\n")
          .find((l) => l.includes(needle))
      : undefined;
    if (found) return found;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

// The whole app is imported inside the hook (after TRAVSTATS_LOG_DIR is set),
// which puts its transpile + module load on the hook's clock. Alone that is a
// few seconds; in a full parallel run it went past Jest's 5 s default and all
// fifteen tests failed on the hook, not on logging.
const APP_IMPORT_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  app = (await import("../../../index")).default;
  prisma = (await import("../../../db")).prisma;
  const { hashPassword } = await import("../../../utils/password");
  const { generateToken } = await import("../../../utils/jwt");
  await prisma.user.deleteMany({ where: { username: "logApiAdmin" } });
  const admin = await prisma.user.create({
    data: { username: "logApiAdmin", passwordHash: await hashPassword("pw123456"), isAdmin: true },
  });
  adminId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  savedSettings = (await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: {
      id: true,
      logLevel: true,
      logHttpRequests: true,
      logRetentionDays: true,
      maxLogFiles: true,
    },
  })) as Record<string, unknown> | null;
}, APP_IMPORT_TIMEOUT_MS);

afterAll(async () => {
  delete process.env.LOG_LEVEL;
  if (savedSettings) {
    const { id, ...rest } = savedSettings;
    await prisma.adminSettings.update({ where: { id: id as number }, data: rest });
  }
  const { invalidateCache, applyLoggingConfig } = await import("../../../services/loggingConfig");
  invalidateCache();
  await applyLoggingConfig();
  await prisma.user.deleteMany({ where: { id: adminId } });
  const { closeAllFileStreams } = await import("../../../utils/logging/fileStreams");
  await closeAllFileStreams();
  fs.rmSync(logDir, { recursive: true, force: true });
});

const admin = (req: request.Test) => req.set("Cookie", adminCookie);

describe("reading a log file", () => {
  beforeAll(() => {
    writeFile("fixture.log", [0, 1, 2, 3, 4].map((i) => line(i)).join("\n") + "\n", 0);
    writeFile(
      "fixture-20260919-0000-01.log.gz",
      zlib.gzipSync(Buffer.from([line(7), line(8)].join("\n") + "\n")),
      1
    );
  });

  it("pages newest first with total and hasMore", async () => {
    const first = await admin(request(app).get("/api/v1/admin/logging/files/fixture.log?limit=2"));
    expect(first.status).toBe(200);
    expect(first.body.entries.map((e: { operation: string }) => e.operation)).toEqual([
      "entry_4",
      "entry_3",
    ]);
    expect(first.body).toMatchObject({ total: 5, offset: 0, limit: 2, hasMore: true });

    const last = await admin(
      request(app).get("/api/v1/admin/logging/files/fixture.log?limit=2&offset=4")
    );
    expect(last.body.entries.map((e: { operation: string }) => e.operation)).toEqual(["entry_0"]);
    expect(last.body.hasMore).toBe(false);
  });

  it("filters by category on the single category field", async () => {
    const res = await admin(
      request(app).get("/api/v1/admin/logging/files/fixture.log?category=security")
    );
    expect(res.body.total).toBe(2);
    expect(res.body.entries.every((e: { category: string }) => e.category === "security")).toBe(
      true
    );
  });

  it("reads a rotated .gz file instead of refusing it", async () => {
    const res = await admin(
      request(app).get("/api/v1/admin/logging/files/fixture-20260919-0000-01.log.gz")
    );
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { operation: string }) => e.operation)).toEqual([
      "entry_8",
      "entry_7",
    ]);
  });

  it("answers a missing file with 404 and a stable code", async () => {
    const res = await admin(request(app).get("/api/v1/admin/logging/files/nothere.log"));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LOG_FILE_NOT_FOUND");
  });

  it.each(["..%2F..%2Fpackage.json", "..%2F.env.log", "app.log%00.txt", "%2E%2E%5Capp.log"])(
    "refuses a traversal attempt %s with 400 LOG_FILE_INVALID_NAME",
    async (name) => {
      const res = await admin(request(app).get(`/api/v1/admin/logging/files/${name}`));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LOG_FILE_INVALID_NAME");
    }
  );

  it("refuses traversal on download and delete too", async () => {
    const dl = await admin(
      request(app).get("/api/v1/admin/logging/files/..%2F..%2Fpackage.json/download")
    );
    expect(dl.status).toBe(400);
    const del = await admin(request(app).delete("/api/v1/admin/logging/files/..%2Fx.log"));
    expect(del.status).toBe(400);
  });

  it("serves a .gz download as application/gzip", async () => {
    const res = await admin(
      request(app).get("/api/v1/admin/logging/files/fixture-20260919-0000-01.log.gz/download")
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/gzip/);
  });
});

describe("stats and cleanup", () => {
  beforeAll(async () => {
    await prisma.adminSettings.updateMany({ data: { logRetentionDays: 7, maxLogFiles: 30 } });
    const { invalidateCache } = await import("../../../services/loggingConfig");
    invalidateCache();
    writeFile("old-20260101-0000-01.log.gz", zlib.gzipSync(Buffer.from(line(1))), 40);
    writeFile("20260101-0000-01-legacy.log.gz", zlib.gzipSync(Buffer.from(line(1))), 30);
    writeFile("recent-20260925-0000-01.log.gz", zlib.gzipSync(Buffer.from(line(1))), 1);
  });

  it("reports the oldest and newest log as timestamps, not file names", async () => {
    const res = await admin(request(app).get("/api/v1/admin/logging/stats"));
    expect(res.status).toBe(200);
    expect(Number.isNaN(Date.parse(res.body.oldestLogAt))).toBe(false);
    expect(Number.isNaN(Date.parse(res.body.newestLogAt))).toBe(false);
    expect(Date.parse(res.body.oldestLogAt)).toBeLessThan(Date.now() - 39 * DAY);
  });

  it("cleanup answers the shared contract and deletes past-retention files of both name forms", async () => {
    const res = await admin(request(app).post("/api/v1/admin/logging/cleanup"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deletedCount: 2,
      freedBytes: expect.any(Number),
      failedCount: 0,
      retentionDays: 7,
    });
    expect(res.body.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(logDir, "old-20260101-0000-01.log.gz"))).toBe(false);
    expect(fs.existsSync(path.join(logDir, "20260101-0000-01-legacy.log.gz"))).toBe(false);
    expect(fs.existsSync(path.join(logDir, "recent-20260925-0000-01.log.gz"))).toBe(true);
  });
});

describe("the logging settings take effect", () => {
  it("applies a saved level to the root logger and every category logger", async () => {
    const res = await admin(
      request(app).put("/api/v1/admin/logging/config").send({ logLevel: "warn" })
    );
    expect(res.status).toBe(200);
    expect(res.body.config).toMatchObject({
      logLevel: "warn",
      effectiveLogLevel: "warn",
      logLevelSource: "settings",
    });
    const loggerModule = await import("../../../utils/logger");
    expect(loggerModule.default.level).toBe("warn");
    expect(loggerModule.securityLogger.level).toBe("warn");
    expect(loggerModule.httpLogger.level).toBe("warn");
  });

  it("an explicit LOG_LEVEL pins the level and the config says so", async () => {
    process.env.LOG_LEVEL = "error";
    try {
      const res = await admin(
        request(app).put("/api/v1/admin/logging/config").send({ logLevel: "debug" })
      );
      expect(res.body.config).toMatchObject({
        logLevel: "debug",
        effectiveLogLevel: "error",
        logLevelSource: "environment",
      });
      expect((await import("../../../utils/logger")).default.level).toBe("error");
    } finally {
      delete process.env.LOG_LEVEL;
    }
  });

  it("switching HTTP logging on logs the very next request — full path, no query string", async () => {
    await admin(
      request(app)
        .put("/api/v1/admin/logging/config")
        .send({ logLevel: "debug", logHttpRequests: true })
    );
    await admin(request(app).get("/api/v1/admin/logging/stats?search=Mustermann&pnr=ABC123"));

    const logged = await waitForLine("http.log", "/api/v1/admin/logging/stats");
    expect(logged).toBeDefined();
    expect(logged).not.toContain("Mustermann");
    expect(logged).not.toContain("ABC123");
    expect(JSON.parse(logged!).context.path).toBe("/api/v1/admin/logging/stats");

    await admin(request(app).put("/api/v1/admin/logging/config").send({ logHttpRequests: false }));
    await admin(request(app).get("/api/v1/admin/logging/files?after=off"));
    await new Promise((r) => setTimeout(r, 300));
    const httpLog = fs.existsSync(path.join(logDir, "http.log"))
      ? fs.readFileSync(path.join(logDir, "http.log"), "utf8")
      : "";
    expect(httpLog).not.toContain("/api/v1/admin/logging/files");
  });
});
