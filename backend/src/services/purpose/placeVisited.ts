import { isHiddenByPurpose } from "../../shared/purpose";

/**
 * `Place.visited` is a STORED flag, switched on when a visit that has happened is written. A
 * business visit that the account hides is out of every count (owner rule), so a place that is
 * "visited" only through such a visit — what is left visible is a plan — must not count as been to.
 * A flag cannot be narrowed in a `where`, so the read hook corrects it on the way out.
 *
 * Demoted only when ALL hold: the stored flag is on, a visit that has happened is hidden, and no
 * visible visit has happened. A place with no visible visit at all is dropped by the parent rule
 * before it gets here, and a place the user marked visited with no visit behind it is left alone.
 */

export interface VisitFact {
  placeId: string;
  purpose: string | null;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
}

/** Reads every visit of these places, unfiltered; injected by `db.ts`. */
export type VisitLoader = (placeIds: string[]) => Promise<VisitFact[]>;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

const PLACE_READS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
]);

/** Is this a read whose rows this module may correct? */
export const isPlaceRead = (model: string | undefined, operation: string): boolean =>
  model === "Place" && PLACE_READS.has(operation);

/** The place ids (of the rows that say `visited`) whose flag no longer stands. */
export async function demotedPlaceIds(
  visits: readonly VisitFact[],
  hidden: readonly string[],
  now: Date
): Promise<Set<string>> {
  // Loaded here, not at the top: this module is imported by `db.ts`, and `placeCounting` reaches
  // the error classes that import `db.ts` again (a load-order cycle: "Class extends undefined").
  const { classifyVisit } = await import("../../shared/placeCounting");
  const byPlace = new Map<string, { hiddenDone: boolean; visibleDone: boolean }>();
  for (const v of visits) {
    const entry = byPlace.get(v.placeId) ?? { hiddenDone: false, visibleDone: false };
    const done =
      classifyVisit({ visitedAt: v.visitedAt, visitedAtUtc: v.visitedAtUtc }, now) === "visited";
    if (done) {
      if (isHiddenByPurpose(v.purpose, hidden)) entry.hiddenDone = true;
      else entry.visibleDone = true;
    }
    byPlace.set(v.placeId, entry);
  }
  return new Set([...byPlace].filter(([, e]) => e.hiddenDone && !e.visibleDone).map(([id]) => id));
}

/**
 * Adds `id` to a `select` that asks for `visited` without it, so the rows can be matched; the
 * caller strips it again. Returns the (possibly new) args and whether it added the field.
 */
export function ensureIdSelected<A>(args: A): { args: A; added: boolean } {
  if (!isRow(args) || !isRow(args.select)) return { args, added: false };
  if (!args.select.visited || args.select.id) return { args, added: false };
  return { args: { ...args, select: { ...args.select, id: true } }, added: true };
}

/** Corrects `visited` on the rows a Place read returned. */
export async function demoteHiddenOnlyVisited<R>(
  result: R,
  hiddenPurposes: readonly string[],
  load: VisitLoader,
  stripId: boolean,
  now: Date
): Promise<R> {
  const rows = (Array.isArray(result) ? result : [result]).filter(isRow);
  const candidates = rows.filter((r) => r.visited === true && typeof r.id === "string");
  let demoted = new Set<string>();
  if (candidates.length > 0) {
    const visits = await load(candidates.map((r) => r.id as string));
    demoted = await demotedPlaceIds(visits, hiddenPurposes, now);
  }
  const fix = (row: Row): Row => {
    const next: Row = demoted.has(row.id as string) ? { ...row, visited: false } : { ...row };
    if (stripId) delete next.id;
    return next;
  };
  if (Array.isArray(result)) return result.map((r) => (isRow(r) ? fix(r) : r)) as R;
  return (isRow(result) ? fix(result) : result) as R;
}

/**
 * Where a read reaches Place rows through its `include`/`select` (a list entry's `place`, a
 * visit's `place`, …). Those rows carry the same stored `visited` flag, so the same demotion
 * applies to them; without it a list said "besucht" for a place the places page did not.
 */
export interface PlaceTree {
  /** The rows at this node are Place rows. */
  place: boolean;
  /** `id` was added to this node's `select` to match the rows; strip it again. */
  addedId: boolean;
  children: Record<string, PlaceTree>;
}

const NESTED_READS = PLACE_READS;

function planNode(
  model: string,
  args: Row,
  fieldsOf: (model: string) => ReadonlyArray<{ name: string; kind: string; type: string }>
): { args: Row; children: Record<string, PlaceTree> } {
  const children: Record<string, PlaceTree> = {};
  let next = args;
  for (const key of ["include", "select"] as const) {
    const spec = args[key];
    if (!isRow(spec)) continue;
    let nextSpec: Row = spec;
    for (const [name, value] of Object.entries(spec)) {
      if (!value) continue;
      const field = fieldsOf(model).find((f) => f.name === name && f.kind === "object");
      if (!field) continue;
      const isPlace = field.type === "Place";
      if (value === true) {
        if (isPlace) children[name] = { place: true, addedId: false, children: {} };
        continue;
      }
      if (!isRow(value)) continue;
      const inner = planNode(field.type, value, fieldsOf);
      let innerArgs = inner.args;
      let addedId = false;
      if (isPlace && isRow(innerArgs.select) && innerArgs.select.visited && !innerArgs.select.id) {
        innerArgs = { ...innerArgs, select: { ...innerArgs.select, id: true } };
        addedId = true;
      }
      if (isPlace && isRow(innerArgs.select) && !innerArgs.select.visited) {
        // The flag is not read here, so there is nothing to correct at this node.
        if (Object.keys(inner.children).length === 0) continue;
      }
      if (isPlace || Object.keys(inner.children).length > 0) {
        children[name] = { place: isPlace, addedId, children: inner.children };
        if (innerArgs !== value) nextSpec = { ...nextSpec, [name]: innerArgs };
      }
    }
    if (nextSpec !== spec) next = { ...next, [key]: nextSpec };
  }
  return { args: next, children };
}

/** The Place nodes a read's include/select reaches, and the args with `id` added where needed. */
export async function planNestedPlaces<A>(
  model: string | undefined,
  operation: string,
  args: A
): Promise<{ args: A; tree: PlaceTree | null }> {
  if (!model || !NESTED_READS.has(operation) || !isRow(args)) return { args, tree: null };
  if (!isRow(args.include) && !isRow(args.select)) return { args, tree: null };
  const { prismaModelFields } = await import("../openapi/prismaDatamodel");
  const planned = planNode(model, args, prismaModelFields);
  if (Object.keys(planned.children).length === 0) return { args, tree: null };
  return {
    args: planned.args as A,
    tree: { place: false, addedId: false, children: planned.children },
  };
}

const asRows = (value: unknown): Row[] => (Array.isArray(value) ? value : [value]).filter(isRow);

function collect(value: unknown, tree: PlaceTree, into: Set<string>): void {
  for (const row of asRows(value)) {
    for (const [key, child] of Object.entries(tree.children)) {
      const nested = row[key];
      if (child.place) {
        for (const p of asRows(nested)) {
          if (p.visited === true && typeof p.id === "string") into.add(p.id);
        }
      }
      collect(nested, child, into);
    }
  }
}

function rebuild(value: unknown, tree: PlaceTree, demoted: Set<string>): unknown {
  const fixRow = (row: Row): Row => {
    let next: Row = row;
    for (const [key, child] of Object.entries(tree.children)) {
      if (!(key in row)) continue;
      next = { ...next, [key]: rebuild(row[key], child, demoted) };
    }
    if (tree.place) {
      if (row.visited === true && demoted.has(row.id as string)) next = { ...next, visited: false };
      if (tree.addedId) {
        next = { ...next };
        delete next.id;
      }
    }
    return next;
  };
  if (Array.isArray(value)) return value.map((v) => (isRow(v) ? fixRow(v) : v));
  return isRow(value) ? fixRow(value) : value;
}

/** Corrects `visited` on every Place row a read reached through its include/select. */
export async function demoteNestedPlaces<R>(
  result: R,
  tree: PlaceTree,
  hiddenPurposes: readonly string[],
  load: VisitLoader,
  now: Date
): Promise<R> {
  const ids = new Set<string>();
  collect(result, tree, ids);
  if (ids.size === 0) return rebuild(result, tree, new Set()) as R;
  const demoted = await demotedPlaceIds(await load([...ids]), hiddenPurposes, now);
  return rebuild(result, tree, demoted) as R;
}
