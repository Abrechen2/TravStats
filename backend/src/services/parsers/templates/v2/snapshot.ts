/**
 * The bundled template snapshot (plan 2026-10-09 P4a): the template
 * repository's v2 files, copied into the app at build time as DATA, so a
 * fresh or offline instance still reads every issuer the compiled-in readers
 * used to read. It is the lowest-priority source — remote > cache > snapshot —
 * and nothing in it is trusted for being bundled: every file goes through the
 * same validation and test cases as a fetched one.
 *
 * Layout mirrors the repository root: `index.json` (`{ version: 2, templates:
 * [{ id, domain, version, path }] }`) and the files it names. Refreshed by
 * `backend/scripts/sync-template-snapshot.ts` from a local clone.
 */
import fs from "fs";
import path from "path";
import logger from "../../../../utils/logger";
import { templateIndexEntrySchema, templateIndexSchema, type TemplateIndexEntry } from "./envelope";

export const DEFAULT_SNAPSHOT_DIR = path.join(__dirname, "snapshot");

export interface SnapshotEntry {
  /** The index line that named the file; absent when the line itself is malformed. */
  readonly entry?: TemplateIndexEntry;
  /** The parsed file, NOT validated; null when it could not be read. */
  readonly raw: unknown;
  /** For status and logs: the id, or `snapshot[N]`. */
  readonly label: string;
  /** Why the entry could not be read, when it could not. */
  readonly error?: string;
}

export interface TemplateSnapshot {
  list(): SnapshotEntry[];
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
}

/** A snapshot read from a directory. A missing directory is an empty snapshot, not an error. */
export function createDirSnapshot(dir: string = DEFAULT_SNAPSHOT_DIR): TemplateSnapshot {
  return {
    list(): SnapshotEntry[] {
      const indexFile = path.join(dir, "index.json");
      if (!fs.existsSync(indexFile)) return [];
      let entries: unknown[];
      try {
        const index = templateIndexSchema.safeParse(readJson(indexFile));
        if (!index.success) {
          logger.warn({ dir }, "bundled template snapshot index is not a version-2 index");
          return [];
        }
        entries = index.data.templates;
      } catch (err) {
        logger.warn({ dir, err }, "bundled template snapshot index could not be read");
        return [];
      }
      return entries.map((rawEntry, i): SnapshotEntry => {
        const parsed = templateIndexEntrySchema.safeParse(rawEntry);
        if (!parsed.success) {
          return { raw: null, label: `snapshot[${i}]`, error: "malformed index entry" };
        }
        const entry = parsed.data;
        try {
          return { entry, raw: readJson(path.join(dir, entry.path)), label: entry.id };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { entry, raw: null, label: entry.id, error: message };
        }
      });
    },
  };
}

/** For tests: a snapshot from objects in memory. */
export function createMemorySnapshot(entries: SnapshotEntry[]): TemplateSnapshot {
  return { list: () => entries };
}
