import fs from "fs";
import os from "os";
import path from "path";

/**
 * Audit 2026-09-26, findings 4 and 5 (MEDIUM): security.log, http.log,
 * database.log and the parser logs stayed at 0 bytes — the exported category
 * loggers were bound at import to streams built before the category files
 * existed, and re-initialising built new loggers nobody held. And the
 * category was written twice per line (binding + formatter), so a JSON reader
 * kept "general" and the admin's category filter found nothing.
 *
 * This drives the real logger into a directory of its own.
 */

let logDir: string;

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-catlog-"));
  process.env.TRAVSTATS_LOG_DIR = logDir;
  jest.resetModules();
});

afterEach(async () => {
  const { closeAllFileStreams } = await import("../utils/logging/fileStreams");
  await closeAllFileStreams();
  delete process.env.TRAVSTATS_LOG_DIR;
  fs.rmSync(logDir, { recursive: true, force: true });
});

async function waitForLine(file: string, needle: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const full = path.join(logDir, file);
    if (fs.existsSync(full)) {
      const line = fs
        .readFileSync(full, "utf8")
        .split("\n")
        .find((l) => l.includes(needle));
      if (line) return line;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${needle} never reached ${file}`);
}

describe("category loggers write their own files", () => {
  it("a security event lands in security.log once the file is switched on", async () => {
    const { securityLogger, setCategoryFileEnabled } = await import("../utils/logger");

    expect(setCategoryFileEnabled("security", true)).toBe(true);
    securityLogger.warn({ operation: "security_probe_event" });

    const line = await waitForLine("security.log", "security_probe_event");
    expect(JSON.parse(line)).toMatchObject({ level: "warn", category: "security" });
  });

  it("writes `category` exactly once, so a reader sees the logger's category", async () => {
    const { securityLogger, setCategoryFileEnabled } = await import("../utils/logger");
    setCategoryFileEnabled("security", true);
    securityLogger.warn({ operation: "category_once_probe" });

    const line = await waitForLine("app.log", "category_once_probe");
    expect(line.match(/"category":/g)).toHaveLength(1);
    expect(JSON.parse(line).category).toBe("security");
    expect(line).not.toMatch(/"hostname"|"pid"/);
  });

  it("the admin's category filter finds the line", async () => {
    const { securityLogger, setCategoryFileEnabled } = await import("../utils/logger");
    setCategoryFileEnabled("security", true);
    securityLogger.warn({ operation: "category_filter_probe" });
    await waitForLine("app.log", "category_filter_probe");

    const { readLogFile } = await import("../services/logManager");
    const page = await readLogFile("app.log", { category: "security" });
    expect(page.entries.map((e) => e.operation)).toContain("category_filter_probe");
  });

  it("a switched-off category file stops receiving lines", async () => {
    const { httpLogger, setCategoryFileEnabled } = await import("../utils/logger");
    setCategoryFileEnabled("http", true);
    httpLogger.info({ operation: "http_while_on" });
    await waitForLine("http.log", "http_while_on");

    setCategoryFileEnabled("http", false);
    httpLogger.info({ operation: "http_while_off" });
    await waitForLine("app.log", "http_while_off");
    expect(fs.readFileSync(path.join(logDir, "http.log"), "utf8")).not.toContain("http_while_off");
  });

  it("one physical stream per file, shared by every logger that writes it", async () => {
    const logger = (await import("../utils/logger")).default;
    const { securityLogger, dbLogger } = await import("../utils/logger");
    const { getFileStream } = await import("../utils/logging/fileStreams");
    logger.info({ operation: "shared_root" });
    securityLogger.warn({ operation: "shared_security" });
    dbLogger.warn({ operation: "shared_db" });

    expect(getFileStream("app")).toBe(getFileStream("app"));
    await waitForLine("app.log", "shared_root");
    await waitForLine("app.log", "shared_security");
    await waitForLine("app.log", "shared_db");
  });
});
