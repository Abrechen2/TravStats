import type { Catalog, Column, TableInfo } from "./catalog";
import { quoteIdent } from "./catalog";
import { isDataPolicy, TABLE_POLICY, type DataPolicy, type TablePolicy } from "./tablePolicy";

/**
 * The archive's reading of the schema: which tables travel, how each of their
 * foreign keys is carried across, in which order the target inserts them, and the
 * SQL that selects one account's rows. Export and import both build it from the
 * live catalog, so the two sides agree by construction.
 */

/** What a foreign key column becomes on the target. */
export type FkRole =
  /** The owner column: the target account's id. */
  | { kind: "owner" }
  /** Into a table that travels: the referenced row's new id. */
  | { kind: "remap"; refTable: string }
  /** Into catalogue rows: resolved by natural key on the target. */
  | { kind: "catalogue"; refTable: string }
  /** Into anything that does not travel (other accounts, shares, bookkeeping): null. */
  | { kind: "null" };

export interface DataTablePlan {
  table: TableInfo;
  policy: DataPolicy;
  fkRoles: ReadonlyMap<string, FkRole>;
  /** The single text primary key that is re-keyed, when the table has one of its own. */
  idColumn: string | null;
  /** Integer primary key the target's sequence assigns (owned hotel chains). */
  serialIdColumn: string | null;
  /** Columns the target writes: no generated column, no sequence-filled one. */
  writeColumns: Column[];
  /** Columns the export reads: everything but generated columns. */
  readColumns: Column[];
}

export interface ArchivePlan {
  catalog: Catalog;
  /** Data tables in insert order. */
  tables: DataTablePlan[];
  byName: ReadonlyMap<string, DataTablePlan>;
  /** Foreign keys that point forward in the insert order: inserted null, set afterwards. */
  deferred: ReadonlyMap<string, ReadonlySet<string>>;
  /** Tables catalogue references point into. */
  catalogueTables: string[];
  unclassified: string[];
}

export class ArchivePlanError extends Error {}

function policyOf(name: string): TablePolicy | undefined {
  return TABLE_POLICY[name];
}

function isCatalogueTarget(name: string): boolean {
  const p = policyOf(name);
  return p?.kind === "catalogue" || (isDataPolicy(p) && p.catalogue !== undefined);
}

function fkRole(table: TableInfo, policy: DataPolicy, column: string, refTable: string): FkRole {
  if (refTable === "users") {
    return policy.kind === "owner" && policy.column === column
      ? { kind: "owner" }
      : { kind: "null" };
  }
  const ref = policyOf(refTable);
  if (isDataPolicy(ref) && ref.catalogue) return { kind: "catalogue", refTable };
  if (isDataPolicy(ref)) return { kind: "remap", refTable };
  if (ref?.kind === "catalogue") return { kind: "catalogue", refTable };
  const col = table.columns.find((c) => c.name === column);
  if (col?.notNull) {
    throw new ArchivePlanError(
      `${table.name}.${column} must point at ${refTable}, which does not travel; classify one of them differently`
    );
  }
  return { kind: "null" };
}

export function buildPlan(catalog: Catalog): ArchivePlan {
  const unclassified = [...catalog.keys()].filter((t) => !policyOf(t)).sort();
  const dataTables: DataTablePlan[] = [];
  for (const table of catalog.values()) {
    const policy = policyOf(table.name);
    if (!isDataPolicy(policy)) continue;
    const fkRoles = new Map<string, FkRole>();
    for (const fk of table.foreignKeys) {
      if (fk.refColumn !== (catalog.get(fk.refTable)?.primaryKey[0] ?? "")) {
        throw new ArchivePlanError(`${table.name}.${fk.column} references a non-key column`);
      }
      fkRoles.set(fk.column, fkRole(table, policy, fk.column, fk.refTable));
    }
    const pk = table.primaryKey;
    const pkCol = pk.length === 1 ? table.columns.find((c) => c.name === pk[0]) : undefined;
    const ownId = pkCol && !fkRoles.has(pkCol.name) ? pkCol : undefined;
    const idColumn = ownId && ownId.type === "text" ? ownId.name : null;
    const serialIdColumn = ownId && ownId.serial ? ownId.name : null;
    if (ownId && !idColumn && !serialIdColumn) {
      throw new ArchivePlanError(
        `${table.name}: primary key ${ownId.name} is neither text nor a sequence`
      );
    }
    const readColumns = table.columns.filter((c) => !c.generated);
    const writeColumns = readColumns.filter((c) => !c.serial);
    dataTables.push({
      table,
      policy,
      fkRoles,
      idColumn,
      serialIdColumn,
      writeColumns,
      readColumns,
    });
  }
  const byName = new Map(dataTables.map((p) => [p.table.name, p]));
  const { order, deferred } = insertOrder(dataTables, byName);
  const catalogueTables = new Set<string>();
  for (const p of dataTables) {
    for (const role of p.fkRoles.values())
      if (role.kind === "catalogue") catalogueTables.add(role.refTable);
  }
  for (const t of catalogueTables) {
    if (!isCatalogueTarget(t))
      throw new ArchivePlanError(`${t} is referenced as a catalogue without a spec`);
    const info = catalog.get(t);
    if (info && policyOf(t)?.kind === "catalogue" && info.foreignKeys.length > 0) {
      throw new ArchivePlanError(
        `catalogue table ${t} has foreign keys; the import cannot resolve them`
      );
    }
  }
  return {
    catalog,
    tables: order,
    byName,
    deferred,
    catalogueTables: [...catalogueTables].sort(),
    unclassified,
  };
}

/**
 * Parents before children. Where the keys form a cycle (a place's cover photo is a
 * photo of one of its visits), a nullable key is inserted null and set afterwards.
 */
function insertOrder(
  tables: DataTablePlan[],
  byName: ReadonlyMap<string, DataTablePlan>
): { order: DataTablePlan[]; deferred: Map<string, Set<string>> } {
  const placed = new Set<string>();
  const order: DataTablePlan[] = [];
  const deferred = new Map<string, Set<string>>();
  const pending = [...tables].sort((a, b) => a.table.name.localeCompare(b.table.name));
  const deps = (p: DataTablePlan, notNullOnly: boolean) =>
    [...p.fkRoles.entries()].filter(([col, role]) => {
      if (role.kind !== "remap" && role.kind !== "catalogue") return false;
      if (!byName.has(role.refTable) || role.refTable === p.table.name) return false;
      return !notNullOnly || p.table.columns.find((c) => c.name === col)?.notNull;
    });
  while (pending.length > 0) {
    const ready = (notNullOnly: boolean) =>
      pending.findIndex((p) =>
        deps(p, notNullOnly).every(([, role]) =>
          placed.has((role as { refTable: string }).refTable)
        )
      );
    let index = ready(false);
    if (index < 0) {
      index = breakCycle(pending, placed, deps);
      if (index < 0)
        throw new ArchivePlanError("account archive: a cycle of NOT NULL foreign keys");
      const p = pending[index];
      const late = deps(p, false)
        .filter(([, role]) => !placed.has((role as { refTable: string }).refTable))
        .map(([col]) => col);
      deferred.set(p.table.name, new Set(late));
    }
    const [next] = pending.splice(index, 1);
    placed.add(next.table.name);
    order.push(next);
  }
  // Self references (none today) would also need a second pass.
  for (const p of tables) {
    const self = [...p.fkRoles.entries()].filter(
      ([, role]) => role.kind === "remap" && role.refTable === p.table.name
    );
    if (self.length > 0) {
      const set = deferred.get(p.table.name) ?? new Set<string>();
      for (const [col] of self) set.add(col);
      deferred.set(p.table.name, set);
    }
  }
  return { order, deferred };
}

type Deps = (p: DataTablePlan, notNullOnly: boolean) => Array<[string, FkRole]>;

/**
 * The table to insert first when every pending one waits on another: one that sits
 * on a cycle itself (so deferring its keys resolves something) and whose NOT NULL
 * keys are satisfied, deferring as few keys as possible.
 */
function breakCycle(pending: DataTablePlan[], placed: ReadonlySet<string>, deps: Deps): number {
  const refOf = (role: FkRole) => (role as { refTable: string }).refTable;
  const byName = new Map(pending.map((p) => [p.table.name, p]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const name = stack.pop()!;
      for (const [, role] of deps(byName.get(name)!, false)) {
        const ref = refOf(role);
        if (ref === to) return true;
        if (!placed.has(ref) && byName.has(ref) && !seen.has(ref)) {
          seen.add(ref);
          stack.push(ref);
        }
      }
    }
    return false;
  };
  let best = -1;
  let bestLate = Infinity;
  pending.forEach((p, i) => {
    if (!deps(p, true).every(([, role]) => placed.has(refOf(role)))) return;
    if (!reaches(p.table.name, p.table.name)) return;
    const late = deps(p, false).filter(([, role]) => !placed.has(refOf(role))).length;
    if (late < bestLate) {
      best = i;
      bestLate = late;
    }
  });
  return best;
}

/**
 * `WHERE` clause selecting one account's rows of a data table; `$1` is the user id.
 * A child row travels when every key into a travelling table that is set points at
 * a travelling row of this account, and at least one is set.
 */
export function selectionWhere(plan: ArchivePlan, tableName: string, alias = "t0"): string {
  const counter = { n: 0 };
  return whereFor(plan, tableName, alias, counter, new Set());
}

function whereFor(
  plan: ArchivePlan,
  tableName: string,
  alias: string,
  counter: { n: number },
  visiting: Set<string>
): string {
  const p = plan.byName.get(tableName);
  if (!p) throw new ArchivePlanError(`${tableName} does not travel`);
  if (p.policy.kind === "owner") return `${alias}.${quoteIdent(p.policy.column)} = $1`;
  if (visiting.has(tableName)) throw new ArchivePlanError(`selection cycle at ${tableName}`);
  const next = new Set(visiting).add(tableName);
  const into = (col: string, refTable: string) => {
    counter.n += 1;
    const sub = `s${counter.n}`;
    const ref = plan.byName.get(refTable)!;
    const refPk = quoteIdent(ref.table.primaryKey[0]);
    return `${alias}.${quoteIdent(col)} IN (SELECT ${sub}.${refPk} FROM ${quoteIdent(refTable)} ${sub} WHERE ${whereFor(plan, refTable, sub, counter, next)})`;
  };
  const remaps = [...p.fkRoles.entries()].filter(
    (e): e is [string, { kind: "remap"; refTable: string }] => e[1].kind === "remap"
  );
  if (remaps.length === 0)
    throw new ArchivePlanError(`${tableName} has no key into a travelling table`);
  const isNotNull = (col: string) => p.table.columns.find((c) => c.name === col)?.notNull;
  // Every key into a travelling table must point into THIS account: a row that also
  // names another account's record is not this account's row.
  const all = remaps.map(([col, r]) =>
    isNotNull(col)
      ? into(col, r.refTable)
      : `(${alias}.${quoteIdent(col)} IS NULL OR ${into(col, r.refTable)})`
  );
  if (!remaps.some(([col]) => isNotNull(col))) {
    all.push(`(${remaps.map(([col]) => `${alias}.${quoteIdent(col)} IS NOT NULL`).join(" OR ")})`);
  }
  // A child table that records its user without a foreign key must name this one.
  if (p.table.columns.some((c) => c.name === "user_id")) all.push(`${alias}."user_id" = $1`);
  return all.join(" AND ");
}
