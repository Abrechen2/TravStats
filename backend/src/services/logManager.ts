import fs from "fs";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { AppError } from "../middleware/errorHandler";
import {
  LogFileEntry,
  LogFileInfo,
  LogReadResponse,
  LogStatsResponse,
} from "../shared/logContract";
import { getLogDir, isSafeLogFileName, parseLogFileName } from "../utils/logging/logFiles";

/**
 * The admin log area: list, read, delete and summarise the log files.
 *
 * Retention (deleting old files) lives in `logRetention.ts`; the window reader
 * the diagnostic export uses lives in `logWindow.ts`.
 *
 * Every failure a reader can meet is an `AppError` with a stable code —
 * `LOG_FILE_INVALID_NAME` (400), `LOG_FILE_NOT_FOUND` (404),
 * `LOG_FILE_UNREADABLE` (500) — which the admin page maps to its own German
 * and English sentences. It used to be a bare `Error`, i.e. a 500 whose
 * English message the German page printed as it was.
 */

export interface ReadOptions {
  offset?: number;
  limit?: number;
  level?: string;
  category?: string;
  search?: string;
}

const DEFAULT_READ_LIMIT = 100;

/** The absolute path of a log file, after the traversal guard. */
export function resolveLogFile(filename: string): string {
  if (!isSafeLogFileName(filename)) {
    throw new AppError("Invalid log file name", 400, "LOG_FILE_INVALID_NAME");
  }
  const filepath = path.join(getLogDir(), filename);
  if (!fs.existsSync(filepath)) {
    throw new AppError("Log file not found", 404, "LOG_FILE_NOT_FOUND");
  }
  return filepath;
}

/** Plain or gzip — the reader does not care which. */
export function openLogLines(filepath: string): readline.Interface {
  const raw = fs.createReadStream(filepath);
  if (!filepath.endsWith(".gz"))
    return readline.createInterface({ input: raw, crlfDelay: Infinity });
  const gunzip = zlib.createGunzip();
  // `pipe` does not forward errors; the reader must see a failed read, not EOF.
  raw.on("error", (error) => gunzip.destroy(error));
  return readline.createInterface({ input: raw.pipe(gunzip), crlfDelay: Infinity });
}

/** Parse one line; null for blank or malformed lines. */
export function parseLogLine(line: string): LogFileEntry | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LogFileEntry)
      : null;
  } catch {
    return null;
  }
}

/** When a line was written — `timestamp` since 2026-09-26, `time` before. */
export function entryTime(entry: LogFileEntry): number {
  return Date.parse(String(entry.timestamp ?? entry.time ?? ""));
}

export async function listLogFiles(): Promise<LogFileInfo[]> {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) return [];

  const names = (await fs.promises.readdir(dir)).filter((name) => parseLogFileName(name));
  const files = await Promise.all(
    names.map(async (filename): Promise<LogFileInfo | null> => {
      try {
        const stats = await fs.promises.stat(path.join(dir, filename));
        const parsed = parseLogFileName(filename)!;
        return {
          filename,
          category: parsed.stream,
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          compressed: parsed.compressed,
        };
      } catch {
        // Rotated or deleted between readdir and stat — not a file any more.
        return null;
      }
    })
  );
  return files
    .filter((file): file is LogFileInfo => file !== null)
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
}

function matches(entry: LogFileEntry, line: string, options: ReadOptions): boolean {
  if (options.level && entry.level !== options.level) return false;
  if (options.category && entry.category !== options.category) return false;
  if (options.search && !line.toLowerCase().includes(options.search.toLowerCase())) return false;
  return true;
}

/**
 * One page of a file's entries, NEWEST first, with the total that matched.
 *
 * Files are chronological, so the newest page is at the end: every matching
 * line is counted, and only the last `offset + limit` are kept in a ring.
 */
export async function readLogFile(
  filename: string,
  options: ReadOptions = {}
): Promise<LogReadResponse> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? DEFAULT_READ_LIMIT;
  const filepath = resolveLogFile(filename);
  const keep = offset + limit;

  // A fixed-size ring of the newest `keep` matches; slot `total % keep`
  // is overwritten as the file goes on.
  const ring: LogFileEntry[] = new Array(keep);
  let total = 0;
  try {
    for await (const line of openLogLines(filepath)) {
      const entry = parseLogLine(line);
      if (!entry || !matches(entry, line, options)) continue;
      ring[total % keep] = entry;
      total++;
    }
  } catch {
    throw new AppError("Log file could not be read", 500, "LOG_FILE_UNREADABLE");
  }

  const entries: LogFileEntry[] = [];
  for (let i = offset; i < Math.min(offset + limit, total); i++) {
    entries.push(ring[(total - 1 - i) % keep]);
  }
  return { filename, entries, total, offset, limit, hasMore: offset + entries.length < total };
}

export async function deleteLogFile(filename: string): Promise<void> {
  const filepath = resolveLogFile(filename);
  await fs.promises.unlink(filepath);
}

export async function getLogStats(): Promise<LogStatsResponse> {
  const files = await listLogFiles();
  const categoryBreakdown: Record<string, number> = {};
  let totalSize = 0;
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const file of files) {
    totalSize += file.size;
    categoryBreakdown[file.category] = (categoryBreakdown[file.category] ?? 0) + 1;
    if (!oldest || file.modified < oldest) oldest = file.modified;
    if (!newest || file.modified > newest) newest = file.modified;
  }
  return {
    totalSize,
    fileCount: files.length,
    oldestLogAt: oldest,
    newestLogAt: newest,
    categoryBreakdown,
  };
}

/** Search the newest files (plain and compressed) — at most 10 files, 1000 hits. */
export async function searchLogs(query: {
  query?: string;
  level?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<LogFileEntry[]> {
  const files = (await listLogFiles()).filter((file) => {
    const modified = Date.parse(file.modified);
    if (query.startDate && modified < query.startDate.getTime()) return false;
    if (query.endDate && modified > query.endDate.getTime()) return false;
    return true;
  });

  const results: LogFileEntry[] = [];
  for (const file of files.slice(0, 10)) {
    const page = await readLogFile(file.filename, {
      limit: 1000,
      level: query.level,
      category: query.category,
      search: query.query,
    });
    results.push(...page.entries);
    if (results.length >= 1000) break;
  }
  return results.slice(0, 1000);
}

/** Content type for a download: gzip for a rotated file, NDJSON otherwise. */
export function logFileContentType(filename: string): string {
  return filename.endsWith(".gz") ? "application/gzip" : "application/x-ndjson";
}
