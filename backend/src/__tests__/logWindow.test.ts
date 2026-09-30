import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

/**
 * readLogWindow — the diagnostic export's log source. Real files in a
 * directory of their own; lines are written chronologically, as pino does.
 */

let logDir: string;

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-logwin-"));
  process.env.TRAVSTATS_LOG_DIR = logDir;
});

afterEach(() => {
  delete process.env.TRAVSTATS_LOG_DIR;
  fs.rmSync(logDir, { recursive: true, force: true });
});

const at = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

function jsonl(entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function write(name: string, content: string | Buffer, mtimeMsAgo = 0): void {
  const full = path.join(logDir, name);
  fs.writeFileSync(full, content);
  const t = new Date(Date.now() - mtimeMsAgo);
  fs.utimesSync(full, t, t);
}

describe("readLogWindow", () => {
  it("returns the window across the live file and rotated copies, oldest first", async () => {
    write(
      "app-20260925-0000-01.log.gz",
      zlib.gzipSync(jsonl([{ timestamp: at(2 * HOUR), level: "info", operation: "gz_2h" }])),
      2 * HOUR
    );
    write(
      "app.log",
      jsonl([
        { timestamp: at(5 * HOUR), level: "info", operation: "outside" },
        { time: at(HOUR), level: "info", operation: "legacy_time_field" },
        { timestamp: at(1000), level: "info", operation: "newest" },
      ])
    );

    const { readLogWindow } = await import("../services/logWindow");
    const window = await readLogWindow("app", 3 * HOUR);

    expect(window.entries.map((e) => e.operation)).toEqual([
      "gz_2h",
      "legacy_time_field",
      "newest",
    ]);
    expect(window).toMatchObject({ unreadableFiles: 0, truncated: false });
  });

  it("keeps the NEWEST entries when a cap bites — the lines around the error", async () => {
    write(
      "app.log",
      jsonl(
        Array.from({ length: 10 }, (_, i) => ({
          timestamp: at((10 - i) * 1000),
          level: "info",
          operation: `line_${i}`,
        }))
      )
    );

    const { readLogWindow } = await import("../services/logWindow");
    const window = await readLogWindow("app", HOUR, { maxEntries: 3 });

    expect(window.entries.map((e) => e.operation)).toEqual(["line_7", "line_8", "line_9"]);
    expect(window.truncated).toBe(true);
  });

  it("keeps the newest under the byte cap as well", async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      timestamp: at((50 - i) * 1000),
      level: "info",
      operation: `byte_${i}`,
    }));
    write("app.log", jsonl(entries));
    const oneLine = JSON.stringify(entries[0]).length;

    const { readLogWindow } = await import("../services/logWindow");
    const window = await readLogWindow("app", HOUR, { maxBytes: oneLine * 5 + 2 });

    expect(window.entries.at(-1)?.operation).toBe("byte_49");
    expect(window.entries.length).toBeLessThanOrEqual(5);
    expect(window.truncated).toBe(true);
  });

  it("reports an unreadable rotated file instead of returning a complete-looking list", async () => {
    write("app.log", jsonl([{ timestamp: at(1000), level: "error", operation: "live" }]));
    write("app-20260925-0000-01.log.gz", Buffer.from("this is not gzip"), HOUR);

    const { readLogWindow } = await import("../services/logWindow");
    const window = await readLogWindow("app", 3 * HOUR);

    expect(window.entries.map((e) => e.operation)).toEqual(["live"]);
    expect(window.unreadableFiles).toBe(1);
  });

  it("reads files of another stream never, even when the name starts alike", async () => {
    write("app.log", jsonl([{ timestamp: at(1000), level: "info", operation: "mine" }]));
    write("application.log", jsonl([{ timestamp: at(1000), level: "info", operation: "theirs" }]));

    const { readLogWindow } = await import("../services/logWindow");
    const window = await readLogWindow("app", HOUR);

    expect(window.entries.map((e) => e.operation)).toEqual(["mine"]);
  });
});
