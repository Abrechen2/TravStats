import type { Column, Db, TableInfo } from "./catalog";
import { quoteIdent, TEXT_ROUND_TRIP_TYPES } from "./catalog";

/** Rows per query while streaming a table out. */
const PAGE_SIZE = 1000;

/** The select list: numeric and bigint as text, so no digit is lost on the way through JSON. */
export function selectList(columns: readonly Column[], alias: string): string {
  return columns
    .map((c) =>
      TEXT_ROUND_TRIP_TYPES.has(c.type)
        ? `${alias}.${quoteIdent(c.name)}::text AS ${quoteIdent(c.name)}`
        : `${alias}.${quoteIdent(c.name)}`
    )
    .join(", ");
}

/**
 * The columns a table's rows are paged by: a unique sequence column when there is
 * one (TravTrack points keep their order, so the target's `seq` follows it), else
 * the primary key.
 */
export function pagingKey(table: TableInfo): Column[] {
  const byName = (n: string) => table.columns.find((c) => c.name === n)!;
  const serial = table.columns.find((c) => c.serial && !table.primaryKey.includes(c.name));
  if (serial) return [serial];
  if (table.primaryKey.length === 0) throw new Error(`${table.name} has no primary key`);
  return table.primaryKey.map(byName);
}

/**
 * Every row of `table` matching `where` (which may use `$1`), as parsed JSON objects
 * keyed by column name, read in keyset pages so a million TravTrack points never sit
 * in memory at once.
 */
export async function* readRows(
  db: Db,
  table: TableInfo,
  columns: readonly Column[],
  where: string,
  params: readonly unknown[]
): AsyncGenerator<Record<string, unknown>> {
  const key = pagingKey(table);
  const keyCols = key.map((c) => `t0.${quoteIdent(c.name)}`);
  const keySelect = key.map((c, i) => `t0.${quoteIdent(c.name)}::text AS k${i}`).join(", ");
  let last: string[] | null = null;
  for (;;) {
    const values: unknown[] = [...params];
    let after = "";
    if (last) {
      const placeholders = last.map((v, i) => {
        values.push(v);
        return `$${values.length}::${key[i].type}`;
      });
      after = ` AND (${keyCols.join(", ")}) > (${placeholders.join(", ")})`;
    }
    const sql =
      `SELECT row_to_json(x)::text AS j, ${key.map((_, i) => `x.k${i}`).join(", ")} FROM (` +
      `SELECT ${selectList(columns, "t0")}, ${keySelect} FROM ${quoteIdent(table.name)} t0 ` +
      `WHERE (${where})${after} ORDER BY ${keyCols.join(", ")} LIMIT ${PAGE_SIZE}) x`;
    const rows = await db.$queryRawUnsafe<Array<Record<string, string>>>(sql, ...values);
    for (const r of rows) {
      const parsed = JSON.parse(r.j) as Record<string, unknown>;
      for (let i = 0; i < key.length; i++) delete parsed[`k${i}`];
      yield parsed;
    }
    if (rows.length < PAGE_SIZE) return;
    const tail = rows[rows.length - 1];
    last = key.map((_, i) => tail[`k${i}`]);
  }
}
