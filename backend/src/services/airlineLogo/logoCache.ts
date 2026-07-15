import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";

export type CachedLogo = { body: Buffer; contentType: string };

const KEY_PATTERN = /^[A-Z0-9][A-Za-z0-9-]{1,30}$/;

export function logoCacheDir(): string {
  // Same dual-path convention as utils/jwtSecret.ts: the prod image mounts
  // a single volume at /app/data; dev uses a repo-local dot-directory.
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/airline-logos"
    : path.join(process.cwd(), ".travstats-data", "cache", "airline-logos");
}

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`invalid logo cache key: ${key}`);
}

export type LogoSource = "logostream" | "vendored" | "kiwi" | "daisycon";

export interface CachedLogoEntry extends CachedLogo {
  /** Epoch ms of the last SUCCESSFUL fetch. null on pre-2.5.0 entries. */
  fetchedAt: number | null;
  /** Epoch ms of the last attempt, success or failure. Drives the retry backoff. */
  lastAttemptAt: number | null;
  source: LogoSource | null;
}

interface LogoMeta {
  contentType: string;
  fetchedAt?: number;
  lastAttemptAt?: number;
  source?: LogoSource;
}

function parseMeta(raw: string): LogoMeta | null {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  if (typeof meta.contentType !== "string") return null;
  return {
    contentType: meta.contentType,
    fetchedAt: typeof meta.fetchedAt === "number" ? meta.fetchedAt : undefined,
    lastAttemptAt: typeof meta.lastAttemptAt === "number" ? meta.lastAttemptAt : undefined,
    source: typeof meta.source === "string" ? (meta.source as LogoSource) : undefined,
  };
}

export async function getCachedLogoEntry(key: string): Promise<CachedLogoEntry | null> {
  assertSafeKey(key);
  try {
    const dir = logoCacheDir();
    const meta = parseMeta(await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8"));
    if (!meta) return null;
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return {
      body,
      contentType: meta.contentType,
      fetchedAt: meta.fetchedAt ?? null,
      lastAttemptAt: meta.lastAttemptAt ?? null,
      source: meta.source ?? null,
    };
  } catch {
    return null; // cold miss or corrupt entry — treated identically
  }
}

export async function putCachedLogo(
  key: string,
  logo: CachedLogo,
  source: LogoSource
): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now();
  await fs.writeFile(path.join(dir, `${key}.img`), logo.body);
  const meta: LogoMeta = {
    contentType: logo.contentType,
    fetchedAt: now,
    lastAttemptAt: now,
    source,
  };
  await fs.writeFile(path.join(dir, `${key}.meta.json`), JSON.stringify(meta));
  logger.debug({ operation: "logo_cache_put", key, source }, "cached airline logo");
}

/**
 * Record that a refresh was attempted and failed.
 *
 * Writes `lastAttemptAt` and NOTHING else. Bumping `fetchedAt` here would make
 * the stale entry look fresh, the nightly sweep would skip it, and a logo that
 * failed to refresh once would never be retried again. Staleness is measured
 * from the last success; the retry backoff from the last attempt.
 */
export async function touchFailedRefresh(key: string): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  const file = path.join(dir, `${key}.meta.json`);
  try {
    const meta = parseMeta(await fs.readFile(file, "utf-8"));
    if (!meta) return;
    await fs.writeFile(file, JSON.stringify({ ...meta, lastAttemptAt: Date.now() }));
  } catch {
    // No entry to touch — nothing to record.
  }
}

export async function listCachedLogoKeys(): Promise<string[]> {
  try {
    const files = await fs.readdir(logoCacheDir());
    return files
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => f.slice(0, -".meta.json".length));
  } catch {
    return []; // no cache dir yet
  }
}

/** A legacy entry (no fetchedAt) is infinitely stale — it refreshes on first touch. */
export function isStale(entry: CachedLogoEntry, maxAgeMs: number): boolean {
  if (entry.fetchedAt === null) return true;
  return Date.now() - entry.fetchedAt > maxAgeMs;
}
