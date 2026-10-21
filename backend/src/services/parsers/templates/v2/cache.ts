/**
 * The v2 disk cache: one file per template id, so a restart without network
 * still has every template that passed its tests last time. Cached templates
 * are re-validated and re-tested on load — the app may have been upgraded or
 * downgraded since they were written.
 *
 * Each file also records the repository it was fetched from: the loader
 * skips re-fetching a template only when the active copy came from the
 * repository it is syncing now. Without it, a switch to another repository
 * that publishes the same id at the same version kept the old repository's
 * rules — across restarts too. A file written before this record existed
 * reads as "repository unknown", which the next sync re-fetches.
 */
import fs from "fs";
import path from "path";
import logger from "../../../../utils/logger";
import type { TemplateEnvelope } from "./envelope";

export interface CachedTemplate {
  /** The template, parsed but NOT validated. */
  readonly raw: unknown;
  /** The repository base URL it was fetched from; null when not recorded. */
  readonly repository: string | null;
}

export interface TemplateCache {
  list(): CachedTemplate[];
  write(template: TemplateEnvelope, repository: string): void;
  remove(id: string): void;
}

/** The file format: the template, wrapped with where it came from. */
interface CacheFile {
  readonly repository: string;
  readonly template: unknown;
}

function fromFile(parsed: unknown): CachedTemplate {
  const rec =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  if (rec && typeof rec.repository === "string" && "template" in rec) {
    return { raw: rec.template, repository: rec.repository };
  }
  // A bare template: a file from before the repository was recorded.
  return { raw: parsed, repository: null };
}

/**
 * `lodging:accor` → `lodging__accor.json`. Injective because a domain never
 * contains `__` and a slug never contains `:`.
 */
function fileNameFor(id: string): string {
  return `${id.replace(":", "__")}.json`;
}

export function createFsTemplateCache(dir: string): TemplateCache {
  return {
    list(): CachedTemplate[] {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((file) => {
          try {
            return [fromFile(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")))];
          } catch (err) {
            logger.warn({ file, err }, "Skipped unreadable v2 template cache file");
            return [];
          }
        });
    },
    write(template: TemplateEnvelope, repository: string): void {
      fs.mkdirSync(dir, { recursive: true });
      const file: CacheFile = { repository, template };
      fs.writeFileSync(path.join(dir, fileNameFor(template.id)), JSON.stringify(file));
    },
    remove(id: string): void {
      fs.rmSync(path.join(dir, fileNameFor(id)), { force: true });
    },
  };
}

/**
 * For tests and for callers that must not touch the disk. `repository` is
 * where the `initial` templates count as fetched from (null: not recorded).
 */
export function createMemoryTemplateCache(
  initial: unknown[] = [],
  repository: string | null = null
): TemplateCache & {
  readonly entries: ReadonlyMap<string, CachedTemplate>;
} {
  const entries = new Map<string, CachedTemplate>(
    initial.map((raw, i) => {
      const id =
        typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : `raw-${i}`;
      return [id, { raw, repository }];
    })
  );
  return {
    entries,
    list: () => Array.from(entries.values()),
    write: (template, from) => {
      entries.set(template.id, { raw: template, repository: from });
    },
    remove: (id) => {
      entries.delete(id);
    },
  };
}
