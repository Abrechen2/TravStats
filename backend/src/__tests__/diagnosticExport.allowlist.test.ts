import fs from "fs";
import os from "os";
import path from "path";

/**
 * Audit 2026-09-26, finding 7 (HIGH). The diagnostic export goes into a
 * PUBLIC GitHub issue, and a real one carried the hostname and pid, Windows
 * paths, query strings with names and PNRs, a mistyped login username and a
 * new account's name. Owner decision: an allowlist and a preview.
 *
 * The fixture below is those leaks, written the way the logger wrote them.
 * The assertion is on the serialised bundle — exactly what gets downloaded.
 */

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-diag-"));
process.env.TRAVSTATS_LOG_DIR = logDir;

const FAKE_NAME = "Erika Mustermann";
const FAKE_PNR = "QX7Z9K";
const FAKE_USER_TYPO = "erika.mustermannn";
const FAKE_HOST = "Hyper-Gaming-PC";
const SECRET_URL = "http://ollama.private.example:11434";
const INSTANCE_NAME = "Familie Mustermann Reisen";

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const leakyLines = [
  {
    level: "warn",
    time: iso(60_000),
    pid: 4242,
    hostname: FAKE_HOST,
    category: "general",
    operation: "error_handler",
    message: `Invalid credentials for ${FAKE_USER_TYPO}`,
    context: {
      url: `/api/v1/flights?search=${encodeURIComponent(FAKE_NAME)}&pnr=${FAKE_PNR}`,
      query: { search: FAKE_NAME, pnr: FAKE_PNR },
      username: FAKE_USER_TYPO,
    },
    error: {
      name: "AppError",
      code: "INVALID_CREDENTIALS",
      message: `user ${FAKE_USER_TYPO} not found`,
      stack:
        `AppError: user ${FAKE_USER_TYPO} not found\n` +
        `    at login (C:\\Users\\${FAKE_NAME}\\TravStats\\backend\\src\\routes\\auth.ts:236:13)\n` +
        "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    },
  },
  {
    level: "info",
    timestamp: iso(30_000),
    category: "general",
    operation: "admin_user_create",
    message: `Admin created user ${FAKE_NAME}`,
    context: { targetUsername: FAKE_NAME, bookingReference: FAKE_PNR },
  },
  {
    level: "info",
    timestamp: iso(20_000),
    operation: "check_flights_due",
    message: `Found flight LH400 FRA-JFK for ${FAKE_NAME}`,
    flights: [{ fn: "LH400", dep: "FRA", arr: "JFK", depTime: iso(-86_400_000) }],
  },
  // A message that is prose must not become the event key.
  { level: "info", timestamp: iso(10_000), message: FAKE_USER_TYPO },
];

let prisma: typeof import("../db").prisma;
let saved: { id: number; ollamaUrl: string | null; instanceName: string | null } | null;

beforeAll(async () => {
  const lines = leakyLines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(path.join(logDir, "app.log"), lines);
  fs.writeFileSync(path.join(logDir, "error.log"), JSON.stringify(leakyLines[0]) + "\n");

  prisma = (await import("../db")).prisma;
  const { ensureAdminSettingsRow } = await import("../services/adminSettingsRow");
  const id = await ensureAdminSettingsRow();
  saved = await prisma.adminSettings.findUnique({
    where: { id },
    select: { id: true, ollamaUrl: true, instanceName: true },
  });
  await prisma.adminSettings.update({
    where: { id },
    data: { ollamaUrl: SECRET_URL, instanceName: INSTANCE_NAME },
  });
});

afterAll(async () => {
  if (saved) {
    await prisma.adminSettings.update({
      where: { id: saved.id },
      data: { ollamaUrl: saved.ollamaUrl, instanceName: saved.instanceName },
    });
  }
  const { closeAllFileStreams } = await import("../utils/logging/fileStreams");
  await closeAllFileStreams();
  delete process.env.TRAVSTATS_LOG_DIR;
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe("the diagnostic export is an allowlist", () => {
  it("carries none of the personal data the logs hold", async () => {
    const { buildDiagnosticBundle } = await import("../services/diagnosticExport");
    const downloaded = JSON.stringify(await buildDiagnosticBundle(), null, 2);

    for (const leak of [
      FAKE_NAME,
      "Mustermann",
      FAKE_PNR,
      FAKE_USER_TYPO,
      FAKE_HOST,
      "hostname",
      '"pid"',
      "?search",
      "C:\\\\Users",
      "LH400",
      "JFK",
      SECRET_URL,
      "ollama.private",
      INSTANCE_NAME,
    ]) {
      expect(downloaded).not.toContain(leak);
    }
  });

  it("keeps what helps: event key, error code and class, file:line frames", async () => {
    const { buildDiagnosticBundle } = await import("../services/diagnosticExport");
    const bundle = await buildDiagnosticBundle();

    expect(bundle.logs.status).toBe("ok");
    if (bundle.logs.status !== "ok") return;
    expect(bundle.logs.data.errors[0]).toEqual({
      time: new Date(Date.parse(leakyLines[0].time as string)).toISOString(),
      level: "warn",
      category: "general",
      event: "error_handler",
      errorCode: "INVALID_CREDENTIALS",
      errorName: "AppError",
      stack: ["auth.ts:236"],
    });
    // The fixture's four lines come first; the live logger may append more.
    expect(bundle.logs.data.recent.slice(0, 4).map((e) => e.event)).toEqual([
      "error_handler",
      "admin_user_create",
      "check_flights_due",
      null,
    ]);
    expect(bundle.settings).toMatchObject({ status: "ok", data: { ollamaConfigured: true } });
    expect(bundle.database).toMatchObject({ status: "ok" });
    expect(bundle.runtime).toEqual({
      node: process.version,
      os: process.platform,
      arch: process.arch,
      uptimeSeconds: expect.any(Number),
    });
  });

  it("lists a section that failed as failed, with its code — not as empty", async () => {
    const spy = jest
      .spyOn(prisma.adminSettings, "findFirst")
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P1001" }));
    try {
      const { buildDiagnosticBundle } = await import("../services/diagnosticExport");
      const bundle = await buildDiagnosticBundle();
      expect(bundle.settings).toEqual({ status: "failed", errorCode: "P1001" });
      expect(bundle.logs.status).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  it("the strict schema refuses a key that is not on the list", async () => {
    const { diagnosticBundleSchema } = await import("../services/diagnostics/bundleSchema");
    const { buildDiagnosticBundle } = await import("../services/diagnosticExport");
    const bundle = await buildDiagnosticBundle();

    expect(diagnosticBundleSchema.safeParse(bundle).success).toBe(true);
    expect(
      diagnosticBundleSchema.safeParse({ ...bundle, runtime: { ...bundle.runtime, hostname: "x" } })
        .success
    ).toBe(false);
  });
});
