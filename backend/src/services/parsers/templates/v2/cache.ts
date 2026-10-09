/**
 * The v2 disk cache: one file per template id, so a restart without network
 * still has every template that passed its tests last time. Cached templates
 * are re-validated and re-tested on load — the app may have been upgraded or
 * downgraded since they were written.
 */
import fs from "fs";
import path from "path";
import logger from "../../../../utils/logger";
import type { TemplateEnvelope } from "./envelope";

export interface TemplateCache {
  /** Every cached template, parsed but NOT validated. */
  list(): unknown[];
  write(template: TemplateEnvelope): void;
  remove(id: string): void;
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
    list(): unknown[] {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((file) => {
          try {
            return [JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as unknown];
          } catch (err) {
            logger.warn({ file, err }, "Skipped unreadable v2 template cache file");
            return [];
          }
        });
    },
    write(template: TemplateEnvelope): void {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileNameFor(template.id)), JSON.stringify(template));
    },
    remove(id: string): void {
      fs.rmSync(path.join(dir, fileNameFor(id)), { force: true });
    },
  };
}

/** For tests and for callers that must not touch the disk. */
export function createMemoryTemplateCache(initial: unknown[] = []): TemplateCache & {
  readonly entries: ReadonlyMap<string, unknown>;
} {
  const entries = new Map<string, unknown>(
    initial.map((raw, i) => {
      const id =
        typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : `raw-${i}`;
      return [id, raw];
    })
  );
  return {
    entries,
    list: () => Array.from(entries.values()),
    write: (template) => {
      entries.set(template.id, template);
    },
    remove: (id) => {
      entries.delete(id);
    },
  };
}
