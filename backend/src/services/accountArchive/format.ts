import os from "os";
import path from "path";
import { z } from "zod";

/**
 * The account archive's file format (forgejo#433): one ZIP per account.
 *
 *   manifest.json             format, versions, archive id, every entry's sha256
 *   account.json              the profile fields that move (never credentials)
 *   data/<table>.jsonl        the account's rows, one JSON object per line, by column name
 *   catalogue/<table>.jsonl   catalogue rows those rows point at by numeric id
 *   info/<table>.jsonl        shares and pairings, for the reader only — never imported
 *   files/<dir>/<name>        every uploaded file the account owns
 *
 * Raise `ARCHIVE_FORMAT_VERSION` when a reader of the previous version could not
 * read the new layout. A reader refuses any archive with a higher version than its own.
 */
export const ARCHIVE_FORMAT = "travstats-account-archive";
export const ARCHIVE_FORMAT_VERSION = 1;

export const MANIFEST_ENTRY = "manifest.json";
export const ACCOUNT_ENTRY = "account.json";

const GIB = 1024 * 1024 * 1024;
/** Default ceiling of an archive's uncompressed size, export and import alike. */
const DEFAULT_MAX_BYTES = 10 * GIB;

/** `ACCOUNT_ARCHIVE_MAX_BYTES` overrides the ceiling (bytes). */
export function archiveMaxBytes(): number {
  const raw = Number(process.env.ACCOUNT_ARCHIVE_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

/**
 * Finished exports and uploaded imports wait here: outside `uploads/` (the orphan
 * sweep and the backup must not see them) and created 0700.
 */
export function archiveWorkDir(): string {
  return process.env.ACCOUNT_ARCHIVE_DIR || path.join(os.tmpdir(), "travstats-account-archives");
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const manifestEntrySchema = z.object({
  name: z.string().min(1).max(512),
  bytes: z.number().int().nonnegative(),
  sha256,
  /** Data, catalogue and info entries: the number of lines. */
  rows: z.number().int().nonnegative().optional(),
});

export const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  formatVersion: z.number().int().positive(),
  archiveId: z.string().uuid(),
  serverVersion: z.string().max(64),
  exportedAt: z.string(),
  sourceUserId: z.string().min(1).max(64),
  entries: z.array(manifestEntrySchema).max(1_000_000),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** Only what the archive needs to tell the format version apart before validating the rest. */
export const manifestHeadSchema = z.object({
  format: z.string(),
  formatVersion: z.number().int(),
});

export const accountProfileSchema = z.object({
  username: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  birthdate: z.string().nullable(),
  notificationEmail: z.string().nullable(),
  notifyBefore24h: z.boolean(),
  notifyBefore2h: z.boolean(),
});

export type AccountProfile = z.infer<typeof accountProfileSchema>;

/** `data/<table>.jsonl` and its two siblings. */
export const TABLE_ENTRY = /^(data|catalogue|info)\/([a-z_][a-z0-9_]*)\.jsonl$/;
/** `files/<dir>/<name>`: one directory level, a plain file name. */
export const FILE_ENTRY = /^files\/([a-z-]+)\/([^/\\]+)$/;

export function tableEntryName(section: "data" | "catalogue" | "info", table: string): string {
  return `${section}/${table}.jsonl`;
}

export function fileEntryName(dir: string, name: string): string {
  return `files/${dir}/${name}`;
}

/** A stored name safe to join under an upload directory. */
export function isSafeFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    path.basename(name) === name
  );
}
