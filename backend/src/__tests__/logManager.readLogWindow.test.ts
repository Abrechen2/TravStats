/**
 * Unit tests for readLogWindow — the time-bounded log reader added for
 * diagnostic-export v2. Uses a real temporary directory so the readline
 * stream is exercised end-to-end. Gzip coverage is added in Task 2.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

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
