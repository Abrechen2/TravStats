/**
 * The database's own description of its tables, read from the system catalog:
 * columns, primary keys and foreign keys. The account archive walks these instead
 * of a hand-kept relation list, so a table a migration adds is seen the day it
 * exists (and `tablePolicy.ts` must then classify it, or its test fails).
 */

export interface Column {
  name: string;
  /** `udt_name`: text, int4, int8, numeric, jsonb, _text, timestamp, ... */
  type: string;
  notNull: boolean;
  /** GENERATED ALWAYS: never written. */
  generated: boolean;
  /** Filled from a sequence (serial / identity): the target assigns it. */
  serial: boolean;
}

export interface ForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface TableInfo {
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
}

export type Catalog = ReadonlyMap<string, TableInfo>;

/** The one query surface the archive needs: Prisma's client or a transaction. */
export interface Db {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export async function readCatalog(db: Db): Promise<Catalog> {
  const columns = await db.$queryRawUnsafe<
    Array<{
      table: string;
      name: string;
      type: string;
      not_null: boolean;
      generated: boolean;
      serial: boolean;
    }>
  >(
    `SELECT table_name AS table, column_name AS name, udt_name AS type,
            is_nullable = 'NO' AS not_null,
            is_generated = 'ALWAYS' AS generated,
            (is_identity = 'YES' OR coalesce(column_default, '') LIKE 'nextval(%') AS serial
       FROM information_schema.columns c
      WHERE table_schema = 'public'
        AND EXISTS (SELECT 1 FROM information_schema.tables t
                     WHERE t.table_schema = 'public' AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE')
      ORDER BY table_name, ordinal_position`
  );
  const keys = await db.$queryRawUnsafe<
    Array<{
      table: string;
      kind: string;
      columns: string[];
      ref_table: string | null;
      ref_columns: string[] | null;
    }>
  >(
    `SELECT t.relname AS table, c.contype::text AS kind,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
            r.relname AS ref_table,
            CASE WHEN c.contype = 'f' THEN
              ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i)
            END AS ref_columns
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_class r ON r.oid = c.confrelid
      WHERE n.nspname = 'public' AND t.relkind = 'r' AND c.contype IN ('p', 'f')`
  );
  const tables = new Map<string, TableInfo>();
  for (const c of columns) {
    let table = tables.get(c.table);
    if (!table) {
      table = { name: c.table, columns: [], primaryKey: [], foreignKeys: [] };
      tables.set(c.table, table);
    }
    table.columns.push({
      name: c.name,
      type: c.type,
      notNull: c.not_null,
      generated: c.generated,
      serial: c.serial,
    });
  }
  for (const k of keys) {
    const table = tables.get(k.table);
    if (!table) continue;
    if (k.kind === "p") {
      table.primaryKey = k.columns;
    } else if (k.ref_table && k.ref_columns) {
      if (k.columns.length !== 1 || k.ref_columns.length !== 1) {
        // No composite foreign key exists today; the remap below could not follow one.
        throw new Error(`account archive: composite foreign key on ${k.table} is not supported`);
      }
      table.foreignKeys.push({
        column: k.columns[0],
        refTable: k.ref_table,
        refColumn: k.ref_columns[0],
      });
    }
  }
  for (const t of tables.values()) t.foreignKeys.sort((a, b) => a.column.localeCompare(b.column));
  return tables;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Column types whose JSON number form could lose digits: written as text. */
export const TEXT_ROUND_TRIP_TYPES = new Set(["numeric", "int8", "_numeric", "_int8"]);
