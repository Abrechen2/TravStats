import fs from "fs";
import os from "os";
import path from "path";
import { selectExpiredLogFiles } from "../services/logRetention";
import { resolveEffectiveLogLevel } from "../utils/logging/levelPolicy";
import { parseLogFileName } from "../utils/logging/logFiles";

/**
 * Audit 2026-09-26, finding 3 (HIGH): retention only ran from a button while
 * the page promised automatic deletion; the beta held 69 files back five
 * months under a seven-day setting.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 26, 12);

describe("retention policy", () => {
  const file = (filename: string, ageDays: number) => ({
    filename,
    ...parseLogFileName(filename)!,
    mtimeMs: NOW - ageDays * DAY,
  });

  it("deletes past-retention files of both rotated name forms, never a live file", () => {
    const expired = selectExpiredLogFiles(
      [
        file("app.log", 30), // live, old mtime (quiet stream) — kept
        file("app-20260801-0000-01.log.gz", 30),
        file("20260427-0000-01-error.log.gz", 150), // rotating-file-stream's own naming
        file("error-20260925-0000-01.log.gz", 1),
        file("parser.log", 20), // not open: a category switched off weeks ago
      ],
      { retentionDays: 7, maxRotatedPerStream: 30, now: NOW },
      new Set(["app", "error"])
    );
    expect([...expired].sort()).toEqual([
      "20260427-0000-01-error.log.gz",
      "app-20260801-0000-01.log.gz",
      "parser.log",
    ]);
  });

  it("keeps at most maxLogFiles rotated copies per stream, newest first", () => {
    const rotated = [1, 2, 3, 4].map((d) => file(`app-2026092${d}-0000-01.log.gz`, d));
    const expired = selectExpiredLogFiles(
      rotated,
      { retentionDays: 30, maxRotatedPerStream: 2, now: NOW },
      new Set(["app"])
    );
    expect([...expired].sort()).toEqual([
      "app-20260923-0000-01.log.gz",
      "app-20260924-0000-01.log.gz",
    ]);
  });
});

describe("retention runs by itself", () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-retention-"));

  beforeAll(() => {
    process.env.TRAVSTATS_LOG_DIR = logDir;
  });

  afterAll(async () => {
    const { stopLogRetentionScheduler } = await import("../jobs/logRetentionScheduler");
    stopLogRetentionScheduler();
    const { closeAllFileStreams } = await import("../utils/logging/fileStreams");
    await closeAllFileStreams();
    delete process.env.TRAVSTATS_LOG_DIR;
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("starting the scheduler sweeps once at boot — no button needed", async () => {
    const stale = path.join(logDir, "app-20260101-0000-01.log.gz");
    fs.writeFileSync(stale, "x");
    const old = new Date(Date.now() - 400 * DAY);
    fs.utimesSync(stale, old, old);

    const { startLogRetentionScheduler } = await import("../jobs/logRetentionScheduler");
    startLogRetentionScheduler();

    const deadline = Date.now() + 5000;
    while (fs.existsSync(stale) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(fs.existsSync(stale)).toBe(false);
  });
});

describe("log level precedence", () => {
  it("an explicit LOG_LEVEL pins the level", () => {
    expect(resolveEffectiveLogLevel("debug", { LOG_LEVEL: "warn" })).toEqual({
      level: "warn",
      source: "environment",
    });
  });

  it("otherwise the stored setting wins", () => {
    expect(resolveEffectiveLogLevel("debug", { NODE_ENV: "production" })).toEqual({
      level: "debug",
      source: "settings",
    });
  });

  it("an unusable LOG_LEVEL does not pin anything", () => {
    expect(resolveEffectiveLogLevel("error", { LOG_LEVEL: "verbose" })).toEqual({
      level: "error",
      source: "settings",
    });
  });

  it("without a readable setting, the environment default", () => {
    expect(resolveEffectiveLogLevel(undefined, { NODE_ENV: "production" })).toEqual({
      level: "info",
      source: "default",
    });
  });
});
