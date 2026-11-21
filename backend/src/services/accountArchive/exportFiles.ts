import fsp from "fs/promises";
import path from "path";

import { BACKED_UP_UPLOAD_DIRS } from "../../config/uploadDirs";
import { UPLOAD_DIR_POLICIES } from "../files/uploadDirPolicies";
import { pendingDeletionKeys } from "../files/pendingDeletions";
import { displayRenditionName } from "../photos/displayRendition";
import { quoteIdent, type Db } from "./catalog";
import { isSafeFileName } from "./format";
import { selectionWhere, type ArchivePlan } from "./plan";
import type { FileColumn } from "./tablePolicy";

/**
 * Which uploaded files an account archive may carry (forgejo#433). Fail closed:
 * a file is written only when ALL of these hold —
 *   (a) a row of this account, as exported, names it;
 *   (b) it is in the account's owner list for its directory: the account
 *       deletion's own rule (`UPLOAD_DIR_POLICIES[dir].account.namesOf`), plus,
 *       for receipts, the legacy `receipt_url` columns of this account's rows;
 *   (c) no row of any other account names it;
 *   (d) it is in the live directory (a quarantined orphan is not) and no
 *       deletion is still pending for it.
 * Every name — rows, owner lists, other accounts' rows — goes through ONE
 * normalisation (`fileRefName`), so an encoded or query-string form cannot read
 * differently in one check than in another.
 */

export interface AccountFile {
  dir: string;
  name: string;
  size: number;
}

type Names = Map<string, Set<string>>;

/**
 * The stored name a column value refers to: a plain name, a path, or a URL (query
 * and fragment dropped, an avatar's `/content` suffix dropped, percent-decoded).
 * Null when the result is not a single safe file name — `%2F` and friends fail.
 */
export function fileRefName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let s = raw.split(/[?#]/)[0].replace(/\/+$/, "");
  if (s.endsWith("/content")) s = s.slice(0, -"/content".length);
  const segment = s.slice(s.lastIndexOf("/") + 1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return isSafeFileName(decoded) ? decoded : null;
}

/** The value a rule reads: the column, or the avatar URL inside the settings JSON. */
function ruleValue(row: Record<string, unknown>, rule: FileColumn): unknown {
  const value = row[rule.column];
  if (rule.kind !== "avatar") return value;
  if (typeof value === "string") {
    try {
      return (JSON.parse(value) as { profile?: { profilePicture?: unknown } }).profile
        ?.profilePicture;
    } catch {
      return null;
    }
  }
  return (value as { profile?: { profilePicture?: unknown } } | null)?.profile?.profilePicture;
}

function add(names: Names, dir: string, name: string | null): void {
  if (!name) return;
  const set = names.get(dir) ?? new Set<string>();
  set.add(name);
  names.set(dir, set);
}

/** (a) The files an exported row names. */
export function noteFiles(
  row: Record<string, unknown>,
  rules: readonly FileColumn[],
  named: Names
): void {
  for (const rule of rules) {
    if (rule.linkedWhen?.some((c) => row[c] !== null && row[c] !== undefined)) continue;
    add(named, rule.dir, fileRefName(ruleValue(row, rule)));
  }
}

/** Rows of `table` read through one rule, for this account or for every other one. */
async function ruleNames(
  db: Db,
  plan: ArchivePlan,
  table: string,
  rule: FileColumn,
  userId: string,
  others: boolean
): Promise<Array<string | null>> {
  const where = selectionWhere(plan, table);
  const col = `t0.${quoteIdent(rule.column)}`;
  // An avatar is read out of the settings JSON in SQL; the rest is the column itself.
  const expr = rule.kind === "avatar" ? `${col}->'profile'->>'profilePicture'` : `${col}::text`;
  const rows = await db.$queryRawUnsafe<Array<{ v: string | null }>>(
    `SELECT ${expr} AS v FROM ${quoteIdent(table)} t0
      WHERE ${expr} IS NOT NULL
        AND ${others ? `COALESCE((${where}), false) = false` : `(${where})`}`,
    userId
  );
  return rows.map((r) => fileRefName(r.v));
}

/** The files this account may export, from what its rows name. */
export async function ownedFiles(
  db: Db,
  plan: ArchivePlan,
  userId: string,
  named: Names,
  root: string
): Promise<{ files: AccountFile[]; missing: number; refused: number }> {
  const owners: Names = new Map();
  for (const dir of BACKED_UP_UPLOAD_DIRS) {
    const rule = UPLOAD_DIR_POLICIES[dir].account;
    if (rule.kind === "none" || !named.has(dir)) continue;
    for (const n of await rule.namesOf(userId, path.join(root, dir)))
      add(owners, dir, fileRefName(n));
  }
  const foreign: Names = new Map();
  for (const p of plan.tables) {
    for (const rule of p.policy.files ?? []) {
      if (!named.has(rule.dir)) continue;
      if (rule.kind === "url") {
        for (const n of await ruleNames(db, plan, p.table.name, rule, userId, false))
          add(owners, rule.dir, n);
      }
      for (const n of await ruleNames(db, plan, p.table.name, rule, userId, true))
        add(foreign, rule.dir, n);
    }
  }
  const pending = await pendingDeletionKeys(root);
  const files: AccountFile[] = [];
  let missing = 0;
  let refused = 0;
  for (const [dir, names] of [...named].sort(([a], [b]) => a.localeCompare(b))) {
    for (const name of [...names].sort()) {
      const ok =
        owners.get(dir)?.has(name) === true &&
        foreign.get(dir)?.has(name) !== true &&
        !pending.has(`${dir}/${name}`);
      if (!ok) {
        refused += 1;
        continue;
      }
      for (const candidate of [name, displayRenditionName(name)]) {
        if (pending.has(`${dir}/${candidate}`)) continue;
        const stat = await fsp.lstat(path.join(root, dir, candidate)).catch(() => null);
        if (stat?.isFile()) files.push({ dir, name: candidate, size: stat.size });
        else if (candidate === name) missing += 1;
      }
    }
  }
  return { files, missing, refused };
}

/**
 * The account's owner list with sizes, read before the rows only to refuse an
 * oversized archive early; the ceiling itself is enforced on the bytes written.
 */
export async function estimateFiles(userId: string, root: string): Promise<AccountFile[]> {
  const files: AccountFile[] = [];
  for (const dir of BACKED_UP_UPLOAD_DIRS) {
    const rule = UPLOAD_DIR_POLICIES[dir].account;
    if (rule.kind === "none") continue;
    for (const raw of await rule.namesOf(userId, path.join(root, dir))) {
      const name = fileRefName(raw);
      if (!name) continue;
      const stat = await fsp.lstat(path.join(root, dir, name)).catch(() => null);
      if (stat?.isFile()) files.push({ dir, name, size: stat.size });
    }
  }
  return files;
}
