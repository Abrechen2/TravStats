/**
 * Unit tests for readLogWindow — the time-bounded log reader added for
 * diagnostic-export v2. Uses a real temporary directory so the readline
 * stream is exercised end-to-end. Gzip coverage is added in Task 2.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";

// Mock the LOG_DIR by setting cwd before import
let tmpRoot: string;
let logDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-logwin-"));
  // logManager derives LOG_DIR from path.join(process.cwd(), '..', 'data', 'logs')
  // so we create a sibling 'data/logs' next to a fake cwd.
  const fakeCwd = path.join(tmpRoot, "backend");
  logDir = path.join(tmpRoot, "data", "logs");
  fs.mkdirSync(fakeCwd, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  jest.spyOn(process, "cwd").mockReturnValue(fakeCwd);
  // LOG_DIR is computed at module load time from process.cwd() — reset the
  // module cache so each test gets a fresh LOG_DIR pointing at its tmpRoot.
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const writeJsonl = (filename: string, entries: object[]): void => {
  fs.writeFileSync(
    path.join(logDir, filename),
    entries.map(e => JSON.stringify(e)).join("\n") + "\n",
  );
};

const iso = (msFromNow: number): string => new Date(Date.now() + msFromNow).toISOString();

describe("readLogWindow — active file, time cutoff", () => {
  it("returns entries inside the window and drops older ones", async () => {
    writeJsonl("app.log", [
      { time: iso(-1000), level: "info", msg: "inside-1s" },
      { time: iso(-60_000), level: "info", msg: "inside-1min" },
      { time: iso(-3 * 60 * 60_000), level: "info", msg: "outside-3h" },
    ]);

    const { readLogWindow } = await import("../services/logManager");
    const entries = await readLogWindow("app", 60 * 60 * 1000); // 1h window

    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.msg)).toEqual(["inside-1s", "inside-1min"]);
  });
});

describe("readLogWindow — rotated .gz files", () => {
  it("merges entries from active log and rotated gz files", async () => {
    // Active file: recent entries only
    writeJsonl("app.log", [{ time: iso(-1000), level: "info", msg: "recent" }]);

    // Rotated gz: older entries still inside window
    const rotatedLines = [
      { time: iso(-2 * 60 * 60_000), level: "info", msg: "gz-2h" },
      { time: iso(-1.5 * 60 * 60_000), level: "info", msg: "gz-1.5h" },
    ]
      .map(e => JSON.stringify(e))
      .join("\n") + "\n";
    fs.writeFileSync(
      path.join(logDir, "20260416-0000-01-app.log.gz"),
      zlib.gzipSync(Buffer.from(rotatedLines)),
    );

    const { readLogWindow } = await import("../services/logManager");
    // 3h window — captures all three
    const entries = await readLogWindow("app", 3 * 60 * 60 * 1000);

    expect(entries.map(e => e.msg).sort()).toEqual(["gz-1.5h", "gz-2h", "recent"]);
  });

  it("stops descending into gz files once cutoff is crossed", async () => {
    writeJsonl("app.log", [{ time: iso(-1000), level: "info", msg: "recent" }]);

    // Very old gz — outside the window
    const oldLines = [
      { time: iso(-48 * 60 * 60_000), level: "info", msg: "gz-2d" },
    ]
      .map(e => JSON.stringify(e))
      .join("\n") + "\n";
    fs.writeFileSync(
      path.join(logDir, "20260414-0000-01-app.log.gz"),
      zlib.gzipSync(Buffer.from(oldLines)),
    );

    const { readLogWindow } = await import("../services/logManager");
    const entries = await readLogWindow("app", 60 * 60 * 1000); // 1h

    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("recent");
  });

  it("ignores unrelated gz files whose name merely starts with the prefix", async () => {
    writeJsonl("app.log", [{ time: iso(-1000), level: "info", msg: "recent" }]);

    // These must NOT be treated as `app` log rotations:
    //   - appx.log.gz  (startsWith 'app' but no dash)
    //   - 20260416-application.log.gz (endsWith '-application.log.gz', not '-app.log.gz')
    for (const bogus of ["appx.log.gz", "20260416-application.log.gz"]) {
      fs.writeFileSync(
        path.join(logDir, bogus),
        zlib.gzipSync(
          Buffer.from(
            JSON.stringify({ time: iso(-30 * 60_000), level: "info", msg: `bogus-${bogus}` }) + "\n",
          ),
        ),
      );
    }

    const { readLogWindow } = await import("../services/logManager");
    const entries = await readLogWindow("app", 60 * 60 * 1000);

    expect(entries.map(e => e.msg)).toEqual(["recent"]);
  });
});
