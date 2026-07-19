/**
 * Diagnostic Export Service
 *
 * Produces a PII-scrubbed JSON bundle that a user can attach to a GitHub issue.
 * Bundle contains: recent app.log and error.log entries, system info, and the
 * user's own settings sketch (no passwords, tokens or personally identifying
 * data). The same user may export a bundle repeatedly (rate-limited on the
 * route), but the generated content is deterministic given the current log
 * tail — there is no persistence.
 */

import { getLogStats, listLogFiles, readLogWindow, LogEntry } from './logManager';
import logger from '../utils/logger';
import { prisma } from '../db';
import { appVersion, buildVersion } from '../utils/version';

/**
 * Fields that may contain PII or credentials. If a log entry has any of these
 * as keys (at any nesting depth) they are stripped entirely.
 */
const SENSITIVE_KEYS = new Set([
  'ip',
  'ipAddress',
  'userAgent',
  'email',
  'notificationEmail',
  'password',
  'passwordHash',
  'token',
  'auth_token',
  'authorization',
  'cookie',
  'cookies',
  'resetToken',
  'changeToken',
  'apiKey',
  'api_key',
  'openaiApiKey',
  'claudeApiKey',
  'globalOpenaiApiKey',
  'globalClaudeApiKey',
  'airlabsApiKey',
  'aviationstackApiKey',
  'aerodataboxApiKey',
  'globalAirlabsApiKey',
  'globalAviationstackApiKey',
  'globalAerodataboxApiKey',
  'clientSecret',
  'accessToken',
  'refreshToken',
]);

/**
 * String patterns that should be redacted when they appear anywhere in values.
 * We do this defensively because logs sometimes contain tokens concatenated
 * into URLs or error messages.
 */
const STRING_REDACTION_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // JWT-like tokens (three base64 segments separated by dots)
  { regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '<redacted:jwt>' },
  // Email addresses
  { regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '<redacted:email>' },
  // IPv4 addresses (both raw and ipv6-mapped prefixes)
  { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '<redacted:ip>' },
  // UUID-looking values (user IDs, flight IDs, …) — keep last 4 chars for correlation
  {
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
    replacement: '<redacted:uuid>',
  },
];

/**
 * Recursively scrub sensitive keys and redact suspicious strings.
 */
function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    let s = value;
    for (const { regex, replacement } of STRING_REDACTION_PATTERNS) {
      s = s.replace(regex, replacement);
    }
    return s;
  }

  if (Array.isArray(value)) {
    return value.map(scrub);
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      // userId gets hashed to a short opaque marker so cross-line correlation
      // is still possible inside a single bundle, but the real id never leaves.
      if (k === 'userId' && typeof v === 'string') {
        out[k] = `<user:${hashPrefix(v)}>`;
        continue;
      }
      out[k] = scrub(v);
    }
    return out;
  }

  return value;
}

function hashPrefix(s: string): string {
  // Non-cryptographic djb2 — just enough to distinguish different users within
  // a single bundle without leaking the real id. Users are anonymous to the
  // issue reader.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h).toString(16).slice(0, 6);
}

export interface SettingsSection {
  autoUpdate: {
    enabled: boolean;
    requireApproval: boolean;
    checkInterval: number;
    onlyDuringFlight: boolean;
    expiryHours: number;
  };
  historicalEnrichment: {
    enabled: boolean;
    minConfidence: number;
    maxPerDay: number;
  };
}

/**
 * Read the caller's settings row and project ONLY the allowlisted, non-PII
 * fields. Returning a hand-written shape (not the raw Prisma object) is the
 * defence against future schema additions accidentally leaking credentials.
 */
export async function collectSettings(userId: string): Promise<SettingsSection> {
  const row = await prisma.userSettings.findUnique({ where: { userId } });

  return {
    autoUpdate: {
      enabled: row?.autoUpdateEnabled ?? false,
      requireApproval: row?.autoUpdateRequireApproval ?? true,
      checkInterval: row?.autoUpdateCheckInterval ?? 15,
      onlyDuringFlight: row?.autoUpdateOnlyDuringFlight ?? true,
      expiryHours: row?.autoUpdateExpiryHours ?? 24,
    },
    historicalEnrichment: {
      enabled: row?.historicalEnrichmentEnabled ?? false,
      minConfidence: row?.historicalEnrichmentMinConfidence ?? 60,
      maxPerDay: row?.historicalEnrichmentMaxPerDay ?? 50,
    },
  };
}

export interface FlightStateSection {
  byStatus: {
    scheduled: number;
    flown: number;
    cancelled: number;
    historical: number;
    duplicated: number;
  };
  pipeline: {
    withNextApiCheck: number;
    withPendingUpdates: number;
    withLiveTracking: number;
    withActualTimes: number;
    zombieCandidates: number;
  };
}

/**
 * Aggregate the caller's flight collection into the shape the diagnostic
 * bundle needs. No IDs, no route data — only counts. Parallel queries keep
 * this under a single DB round trip-worth of latency.
 *
 * zombieCandidates uses the same OR-logic as the stale-flight branch of the
 * hourly status sweep (services/statusSweep.ts) so the bundle surfaces
 * exactly what the sweep is about to flip.
 */
export async function collectFlightState(userId: string): Promise<FlightStateSection> {
  const arrivalCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const departureCutoff = new Date(Date.now() - 30 * 60 * 60 * 1000);

  const [
    grouped,
    withNextApiCheck,
    withLiveTracking,
    withActualTimes,
    zombieCandidates,
    withPendingUpdates,
  ] = await Promise.all([
    prisma.flight.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.flight.count({ where: { userId, nextApiCheckAt: { not: null } } }),
    prisma.flight.count({ where: { userId, hasLiveTracking: true } }),
    prisma.flight.count({
      where: {
        userId,
        OR: [
          { actualDeparture: { not: null } },
          { actualArrival: { not: null } },
        ],
      },
    }),
    prisma.flight.count({
      where: {
        userId,
        status: "scheduled",
        OR: [
          { arrivalTime: { not: null, lt: arrivalCutoff } },
          { departureTime: { not: null, lt: departureCutoff } },
        ],
      },
    }),
    prisma.pendingFlightUpdate.count({ where: { userId, status: "pending" } }),
  ]);

  const byStatus: FlightStateSection["byStatus"] = {
    scheduled: 0,
    flown: 0,
    cancelled: 0,
    historical: 0,
    duplicated: 0,
  };
  for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
    if (row.status in byStatus) {
      (byStatus as Record<string, number>)[row.status] = row._count._all;
    }
  }

  return {
    byStatus,
    pipeline: {
      withNextApiCheck,
      withPendingUpdates,
      withLiveTracking,
      withActualTimes,
      zombieCandidates,
    },
  };
}

type SectionError = { error: string };

export interface DiagnosticBundle {
  generatedAt: string;
  version: string;
  buildVersion: string;
  platform: {
    nodeVersion: string;
    os: NodeJS.Platform;
    uptimeSeconds: number;
  };
  settings: SettingsSection | SectionError;
  flightState: FlightStateSection | SectionError;
  logs: {
    stats: Awaited<ReturnType<typeof getLogStats>>;
    files: Array<{ name: string; sizeBytes: number; lastModified: string }>;
    appTail: LogEntry[];
    errorTail: LogEntry[];
  };
  notes: string;
}

const APP_WINDOW_MS = 24 * 60 * 60 * 1000;        // 24h
const ERROR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;  // 7d

async function safeCollect<T>(
  section: string,
  fn: () => Promise<T>,
): Promise<T | SectionError> {
  try {
    return await fn();
  } catch (error: unknown) {
    logger.warn({
      operation: 'diagnostic_export_section_failed',
      context: { section },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return { error: `failed to collect ${section}` };
  }
}

function isSectionError(value: unknown): value is SectionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

/**
 * Build a diagnostic bundle for one user. Each collect* step is isolated so
 * a failure in one section (e.g. DB hiccup) doesn't tank the whole bundle.
 */
export async function buildDiagnosticBundle(userId: string): Promise<DiagnosticBundle> {
  const [stats, files, settings, flightState, appTail, errorTail] = await Promise.all([
    safeCollect('stats', () => getLogStats()),
    safeCollect('files', () => listLogFiles()),
    safeCollect('settings', () => collectSettings(userId)),
    safeCollect('flightState', () => collectFlightState(userId)),
    safeCollect('appTail', () => readLogWindow('app', APP_WINDOW_MS)),
    safeCollect('errorTail', () => readLogWindow('error', ERROR_WINDOW_MS)),
  ]);

  const scrubbedAppTail = Array.isArray(appTail)
    ? appTail.map(e => scrub(e) as LogEntry)
    : [];
  const scrubbedErrorTail = Array.isArray(errorTail)
    ? errorTail.map(e => scrub(e) as LogEntry)
    : [];

  const filesList = Array.isArray(files)
    ? files.map(f => ({
        name: f.filename,
        sizeBytes: f.size,
        lastModified: f.modified.toISOString(),
      }))
    : [];

  const statsObj = isSectionError(stats)
    ? { totalSize: 0, totalSizeFormatted: '0 B', fileCount: 0, categoryBreakdown: {} }
    : stats;

  return {
    generatedAt: new Date().toISOString(),
    version: appVersion,
    buildVersion,
    platform: {
      nodeVersion: process.version,
      os: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
    },
    settings: isSectionError(settings) ? settings : (scrub(settings) as SettingsSection),
    flightState: isSectionError(flightState)
      ? flightState
      : (scrub(flightState) as FlightStateSection),
    logs: {
      stats: statsObj as Awaited<ReturnType<typeof getLogStats>>,
      files: filesList,
      appTail: scrubbedAppTail,
      errorTail: scrubbedErrorTail,
    },
    notes:
      'This bundle was scrubbed client-side by TravStats before export. IP addresses, ' +
      'email addresses, JWT tokens and UUIDs have been replaced with placeholders. ' +
      'User IDs are hashed to short opaque markers so distinct users remain ' +
      'distinguishable within the bundle without being identifiable.',
  };
}

export const __test = { scrub, hashPrefix };
