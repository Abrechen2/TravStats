/**
 * Diagnostic export — the JSON an admin attaches to a PUBLIC GitHub issue.
 *
 * Owner decision 2026-09-26: an ALLOWLIST plus a preview. The bundle is built
 * only from structured fields that cannot carry personal data, and the modal
 * shows the exact JSON before anything is downloaded.
 *
 * What it carries, and nothing else:
 *  - app and build version; Node version, OS and architecture;
 *  - how many accounts have each domain switched on;
 *  - non-secret admin settings — booleans, numbers, closed enums, and whether
 *    an integration is configured (`services/diagnostics/settingsAllowlist.ts`);
 *  - row counts per table;
 *  - the migration status of the database;
 *  - recent log events reduced to time, level, category, event key, error code
 *    and class, and `file:line` stack frames (`services/diagnostics/logEvent.ts`).
 *
 * The negative-list scrubber this replaces removed IPs, emails, JWTs and UUIDs
 * and still leaked the hostname, pid, Windows paths, query strings with names
 * and PNRs, a mistyped login username and a new account's name.
 *
 * A section that fails says so — `{ status: "failed", errorCode }` — instead
 * of arriving empty, which read as "nothing happened". The finished bundle is
 * parsed through a strict schema, so a field added by mistake is refused.
 */

import { prisma } from "../db";
import logger from "../utils/logger";
import { appVersion, buildVersion } from "../utils/version";
import { AppError } from "../middleware/errorHandler";
import { DOMAIN_KEYS } from "../shared/domains";
import {
  DIAGNOSTIC_BUNDLE_SCHEMA,
  DiagnosticBundle,
  DiagnosticLogsData,
  DiagnosticSection,
} from "../shared/logContract";
import { listLogFiles } from "./logManager";
import { readLogWindow } from "./logWindow";
import { projectAdminSettings, SettingValue } from "./diagnostics/settingsAllowlist";
import { toDiagnosticLogEvents } from "./diagnostics/logEvent";
import { diagnosticBundleSchema } from "./diagnostics/bundleSchema";

const APP_WINDOW_MS = 24 * 60 * 60 * 1000;
const ERROR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Per list. Reduced events are small; the cap keeps the file attachable. */
const MAX_EVENTS = 2000;

/** A stable, value-free code for why a section failed. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof AppError && error.code) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^(?:P\d{4}|E[A-Z]{2,20}|[A-Z][A-Z0-9_]{1,39})$/.test(code)) {
    return code;
  }
  const name = error instanceof Error ? error.name : "";
  return /^[A-Z][A-Za-z0-9]{0,59}$/.test(name) && name !== "Error" ? name : "UNKNOWN";
}

async function section<T>(name: string, collect: () => Promise<T>): Promise<DiagnosticSection<T>> {
  try {
    return { status: "ok", data: await collect() };
  } catch (error) {
    const errorCode = errorCodeOf(error);
    logger.warn({
      operation: "diagnostic_export_section_failed",
      context: { section: name },
      error,
    });
    return { status: "failed", errorCode };
  }
}

async function collectDomains(): Promise<Record<string, number>> {
  const counts = await Promise.all(
    DOMAIN_KEYS.map((domain) =>
      prisma.userSettings.count({ where: { enabledDomains: { has: domain } } })
    )
  );
  return Object.fromEntries(DOMAIN_KEYS.map((domain, i) => [domain, counts[i]]));
}

async function collectSettings(): Promise<Record<string, SettingValue>> {
  const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  return projectAdminSettings(row as unknown as Record<string, unknown> | null);
}

async function collectCounts(): Promise<Record<string, number>> {
  const [flightsByStatus, ...totals] = await Promise.all([
    prisma.flight.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.count(),
    prisma.trip.count(),
    prisma.lodging.count(),
    prisma.cruise.count(),
    prisma.place.count(),
    prisma.tripRoute.count(),
    prisma.railJourney.count(),
    prisma.document.count(),
    prisma.pendingFlightUpdate.count({ where: { status: "pending" } }),
    prisma.backup.count(),
  ]);
  const names = [
    "users",
    "trips",
    "lodgings",
    "cruises",
    "places",
    "tourRoutes",
    "railJourneys",
    "documents",
    "pendingFlightUpdates",
    "backups",
  ];
  const counts: Record<string, number> = Object.fromEntries(names.map((n, i) => [n, totals[i]]));
  for (const row of flightsByStatus as Array<{ status: string; _count: { _all: number } }>) {
    // Status values are a closed set in the schema; anything else is folded.
    const status = /^[a-z_]{1,30}$/.test(row.status) ? row.status : "other";
    counts[`flights_${status}`] = (counts[`flights_${status}`] ?? 0) + row._count._all;
  }
  return counts;
}

async function collectDatabase(): Promise<{
  appliedMigrations: number;
  failedMigrations: number;
  latestMigration: string | null;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ applied: bigint; failed: bigint; latest: string | null }>
  >`SELECT
      COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
      COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed,
      MAX(migration_name) FILTER (WHERE finished_at IS NOT NULL) AS latest
    FROM _prisma_migrations`;
  const row = rows[0];
  return {
    appliedMigrations: Number(row?.applied ?? 0),
    failedMigrations: Number(row?.failed ?? 0),
    latestMigration: row?.latest ?? null,
  };
}

async function collectLogs(): Promise<DiagnosticLogsData> {
  const [files, app, errors] = await Promise.all([
    listLogFiles(),
    readLogWindow("app", APP_WINDOW_MS),
    readLogWindow("error", ERROR_WINDOW_MS),
  ]);
  // Newest kept: the lines around the error being reported.
  const recent = toDiagnosticLogEvents(app.entries).slice(-MAX_EVENTS);
  const errorEvents = toDiagnosticLogEvents(errors.entries).slice(-MAX_EVENTS);
  return {
    files: files.map((file) => ({
      stream: file.category,
      rotated: file.filename !== `${file.category}.log`,
      sizeBytes: file.size,
      modifiedAt: file.modified,
    })),
    recent,
    errors: errorEvents,
    unreadableFiles: app.unreadableFiles + errors.unreadableFiles,
    truncated:
      app.truncated ||
      errors.truncated ||
      app.entries.length > MAX_EVENTS ||
      errors.entries.length > MAX_EVENTS,
  };
}

export async function buildDiagnosticBundle(): Promise<DiagnosticBundle> {
  const [domains, settings, counts, database, logs] = await Promise.all([
    section("domains", collectDomains),
    section("settings", collectSettings),
    section("counts", collectCounts),
    section("database", collectDatabase),
    section("logs", collectLogs),
  ]);

  const bundle: DiagnosticBundle = {
    schema: DIAGNOSTIC_BUNDLE_SCHEMA,
    generatedAt: new Date().toISOString(),
    app: { version: appVersion, buildVersion },
    runtime: {
      node: process.version,
      os: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
    },
    domains,
    settings,
    counts,
    database,
    logs,
  };
  // Any key or shape outside the allowlist is refused, not published. A 500
  // with its own code, not the validation 400 a ZodError would become: the
  // request was fine, the server built something it must not send.
  const checked = diagnosticBundleSchema.safeParse(bundle);
  if (!checked.success) {
    logger.error({
      operation: "diagnostic_export_rejected",
      context: { paths: checked.error.issues.map((issue) => issue.path.join(".")).slice(0, 10) },
    });
    throw new AppError("Diagnostic bundle failed its allowlist", 500, "DIAGNOSTIC_EXPORT_REJECTED");
  }
  return bundle;
}
