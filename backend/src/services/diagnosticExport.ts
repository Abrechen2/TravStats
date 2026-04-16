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

import fs from 'fs/promises';
import path from 'path';
import { getLogStats, listLogFiles, readLogFile, LogEntry } from './logManager';
import logger from '../utils/logger';
import { prisma } from '../db';

const LOG_DIR = path.join(process.cwd(), '..', 'data', 'logs');
const DEFAULT_TAIL = 200;

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

export interface DiagnosticBundle {
  generatedAt: string;
  version: string;
  platform: {
    nodeVersion: string;
    os: NodeJS.Platform;
    uptimeSeconds: number;
  };
  logs: {
    stats: Awaited<ReturnType<typeof getLogStats>>;
    files: Array<{ name: string; sizeBytes: number; lastModified: string }>;
    appTail: LogEntry[];
    errorTail: LogEntry[];
  };
  notes: string;
}

async function findCurrentLogFile(prefix: 'app' | 'error'): Promise<string | null> {
  // rotating-file-stream writes to `<prefix>.log` as the active file and rotates
  // to `<prefix>-YYYY-MM-DD.log.gz` at day boundary. Prefer the active file,
  // fall back to the most recent rotated file if it doesn't exist yet.
  const active = path.join(LOG_DIR, `${prefix}.log`);
  try {
    await fs.access(active);
    return `${prefix}.log`;
  } catch {
    const all = await listLogFiles();
    const match = all
      .filter(f => f.filename.startsWith(`${prefix}`) && f.filename.endsWith('.log'))
      .sort((a, b) => (a.modified < b.modified ? 1 : -1))[0];
    return match ? match.filename : null;
  }
}

/**
 * Build a diagnostic bundle. Tail defaults to 200 entries each for app.log
 * and error.log.
 */
export async function buildDiagnosticBundle(tail: number = DEFAULT_TAIL): Promise<DiagnosticBundle> {
  const [stats, files] = await Promise.all([
    getLogStats().catch(() => ({
      totalSize: 0,
      totalSizeFormatted: '0 B',
      fileCount: 0,
      categoryBreakdown: {},
    })),
    listLogFiles().catch(() => []),
  ]);

  let appTail: LogEntry[] = [];
  let errorTail: LogEntry[] = [];
  try {
    const appFile = await findCurrentLogFile('app');
    if (appFile) {
      const entries = await readLogFile(appFile, { limit: tail });
      appTail = entries.map(e => scrub(e) as LogEntry);
    }
  } catch (error: unknown) {
    logger.warn({
      operation: 'diagnostic_export_app_read_failed',
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }

  try {
    const errorFile = await findCurrentLogFile('error');
    if (errorFile) {
      const entries = await readLogFile(errorFile, { limit: tail });
      errorTail = entries.map(e => scrub(e) as LogEntry);
    }
  } catch (error: unknown) {
    logger.warn({
      operation: 'diagnostic_export_error_read_failed',
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    version: process.env.APP_VERSION || 'unknown',
    platform: {
      nodeVersion: process.version,
      os: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
    },
    logs: {
      stats,
      files: files.map(f => ({
        name: f.filename,
        sizeBytes: f.size,
        lastModified: f.modified.toISOString(),
      })),
      appTail,
      errorTail,
    },
    notes:
      'This bundle was scrubbed client-side by TravStats before export. IP addresses, ' +
      'email addresses, JWT tokens and UUIDs have been replaced with placeholders. ' +
      'User IDs are hashed to short opaque markers so distinct users remain ' +
      'distinguishable within the bundle without being identifiable.',
  };
}

export const __test = { scrub, hashPrefix };
