import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";

import { prismaModelFields } from "../openapi/prismaDatamodel";

/**
 * "Nur belegte" — the ONE filter behind every statistic that can leave out entries typed in from
 * memory (docs/superpowers/specs/2026-11-22-remembered-facts.md).
 *
 * A request that carries `?onlyRecorded=true` runs inside a scope; the Prisma client's query
 * hook (`db.ts`) then adds `provenance IS DISTINCT FROM 'remembered'` to every READ of the nine
 * provenance models inside it. So an endpoint needs no code of its own, and two endpoints cannot
 * disagree about what "belegt" means. An unknown provenance (every row older than the field) is
 * not a recollection and stays in — SQL's `<> 'remembered'` would drop those NULLs, hence the OR.
 *
 * Narrowed: `findMany/findFirst/findUnique/count/aggregate/groupBy` of the nine models, AND the
 * relations of any read that reach them — a to-many `include`/`select` and a `_count` of one get
 * the same predicate (a trip with its flights, a stay's lodging's stays). A to-one relation cannot
 * carry a filter in Prisma; it names the row the parent already points at, so it adds no entry to
 * any figure. Writes are never touched.
 *
 * The scope exists only on GETs of the prefixes in `RECORDED_ONLY_PREFIXES`, and ends with the
 * response: work a handler left running (a job it started) reads the whole population again.
 */
interface Store {
  done: boolean;
}
const scope = new AsyncLocalStorage<Store>();

/** Mirrors `RECORDED_ONLY_PREFIXES` in the frontend (`lib/stats/recordedOnly.ts`). */
export const RECORDED_ONLY_PREFIXES = [
  "/api/v1/stats",
  "/api/v1/achievements",
  "/api/v1/flights",
  "/api/v1/cruises",
  "/api/v1/trips",
  "/api/v1/rail",
  "/api/v1/bus",
  "/api/v1/ferry",
  "/api/v1/rentals",
  "/api/v1/lodging",
  "/api/v1/places",
] as const;

const MODELS = new Set([
  "Trip",
  "Flight",
  "LodgingStay",
  "RailJourney",
  "BusJourney",
  "FerryJourney",
  "RentalBooking",
  "Cruise",
  "PlaceVisit",
]);
const READS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * A parent that exists only through its entries — a lodging and its stays, a place and its visits
 * — disappears when it HAS entries and none of them is visible. One with no entries at all (a
 * noted or planned place) is not a recollection and stays.
 */
const PARENTS: Record<string, string> = { Lodging: "stays", Place: "visits" };

/**
 * A child row that carries no provenance of its own but exists only through its parent entry —
 * a cruise's stops and legs — is as remembered as that parent. A statistic that reads the stops
 * directly (the passport, a country's detail) would otherwise still count a remembered cruise's ports.
 */
const CHILDREN: Record<string, string> = { CruiseStop: "cruise", CruiseLeg: "cruise" };

const RECORDED = { OR: [{ provenance: null }, { provenance: { not: "remembered" } }] };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `where` plus a condition, kept as a SIBLING `AND` entry rather than wrapped: a `findUnique`
 * must keep its unique key at the top level of `where`.
 */
const andWhere = (where: unknown, condition: Json): Json => {
  const base = isObject(where) ? where : {};
  const existing = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, condition] };
};

const withRecorded = (where: unknown): Json => andWhere(where, RECORDED);

const withVisibleEntries = (model: string, where: unknown): Json =>
  andWhere(where, {
    NOT: {
      AND: [{ [PARENTS[model]]: { some: {} } }, { [PARENTS[model]]: { none: RECORDED } }],
    },
  });

/** Narrows `where` of a read of `model`, whichever kind of model it is. */
const narrowWhere = (model: string, where: unknown): Json =>
  MODELS.has(model)
    ? withRecorded(where)
    : model in PARENTS
      ? withVisibleEntries(model, where)
      : model in CHILDREN
        ? andWhere(where, { [CHILDREN[model]]: { is: RECORDED } })
        : (where as Json);

const narrowsModel = (model: string): boolean =>
  MODELS.has(model) || model in PARENTS || model in CHILDREN;

/** model -> relation name -> target, read once from the schema. */
let relations: Map<string, Map<string, { target: string; isList: boolean }>> | null = null;
function relationsOf(model: string): Map<string, { target: string; isList: boolean }> {
  if (!relations) relations = new Map();
  let r = relations.get(model);
  if (!r) {
    r = new Map(
      prismaModelFields(model)
        .filter((f) => f.kind === "object")
        .map((f) => [f.name, { target: f.type, isList: f.isList }] as const)
    );
    relations.set(model, r);
  }
  return r;
}

/** `include`/`select` of `model`: every relation that reaches a narrowed model is narrowed. */
function narrowSelection(model: string, selection: unknown): unknown {
  if (!isObject(selection)) return selection;
  const rel = relationsOf(model);
  const out: Json = {};
  for (const [key, value] of Object.entries(selection)) {
    if (key === "_count" && value !== false && value !== undefined && value !== null) {
      // `_count: true` counts every to-many relation; `{ select: { rel: true | { where } } }` the named ones.
      const named = isObject(value) && isObject(value.select) ? value.select : null;
      const names = named
        ? Object.keys(named)
        : [...rel].filter(([, r]) => r.isList).map(([name]) => name);
      const counted: Json = {};
      for (const name of names) {
        const v = named ? named[name] : true;
        const r = rel.get(name);
        if (v === false || v === undefined) counted[name] = v;
        else if (r && r.isList && narrowsModel(r.target)) {
          const base = isObject(v) ? v : {};
          counted[name] = { ...base, where: narrowWhere(r.target, base.where) };
        } else counted[name] = v;
      }
      out[key] = { ...(isObject(value) ? value : {}), select: counted };
      continue;
    }
    const r = rel.get(key);
    if (!r || value === false || value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    const narrowed = value === true ? {} : narrowArgs(r.target, value);
    if (r.isList && narrowsModel(r.target)) {
      out[key] = { ...narrowed, where: narrowWhere(r.target, narrowed.where) };
    } else out[key] = value === true ? true : narrowed;
  }
  return out;
}

/** The arguments of a read of `model`, with its relations narrowed (not the model itself). */
function narrowArgs(model: string, args: unknown): Json {
  if (!isObject(args)) return {};
  const out: Json = { ...args };
  if ("include" in args) out.include = narrowSelection(model, args.include);
  if ("select" in args) out.select = narrowSelection(model, args.select);
  return out;
}

/** Express middleware: opens the scope when the query asks for it, and removes the parameter. */
export function recordedOnlyScope(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" || !("onlyRecorded" in req.query)) {
    next();
    return;
  }
  const asked = req.query.onlyRecorded === "true";
  // Strict query schemas downstream must never see a parameter they do not know.
  delete req.query.onlyRecorded;
  if (!asked) {
    next();
    return;
  }
  const store: Store = { done: false };
  const end = (): void => {
    store.done = true;
  };
  res.once("finish", end);
  res.once("close", end);
  scope.run(store, next);
}

/** Called by the Prisma query hook with every operation's arguments. */
export function applyRecordedOnly<A>(model: string | undefined, operation: string, args: A): A {
  const store = scope.getStore();
  if (!store || store.done || !model || !READS.has(operation)) return args;
  const narrowed = narrowArgs(model, args);
  if (narrowsModel(model)) narrowed.where = narrowWhere(model, narrowed.where);
  return narrowed as A;
}

/** Test seam: is a recorded-only scope open right now? */
export function recordedOnlyActive(): boolean {
  const store = scope.getStore();
  return !!store && !store.done;
}

/** Test seam: runs `fn` inside an open scope, as the middleware would. */
export function runRecordedOnly<T>(fn: () => T): T {
  return scope.run({ done: false }, fn);
}
