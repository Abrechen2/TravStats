import type { Db, TableInfo } from "./catalog";
import { quoteIdent } from "./catalog";
import { schemaTooNew } from "./importValidate";
import type { ArchivePlan, DataTablePlan } from "./plan";
import type { Remapper } from "./remap";
import { TABLE_POLICY, type CatalogueSpec } from "./tablePolicy";
import { invalidArchive, type ArchiveReader } from "./zipReader";
import { tableEntryName } from "./format";
import { checkFileColumns, MissingFile, type FileVerdict } from "./importFiles";

/**
 * Writes an archive's rows into the target database inside the import's
 * transaction (forgejo#433): catalogue references resolved, every id re-keyed,
 * rows inserted in batches through `json_populate_recordset`, so Postgres itself
 * turns each JSON value back into its column's type.
 */

type Row = Record<string, unknown>;

const BATCH_ROWS = 500;
const BATCH_BYTES = 4 * 1024 * 1024;
const TEXT_LIKE = new Set(["text", "varchar", "bpchar", "jsonb", "json", "_text", "_varchar"]);

/** Old id -> new id of catalogue rows and sequence-keyed rows, per table, as text. */
export type KeyMaps = Map<string, Map<string, string>>;

/** Columns of one row written after every row exists (cycles, `late` columns). */
export interface DeferredUpdate {
  table: string;
  idColumn: string;
  id: string;
  values: Row;
}

function specOf(table: string): CatalogueSpec {
  const policy = TABLE_POLICY[table];
  if (policy?.kind === "catalogue") return policy.spec;
  if ((policy?.kind === "owner" || policy?.kind === "child") && policy.catalogue)
    return policy.catalogue;
  throw invalidArchive(`${table} is not a catalogue`);
}

/**
 * Each catalogue row the archive carries, matched on the target by its natural key
 * (UN/LOCODE, IMO, IATA/ICAO, a station's source id, a chain's name, an
 * achievement's code). Read-only: an archive never creates or changes a shared
 * catalogue row, since that row is every account's. A reference with no match is
 * left unresolved; `resolveKey` then clears it or refuses the row.
 */
export async function resolveCatalogue(
  db: Db,
  reader: ArchiveReader,
  plan: ArchivePlan,
  tables: readonly string[]
): Promise<KeyMaps> {
  const maps: KeyMaps = new Map();
  for (const table of tables) {
    const info = plan.catalog.get(table)!;
    const spec = specOf(table);
    const pk = info.primaryKey[0];
    const map = new Map<string, string>();
    for await (const row of reader.jsonLines(tableEntryName("catalogue", table))) {
      const old = row[pk];
      if (old === null || old === undefined) throw invalidArchive(`${table} row without ${pk}`);
      const found = await lookupNatural(db, info, spec, row);
      if (found) map.set(String(old), found);
    }
    maps.set(table, map);
  }
  return maps;
}

async function lookupNatural(
  db: Db,
  info: TableInfo,
  spec: CatalogueSpec,
  row: Row
): Promise<string | null> {
  const pk = quoteIdent(info.primaryKey[0]);
  for (const key of spec.naturalKeys) {
    if (!key.every((c) => row[c] !== null && row[c] !== undefined)) continue;
    const match = key.map((c) => `t0.${quoteIdent(c)} = r.${quoteIdent(c)}`).join(" AND ");
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT t0.${pk}::text AS id FROM ${quoteIdent(info.name)} t0,
              json_populate_record(NULL::${quoteIdent(info.name)}, $1::json) r
        WHERE ${match}${spec.where ? ` AND (${spec.where})` : ""} ORDER BY t0.${pk} LIMIT 1`,
      JSON.stringify(row)
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

export interface RowContext {
  plan: ArchivePlan;
  remap: Remapper;
  keyMaps: KeyMaps;
  deferred: DeferredUpdate[];
  /** Accepted files by their new stored name (`importFiles.ts`). */
  verdicts: ReadonlyMap<string, FileVerdict>;
  /** New ids of rows refused on the way: what points at them is cleared or refused too. */
  skipped: Set<string>;
  /** Rows refused, per table, and references cleared for want of a match. */
  report: { skipped: Record<string, number>; unmatched: number };
}

/** The row cannot be imported as it stands (its file, its parent, its catalogue row is missing). */
export class SkipRow extends Error {}

function resolveKey(ctx: RowContext, p: DataTablePlan, column: string, value: unknown): unknown {
  const role = p.fkRoles.get(column)!;
  const nullable = !p.table.columns.find((c) => c.name === column)!.notNull;
  const missing = () => {
    if (role.kind === "catalogue") ctx.report.unmatched += 1;
    if (nullable) return null;
    throw new SkipRow(`${p.table.name}.${column} points at a row that is not imported`);
  };
  switch (role.kind) {
    case "owner":
      return ctx.remap.targetUserId;
    case "null":
      return null;
    case "catalogue": {
      const old = String(value);
      return (
        ctx.keyMaps.get(`own:${role.refTable}`)?.get(old) ??
        ctx.keyMaps.get(role.refTable)?.get(old) ??
        missing()
      );
    }
    case "remap": {
      const ref = ctx.plan.byName.get(role.refTable)!;
      const old = String(value);
      if (ref.serialIdColumn) return ctx.keyMaps.get(`own:${role.refTable}`)?.get(old) ?? missing();
      const next = ref.policy.bulk || ctx.remap.hasId(old) ? ctx.remap.id(old) : null;
      return next && !ctx.skipped.has(next) ? next : missing();
    }
  }
}

/** Columns that name the account: always the target, whatever the archive says. */
function namesOwner(p: DataTablePlan, col: string): boolean {
  const role = p.fkRoles.get(col);
  return role?.kind === "owner" || (col === "user_id" && !role);
}

/**
 * One archived row as the target writes it; deferred and late columns are queued,
 * not set. Throws `SkipRow` when the row cannot be imported as it stands.
 */
export function transformRow(
  ctx: RowContext,
  p: DataTablePlan,
  row: Row,
  columns: readonly string[]
): Row {
  const out: Row = {};
  const strip = new Set(p.policy.strip ?? []);
  const later = new Set([...(ctx.plan.deferred.get(p.table.name) ?? []), ...(p.policy.late ?? [])]);
  const types = new Map(p.table.columns.map((c) => [c.name, c.type]));
  const fileColumns = new Set((p.policy.files ?? []).map((f) => f.column));
  const queued: Row = {};
  for (const col of columns) {
    const value = row[col];
    let next: unknown;
    if (namesOwner(p, col)) {
      next = ctx.remap.targetUserId;
    } else if (value === null || value === undefined || strip.has(col)) {
      next = null;
    } else if (col === p.idColumn) {
      next = ctx.remap.id(String(value));
    } else if (p.fkRoles.has(col)) {
      next = resolveKey(ctx, p, col, value);
    } else if (p.policy.rekey?.includes(col)) {
      next = ctx.remap.id(String(value));
    } else if (p.policy.idColumns?.includes(col)) {
      // An id the archive does not carry would name another account's record.
      const id = ctx.remap.hasId(String(value)) ? ctx.remap.id(String(value)) : null;
      if (!id || ctx.skipped.has(id))
        throw new SkipRow(`${p.table.name}.${col} names no imported row`);
      next = id;
    } else if (!p.policy.bulk && TEXT_LIKE.has(types.get(col) ?? "")) {
      next = ctx.remap.rewrite(value, fileColumns.has(col));
    } else {
      next = value;
    }
    if (later.has(col) && next !== null) {
      queued[col] = next;
      out[col] = null;
    } else {
      out[col] = next;
    }
  }
  if (p.policy.files) {
    const nullable = (c: string) => !p.table.columns.find((x) => x.name === c)?.notNull;
    try {
      checkFileColumns(out, p.policy.files, ctx.verdicts, nullable);
    } catch (err) {
      if (err instanceof MissingFile) throw new SkipRow(err.message);
      throw err;
    }
  }
  if (Object.keys(queued).length > 0) {
    if (!p.idColumn) throw invalidArchive(`${p.table.name} cannot take a deferred column`);
    ctx.deferred.push({
      table: p.table.name,
      idColumn: p.idColumn,
      id: String(out[p.idColumn]),
      values: queued,
    });
  }
  return out;
}

/** The columns an archived table's rows carry; the target fills the rest with defaults. */
function columnsOf(p: DataTablePlan, row: Row): string[] {
  const known = new Set(p.table.columns.map((c) => c.name));
  const writable = new Set(p.writeColumns.map((c) => c.name));
  const keys = Object.keys(row);
  for (const key of keys) {
    if (!known.has(key)) throw schemaTooNew(`${p.table.name}.${key} does not exist on this server`);
  }
  // The owner column is written even when an archive leaves it out.
  const owners = p.table.columns.filter((c) => namesOwner(p, c.name)).map((c) => c.name);
  return [...new Set([...keys, ...owners])]
    .filter((k) => writable.has(k) || k === p.serialIdColumn)
    .sort();
}

/** Inserts one table's rows; returns how many. */
export async function insertTable(
  db: Db,
  reader: ArchiveReader,
  ctx: RowContext,
  p: DataTablePlan,
  onRow: () => void
): Promise<number> {
  let columns: string[] | null = null;
  let batch: Row[] = [];
  let batchBytes = 0;
  let count = 0;
  const flush = async () => {
    if (batch.length === 0 || !columns) return;
    const writeCols = columns.filter((c) => c !== p.serialIdColumn);
    const list = writeCols.map(quoteIdent).join(", ");
    // An imported account starts unshared: share keys and groups never travel, so
    // nothing here propagates to another account.
    await db.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(p.table.name)} (${list})
       SELECT ${list} FROM json_populate_recordset(NULL::${quoteIdent(p.table.name)}, $1::json)`,
      JSON.stringify(batch)
    );
    batch = [];
    batchBytes = 0;
  };
  const ownKeys = new Map<string, string>();
  for await (const row of reader.jsonLines(tableEntryName("data", p.table.name))) {
    const rowColumns = columnsOf(p, row);
    if (!columns) columns = rowColumns;
    else if (rowColumns.join(",") !== columns.join(",")) {
      throw invalidArchive(`${p.table.name} rows carry different columns`);
    }
    let out: Row;
    try {
      out = transformRow(ctx, p, row, columns);
    } catch (err) {
      if (!(err instanceof SkipRow)) throw err;
      if (p.idColumn && typeof row[p.idColumn] === "string") {
        ctx.skipped.add(ctx.remap.id(row[p.idColumn] as string));
      }
      ctx.report.skipped[p.table.name] = (ctx.report.skipped[p.table.name] ?? 0) + 1;
      onRow();
      continue;
    }
    count += 1;
    onRow();
    if (p.serialIdColumn) {
      ownKeys.set(String(row[p.serialIdColumn]), await insertSerialRow(db, p, out, columns));
      continue;
    }
    const json = JSON.stringify(out);
    batch.push(out);
    batchBytes += json.length;
    if (batch.length >= BATCH_ROWS || batchBytes >= BATCH_BYTES) await flush();
  }
  await flush();
  if (p.serialIdColumn) ctx.keyMaps.set(`own:${p.table.name}`, ownKeys);
  return count;
}

async function insertSerialRow(
  db: Db,
  p: DataTablePlan,
  row: Row,
  columns: string[]
): Promise<string> {
  const writeCols = columns.filter((c) => c !== p.serialIdColumn);
  const list = writeCols.map(quoteIdent).join(", ");
  const { [p.serialIdColumn!]: _old, ...value } = row;
  const [inserted] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO ${quoteIdent(p.table.name)} (${list})
     SELECT ${list} FROM json_populate_record(NULL::${quoteIdent(p.table.name)}, $1::json)
     RETURNING ${quoteIdent(p.serialIdColumn!)}::text AS id`,
    JSON.stringify(value)
  );
  return inserted.id;
}

/** One UPDATE per row, all of its late columns at once (the owner trigger sees the final state). */
export async function applyDeferred(
  db: Db,
  updates: readonly DeferredUpdate[],
  skipped: ReadonlySet<string>
): Promise<void> {
  for (const u of updates) {
    if (skipped.has(u.id)) continue;
    // A key to a row refused after this one was queued stays unset.
    const values = Object.fromEntries(
      Object.entries(u.values).filter(([, v]) => !(typeof v === "string" && skipped.has(v)))
    );
    if (Object.keys(values).length === 0) continue;
    const list = Object.keys(values).map(quoteIdent).join(", ");
    const table = quoteIdent(u.table);
    await db.$executeRawUnsafe(
      `UPDATE ${table} t SET (${list}) = (SELECT ${list} FROM json_populate_record(NULL::${table}, $1::json))
        WHERE t.${quoteIdent(u.idColumn)} = $2`,
      JSON.stringify(values),
      u.id
    );
  }
}
