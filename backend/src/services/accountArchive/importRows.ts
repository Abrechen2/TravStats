import type { Db, TableInfo } from "./catalog";
import { quoteIdent } from "./catalog";
import { schemaTooNew } from "./importValidate";
import type { ArchivePlan, DataTablePlan } from "./plan";
import type { Remapper } from "./remap";
import { TABLE_POLICY, type CatalogueSpec } from "./tablePolicy";
import { invalidArchive, type ArchiveReader } from "./zipReader";
import { tableEntryName } from "./format";

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
 * Each catalogue row the archive carries, matched on the target by its natural key;
 * a row the target lacks is inserted as a copy under a new id.
 */
export async function resolveCatalogue(
  db: Db,
  reader: ArchiveReader,
  plan: ArchivePlan,
  tables: readonly string[],
  remap: Remapper
): Promise<KeyMaps> {
  const maps: KeyMaps = new Map();
  for (const table of tables) {
    const info = plan.catalog.get(table)!;
    const spec = specOf(table);
    const pk = info.primaryKey[0];
    const pkCol = info.columns.find((c) => c.name === pk)!;
    const map = new Map<string, string>();
    for await (const row of reader.jsonLines(tableEntryName("catalogue", table))) {
      const old = row[pk];
      if (old === null || old === undefined) throw invalidArchive(`${table} row without ${pk}`);
      const found = await lookupNatural(db, info, spec, row);
      map.set(String(old), found ?? (await insertCopy(db, info, pkCol.serial, row, remap)));
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

async function insertCopy(
  db: Db,
  info: TableInfo,
  serial: boolean,
  row: Row,
  remap: Remapper
): Promise<string> {
  const pk = info.primaryKey[0];
  const columns = info.columns.filter(
    (c) => !c.generated && !(serial && c.name === pk) && c.name in row
  );
  const value = serial ? row : { ...row, [pk]: remap.id(String(row[pk])) };
  const list = columns.map((c) => quoteIdent(c.name)).join(", ");
  const [inserted] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO ${quoteIdent(info.name)} (${list})
     SELECT ${list} FROM json_populate_record(NULL::${quoteIdent(info.name)}, $1::json)
     RETURNING ${quoteIdent(pk)}::text AS id`,
    JSON.stringify(value)
  );
  return inserted.id;
}

export interface RowContext {
  plan: ArchivePlan;
  remap: Remapper;
  keyMaps: KeyMaps;
  deferred: DeferredUpdate[];
}

function resolveKey(ctx: RowContext, p: DataTablePlan, column: string, value: unknown): unknown {
  const role = p.fkRoles.get(column)!;
  const nullable = !p.table.columns.find((c) => c.name === column)!.notNull;
  const missing = () => {
    if (nullable) return null;
    throw invalidArchive(`${p.table.name}.${column} points at a row the archive does not carry`);
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
      if (ref.policy.bulk || ctx.remap.hasId(old)) return ctx.remap.id(old);
      return missing();
    }
  }
}

/** One archived row as the target writes it; deferred and late columns are queued, not set. */
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
  const queued: Row = {};
  for (const col of columns) {
    const value = row[col];
    let next: unknown;
    if (value === null || value === undefined || strip.has(col)) {
      next = null;
    } else if (col === p.idColumn) {
      next = ctx.remap.id(String(value));
    } else if (p.fkRoles.has(col)) {
      next = resolveKey(ctx, p, col, value);
    } else if (p.policy.rekey?.includes(col)) {
      next = ctx.remap.id(String(value));
    } else if (p.policy.idColumns?.includes(col)) {
      next = ctx.remap.hasId(String(value)) ? ctx.remap.id(String(value)) : value;
    } else if (!p.policy.bulk && TEXT_LIKE.has(types.get(col) ?? "")) {
      next = ctx.remap.rewrite(value, p.policy.files?.includes(col) ?? false);
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
  return keys.filter((k) => writable.has(k) || k === p.serialIdColumn).sort();
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
    // share-exempt: an imported account starts unshared; share keys and groups never travel.
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
    const out = transformRow(ctx, p, row, columns);
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
export async function applyDeferred(db: Db, updates: readonly DeferredUpdate[]): Promise<void> {
  for (const u of updates) {
    const list = Object.keys(u.values).map(quoteIdent).join(", ");
    const table = quoteIdent(u.table);
    await db.$executeRawUnsafe(
      `UPDATE ${table} t SET (${list}) = (SELECT ${list} FROM json_populate_record(NULL::${table}, $1::json))
        WHERE t.${quoteIdent(u.idColumn)} = $2`,
      JSON.stringify(u.values),
      u.id
    );
  }
}
