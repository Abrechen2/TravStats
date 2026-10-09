/**
 * Copies a template repository's v2 catalogue into the bundled snapshot
 * (`snapshot/`), refusing to write anything the app would not activate.
 *
 * The CLI is `backend/scripts/sync-template-snapshot.ts`; the logic lives here
 * so it is tested. The files are copied byte for byte — the snapshot is the
 * repository's data, not a re-serialisation of it — and the snapshot directory
 * ends up holding exactly what the index names: a file the index dropped is
 * deleted, so a withdrawn template cannot linger in a release.
 */
import fs from "fs";
import path from "path";
import {
  TEMPLATE_DOMAINS,
  templateIndexEntrySchema,
  templateIndexSchema,
  validateEnvelope,
  type TemplateIndexEntry,
} from "./envelope";
import { defaultRunners, runTestCases } from "./runners";
import { compareVersions } from "./version";

export interface SnapshotSyncReport {
  copied: string[];
  removed: string[];
  failures: string[];
}

function listJson(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return listJson(full, base);
    return d.name.endsWith(".json") ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });
}

/** Every reason one index entry may not go into the snapshot; empty when it may. */
function checkEntry(fromDir: string, entry: TemplateIndexEntry): string[] {
  const file = path.join(fromDir, entry.path);
  if (!fs.existsSync(file)) return [`${entry.id}: ${entry.path} does not exist`];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  } catch (err) {
    return [`${entry.id}: ${entry.path} is not JSON (${String(err)})`];
  }
  const validation = validateEnvelope(raw);
  if (!validation.ok) return validation.errors.map((e) => `${entry.id}: ${e}`);
  const { template } = validation;
  if (template.id !== entry.id || template.domain !== entry.domain) {
    return [`${entry.id}: the file says ${template.id} (${template.domain})`];
  }
  if (compareVersions(template.version, entry.version) !== 0) {
    return [`${entry.id}: index says ${entry.version}, file says ${template.version}`];
  }
  const run = runTestCases(template, defaultRunners);
  if (run.kind === "no_runner") return [`${entry.id}: no runner for ${template.domain}`];
  if (run.kind === "failed") return run.failures.map((f) => `${entry.id}: ${f}`);
  return [];
}

export interface RepositoryValidation {
  /** Every well-formed index entry, in index order. */
  entries: TemplateIndexEntry[];
  failures: string[];
  /** `.json` files under a domain folder that the index does not name. */
  unindexed: string[];
}

/**
 * Everything the app would refuse in a template repository clone: a malformed
 * or duplicate index entry, a file that is missing, not JSON, invalid, out of
 * step with its index line, or whose own test cases fail. The template
 * repository's CI runs this through `backend/scripts/validate-template-repo.ts`.
 */
export function validateRepository(fromDir: string): RepositoryValidation {
  const indexFile = path.join(fromDir, "index.json");
  let rawIndex: unknown;
  try {
    rawIndex = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as unknown;
  } catch (err) {
    return { entries: [], unindexed: [], failures: [`${indexFile} unreadable (${String(err)})`] };
  }
  const index = templateIndexSchema.safeParse(rawIndex);
  if (!index.success) {
    return { entries: [], unindexed: [], failures: [`${indexFile} is not a version-2 index`] };
  }
  const entries: TemplateIndexEntry[] = [];
  const failures: string[] = [];
  index.data.templates.forEach((raw, i) => {
    const parsed = templateIndexEntrySchema.safeParse(raw);
    if (!parsed.success) failures.push(`index[${i}]: malformed entry`);
    else entries.push(parsed.data);
  });
  const ids = entries.map((e) => e.id);
  for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) failures.push(`${id}: duplicate`);
  for (const entry of entries) failures.push(...checkEntry(fromDir, entry));
  const named = new Set(entries.map((e) => e.path));
  const unindexed = TEMPLATE_DOMAINS.flatMap((domain) =>
    listJson(path.join(fromDir, domain)).map((rel) => `${domain}/${rel}`)
  ).filter((rel) => !named.has(rel));
  return { entries, failures, unindexed };
}

/**
 * Validate every template the repository index names; when ALL pass, replace
 * the snapshot with them. Any failure leaves the snapshot untouched.
 */
export function syncSnapshot(fromDir: string, toDir: string): SnapshotSyncReport {
  const indexFile = path.join(fromDir, "index.json");
  const { entries, failures } = validateRepository(fromDir);
  if (failures.length > 0) return { copied: [], removed: [], failures };

  const keep = new Set(["index.json", ...entries.map((e) => e.path)]);
  const removed = listJson(toDir).filter((rel) => !keep.has(rel));
  for (const rel of removed) fs.rmSync(path.join(toDir, rel));
  for (const entry of entries) {
    const target = path.join(toDir, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(fromDir, entry.path), target);
  }
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(indexFile, path.join(toDir, "index.json"));
  return { copied: entries.map((e) => e.path), removed, failures: [] };
}
