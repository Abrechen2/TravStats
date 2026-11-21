import { AppError } from "../../middleware/errorHandler";
import { BACKED_UP_UPLOAD_DIRS } from "../../config/uploadDirs";
import { UPLOAD_DIR_POLICIES } from "../files/uploadDirPolicies";
import {
  ACCOUNT_ENTRY,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  FILE_ENTRY,
  isSafeFileName,
  MANIFEST_ENTRY,
  manifestHeadSchema,
  manifestSchema,
  TABLE_ENTRY,
  type Manifest,
} from "./format";
import type { ArchivePlan } from "./plan";
import { TABLE_POLICY } from "./tablePolicy";
import { invalidArchive, type ArchiveReader } from "./zipReader";

/**
 * The manifest lists one line per entry (~200 bytes); 16 MB holds tens of
 * thousands of files. Anything larger is not a manifest.
 */
export const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

export interface ArchiveContents {
  manifest: Manifest;
  /** Data tables in the archive, with their row counts. */
  dataTables: Map<string, number>;
  catalogueTables: string[];
  files: Array<{ dir: string; name: string; entry: string; sha256: string }>;
}

export function schemaTooNew(message: string): AppError {
  return new AppError(message, 422, "ACCOUNT_ARCHIVE_SCHEMA_TOO_NEW");
}

const FILE_DIRS = new Set<string>(
  BACKED_UP_UPLOAD_DIRS.filter((d) => UPLOAD_DIR_POLICIES[d].account.kind === "rows")
);

/**
 * Reads and checks the manifest against the ZIP's entries: a known format no newer
 * than this server's, every entry listed with its size, nothing unlisted, the total
 * within the ceiling, every table one this server's database has.
 */
export async function readContents(
  reader: ArchiveReader,
  plan: ArchivePlan,
  maxBytes: number
): Promise<ArchiveContents> {
  const raw = await reader.readJson(MANIFEST_ENTRY, MANIFEST_MAX_BYTES);
  const head = manifestHeadSchema.safeParse(raw);
  if (!head.success || head.data.format !== ARCHIVE_FORMAT) {
    throw invalidArchive("Not a TravStats account archive");
  }
  if (head.data.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new AppError(
      `Archive format ${head.data.formatVersion} is newer than this server's ${ARCHIVE_FORMAT_VERSION}`,
      422,
      "ACCOUNT_ARCHIVE_FORMAT_TOO_NEW"
    );
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw invalidArchive("The archive's manifest is malformed");
  const manifest = parsed.data;

  const listed = new Map(manifest.entries.map((e) => [e.name, e]));
  if (listed.size !== manifest.entries.length)
    throw invalidArchive("The manifest lists an entry twice");
  for (const name of reader.entries.keys()) {
    if (name !== MANIFEST_ENTRY && !listed.has(name))
      throw invalidArchive(`Unlisted entry ${name}`);
  }
  let total = 0;
  const contents: ArchiveContents = {
    manifest,
    dataTables: new Map(),
    catalogueTables: [],
    files: [],
  };
  for (const entry of manifest.entries) {
    const zipEntry = reader.entries.get(entry.name);
    if (!zipEntry) throw invalidArchive(`Missing entry ${entry.name}`);
    if (zipEntry.uncompressedSize !== entry.bytes)
      throw invalidArchive(`${entry.name} has the wrong size`);
    total += entry.bytes;
    classifyEntry(entry.name, entry.rows ?? 0, entry.sha256, plan, contents);
  }
  if (total > maxBytes) {
    throw new AppError("The account archive is too large", 413, "ACCOUNT_ARCHIVE_TOO_LARGE");
  }
  return contents;
}

function classifyEntry(
  name: string,
  rows: number,
  sha256: string,
  plan: ArchivePlan,
  contents: ArchiveContents
): void {
  if (name === ACCOUNT_ENTRY) return;
  const table = TABLE_ENTRY.exec(name);
  if (table) {
    const [, section, tableName] = table;
    if (section === "info") return;
    if (!plan.catalog.has(tableName)) schemaFail(tableName);
    if (section === "data") {
      if (!plan.byName.has(tableName)) schemaFail(tableName);
      contents.dataTables.set(tableName, rows);
    } else {
      const policy = TABLE_POLICY[tableName];
      const isCatalogue =
        policy?.kind === "catalogue" ||
        ((policy?.kind === "owner" || policy?.kind === "child") && policy.catalogue !== undefined);
      if (!isCatalogue) schemaFail(tableName);
      contents.catalogueTables.push(tableName);
    }
    return;
  }
  const file = FILE_ENTRY.exec(name);
  if (file && FILE_DIRS.has(file[1]) && isSafeFileName(file[2])) {
    contents.files.push({ dir: file[1], name: file[2], entry: name, sha256 });
    return;
  }
  throw invalidArchive(`Unexpected entry ${name}`);
}

function schemaFail(table: string): never {
  throw schemaTooNew(`The archive names a table this server does not know: ${table}`);
}

/** Every entry's bytes against the sha256 its manifest records. */
export async function verifyChecksums(
  reader: ArchiveReader,
  manifest: Manifest,
  onEntry: () => void = () => {}
): Promise<void> {
  for (const entry of manifest.entries) {
    let digest: { sha256: string; bytes: number };
    try {
      digest = await reader.digest(entry.name);
    } catch {
      throw new AppError(`${entry.name} cannot be read`, 422, "ACCOUNT_ARCHIVE_CHECKSUM");
    }
    if (digest.sha256 !== entry.sha256 || digest.bytes !== entry.bytes) {
      throw new AppError(
        `${entry.name} does not match its checksum`,
        422,
        "ACCOUNT_ARCHIVE_CHECKSUM"
      );
    }
    onEntry();
  }
}
