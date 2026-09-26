import path from "path";
import { LogFileEntry } from "../shared/logContract";
import { getLogDir } from "../utils/logging/logFiles";
import { entryTime, listLogFiles, openLogLines, parseLogLine } from "./logManager";

/**
 * A time window of one stream's log (`app` or `error`) across the live file
 * and its rotated copies — the source of the diagnostic export's log events.
 *
 * Capped so a flooded log cannot blow up the bundle, and when a cap bites it
 * keeps the NEWEST entries. It used to keep the oldest: it read the live file
 * front to back and stopped at 2 MiB, so on a busy day the bundle held the
 * morning and dropped exactly the lines around the error being reported.
 *
 * It also says what it could not do. A file that failed to read used to be
 * skipped with a warning and the result looked complete; now the count of
 * unreadable files and whether a cap was reached travel with the entries.
 */

export interface ReadWindowOptions {
  maxEntries?: number;
  /** Approximate — UTF-16 code units of the source lines. */
  maxBytes?: number;
}

export interface LogWindow {
  /** Chronological, oldest first. */
  entries: LogFileEntry[];
  unreadableFiles: number;
  truncated: boolean;
}

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

interface WindowLine {
  entry: LogFileEntry;
  size: number;
}

async function readInWindow(filepath: string, cutoffMs: number): Promise<WindowLine[]> {
  const lines: WindowLine[] = [];
  for await (const line of openLogLines(filepath)) {
    const entry = parseLogLine(line);
    if (!entry) continue;
    const time = entryTime(entry);
    if (!Number.isFinite(time) || time < cutoffMs) continue;
    lines.push({ entry, size: line.length });
  }
  return lines;
}

export async function readLogWindow(
  stream: "app" | "error",
  windowMs: number,
  options: ReadWindowOptions = {}
): Promise<LogWindow> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const cutoffMs = Date.now() - windowMs;

  // Newest file first: the live file, then rotated copies by mtime. A rotated
  // file last written before the cutoff holds nothing inside the window.
  const files = (await listLogFiles())
    .filter((file) => file.category === stream)
    .filter((file) => !file.compressed || Date.parse(file.modified) >= cutoffMs)
    .sort((a, b) => {
      if (a.filename === `${stream}.log`) return -1;
      if (b.filename === `${stream}.log`) return 1;
      return Date.parse(b.modified) - Date.parse(a.modified);
    });

  // Collected newest-first, reversed once at the end.
  const newestFirst: LogFileEntry[] = [];
  let bytes = 0;
  let unreadableFiles = 0;
  let truncated = false;

  for (const file of files) {
    let lines: WindowLine[];
    try {
      lines = await readInWindow(path.join(getLogDir(), file.filename), cutoffMs);
    } catch {
      unreadableFiles++;
      continue;
    }
    // Lines are chronological inside a file: walk them from the end.
    for (let i = lines.length - 1; i >= 0; i--) {
      const { entry, size } = lines[i];
      if (newestFirst.length >= maxEntries || bytes + size > maxBytes) {
        truncated = true;
        break;
      }
      newestFirst.push(entry);
      bytes += size;
    }
    if (truncated) break;
  }

  return { entries: newestFirst.reverse(), unreadableFiles, truncated };
}
