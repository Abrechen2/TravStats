import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";

import { prismaModelFields } from "../openapi/prismaDatamodel";
import type { PurposeVisibility } from "../../shared/purpose";

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
 * The scope exists only on GETs of the prefixes in `ENTRY_SCOPE_PREFIXES`, and ends with the
 * response: work a handler left running (a job it started) reads the whole population again.
 *
 * It is also the ONE entry filter behind "Geschäftliche ausblenden" / "Private ausblenden"
 * (docs/superpowers/specs/2026-11-22-private-business-purpose.md): the user's per-domain
 * `purposeVisibility` is loaded once the request is authenticated (`openPurposeVisibility`) and
 * narrows the eight purpose models in the same hook, so a list, a map, a statistic and the
 * activity feed all see the same population. An entry with no purpose is never hidden.
 */
interface Store {
  done: boolean;
  /** `?onlyRecorded=true` was asked for. */
  recorded: boolean;
  /** Purposes hidden per Prisma model, set after authentication; null until then. */
  hidden: Record<string, string[]> | null;
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

/**
 * Where the scope opens: the recorded-only prefixes plus the reads that merge several domains
 * (the activity feed, what is coming up, a map card). A hidden purpose has to reach all of them,
 * or two screens of one account would count different entries.
 */
export const ENTRY_SCOPE_PREFIXES = [
  ...RECORDED_ONLY_PREFIXES,
  "/api/v1/activity",
  "/api/v1/upcoming",
  "/api/v1/map-details",
  "/api/v1/gap-calendar",
  "/api/v1/me/life-book",
  "/api/v1/companions",
  "/api/v1/trip-suggestions",
  "/api/v1/search",
  // Tours and roadtrips carry a purpose of their own (trip_routes), and the suggestion inboxes
  // read the same logbook: a hidden entry must not be proposed or counted from there either.
  "/api/v1/tours",
  "/api/v1/roadtrips",
  "/api/v1/place-lists",
  "/api/v1/dawarich-stays",
  "/api/v1/location-suggestions",
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
const PARENT_CHILD_MODEL: Record<string, string> = { Lodging: "LodgingStay", Place: "PlaceVisit" };
const CHILD_PARENT_MODEL: Record<string, string> = { CruiseStop: "Cruise", CruiseLeg: "Cruise" };

/** The purpose models, with the domain whose `purposeVisibility` row governs them. */
const PURPOSE_MODEL_DOMAIN: Record<string, keyof PurposeVisibility> = {
  PlaceVisit: "poi",
  Flight: "flight",
  LodgingStay: "lodging",
  RailJourney: "rail",
  BusJourney: "bus",
  FerryJourney: "ferry",
  RentalBooking: "rental",
  Cruise: "cruise",
};

/**
 * A tour or a roadtrip is one model (`TripRoute`) with two domains: the kind says which setting
 * governs the row. The hidden store keys them `TripRoute:<kind>`.
 */
export const PURPOSE_ROUTE_KIND_DOMAIN: Record<string, keyof PurposeVisibility> = {
  tour: "tour",
  roadtrip: "roadtrip",
};
export const routeHiddenKey = (kind: string): string => `TripRoute:${kind}`;

/** Every model whose rows a purpose can hide. */
const PURPOSE_FILTERED_MODELS = new Set([...Object.keys(PURPOSE_MODEL_DOMAIN), "TripRoute"]);

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

/** What a read of each model is narrowed by right now; a model that is absent is not narrowed. */
type Active = Map<string, Json>;

/** The entry's own condition: not remembered (when asked), and not a hidden purpose. */
function entryCondition(store: Store, model: string): Json | null {
  const parts: Json[] = [];
  if (store.recorded && MODELS.has(model)) parts.push(RECORDED);
  if (model === "TripRoute") {
    for (const kind of Object.keys(PURPOSE_ROUTE_KIND_DOMAIN)) {
      const hiddenKind = store.hidden?.[routeHiddenKey(kind)];
      if (hiddenKind && hiddenKind.length > 0) {
        parts.push({
          OR: [{ kind: { not: kind } }, { purpose: null }, { purpose: { notIn: hiddenKind } }],
        });
      }
    }
  }
  const hidden = store.hidden?.[model];
  if (hidden && hidden.length > 0) {
    parts.push({ OR: [{ purpose: null }, { purpose: { notIn: hidden } }] });
  }
  return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { AND: parts };
}

/**
 * A trip drops out when it HAS entries in the purpose domains and none of them is visible. A trip
 * with no entries at all (planned, or only tours and expenses) is not touched.
 */
function tripThroughEntries(own: Map<string, Json>): Json | null {
  const purposeRelations = [...relationsOf("Trip")].filter(
    ([, r]) => r.isList && PURPOSE_FILTERED_MODELS.has(r.target)
  );
  const filtered = purposeRelations.some(
    ([, r]) => own.has(r.target) && hasPurposeCond(own, r.target)
  );
  if (!filtered) return null;
  return {
    NOT: {
      AND: [
        { OR: purposeRelations.map(([name]) => ({ [name]: { some: {} } })) },
        ...purposeRelations.map(([name, r]) => ({ [name]: { none: visibleOf(own, r.target) } })),
      ],
    },
  };
}

/** Does the condition of this model come from a hidden purpose (not only from "nur belegte")? */
function hasPurposeCond(own: Map<string, Json>, model: string): boolean {
  return JSON.stringify(own.get(model)).includes('"purpose"');
}

const visibleOf = (own: Map<string, Json>, model: string): Json => own.get(model) ?? {};

/** The conditions of one request: entries, the parents that live through them, and the children. */
function activeConditions(store: Store): Active {
  const active: Active = new Map();
  const own = new Map<string, Json>();
  for (const model of [...MODELS, ...PURPOSE_FILTERED_MODELS]) {
    const c = entryCondition(store, model);
    if (c) own.set(model, c);
  }
  for (const [model, c] of own) active.set(model, c);
  // A trip that exists only through entries the purpose filter hides is hidden with them, so a
  // trip count, a trip country and the days away agree with the entries left on screen.
  const tripCond = tripThroughEntries(own);
  if (tripCond) {
    const ownTrip = own.get("Trip");
    active.set("Trip", ownTrip ? { AND: [ownTrip, tripCond] } : tripCond);
  }
  // Lodging -> LodgingStay, Place -> PlaceVisit.
  for (const [parent, relation] of Object.entries(PARENTS)) {
    const child = PARENT_CHILD_MODEL[parent];
    const c = own.get(child);
    if (c) {
      active.set(parent, {
        NOT: { AND: [{ [relation]: { some: {} } }, { [relation]: { none: c } }] },
      });
    }
  }
  for (const [child, relation] of Object.entries(CHILDREN)) {
    const c = own.get(CHILD_PARENT_MODEL[child]);
    if (c) active.set(child, { [relation]: { is: c } });
  }
  return active;
}

/** Narrows `where` of a read of `model`. */
const narrowWhere = (active: Active, model: string, where: unknown): Json => {
  const c = active.get(model);
  return c ? andWhere(where, c) : (where as Json);
};

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
function narrowSelection(active: Active, model: string, selection: unknown): unknown {
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
        else if (r && r.isList && active.has(r.target)) {
          const base = isObject(v) ? v : {};
          counted[name] = { ...base, where: narrowWhere(active, r.target, base.where) };
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
    const narrowed = value === true ? {} : narrowArgs(active, r.target, value);
    if (r.isList && active.has(r.target)) {
      out[key] = { ...narrowed, where: narrowWhere(active, r.target, narrowed.where) };
    } else out[key] = value === true ? true : narrowed;
  }
  return out;
}

/** The arguments of a read of `model`, with its relations narrowed (not the model itself). */
function narrowArgs(active: Active, model: string, args: unknown): Json {
  if (!isObject(args)) return {};
  const out: Json = { ...args };
  if ("include" in args) out.include = narrowSelection(active, model, args.include);
  if ("select" in args) out.select = narrowSelection(active, model, args.select);
  return out;
}

/** Express middleware: opens the scope on every GET it is mounted on, and removes the parameter. */
export function recordedOnlyScope(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET") {
    next();
    return;
  }
  const asked = "onlyRecorded" in req.query && req.query.onlyRecorded === "true";
  // Strict query schemas downstream must never see a parameter they do not know.
  delete req.query.onlyRecorded;
  const store: Store = { done: false, recorded: asked, hidden: null };
  const end = (): void => {
    store.done = true;
  };
  res.once("finish", end);
  res.once("close", end);
  scope.run(store, next);
}

/** Joins the user's hidden purposes (per Prisma model) to the open scope; no scope, no effect. */
export function setScopeHidden(hidden: Record<string, string[]>): void {
  const store = scope.getStore();
  if (store && !store.done) store.hidden = hidden;
}

/** Prisma model -> the domain whose `purposeVisibility` row governs it. */
export const purposeDomainOfModel = (model: string): keyof PurposeVisibility | undefined =>
  PURPOSE_MODEL_DOMAIN[model];

/** Called by the Prisma query hook with every operation's arguments. */
export function applyRecordedOnly<A>(model: string | undefined, operation: string, args: A): A {
  const store = scope.getStore();
  if (!store || store.done || !model || !READS.has(operation)) return args;
  const active = activeConditions(store);
  if (active.size === 0) return args;
  const narrowed = narrowArgs(active, model, args);
  if (active.has(model)) narrowed.where = narrowWhere(active, model, narrowed.where);
  return narrowed as A;
}

/** Test seam: is a recorded-only scope open right now? */
export function recordedOnlyActive(): boolean {
  const store = scope.getStore();
  return !!store && !store.done && store.recorded;
}

/** The filters open right now (recorded-only, hidden purposes per model). Raw SQL asks this. */
export function entryFilterActive(): {
  open: boolean;
  recorded: boolean;
  hidden: Record<string, string[]>;
} {
  const store = scope.getStore();
  if (!store || store.done) return { open: false, recorded: false, hidden: {} };
  return { open: true, recorded: store.recorded, hidden: store.hidden ?? {} };
}

/** Test seam: runs `fn` inside an open scope, as the middleware would. */
export function runRecordedOnly<T>(fn: () => T): T {
  return scope.run({ done: false, recorded: true, hidden: null }, fn);
}

/** Test seam: runs `fn` in a scope that hides these purposes per Prisma model. */
export function runWithHiddenPurposes<T>(
  hidden: Record<string, string[]>,
  fn: () => T,
  recorded = false
): T {
  return scope.run({ done: false, recorded, hidden }, fn);
}

/** Runs `fn` with no filter at all — for the counts of what a filter hides. */
export function runUnfiltered<T>(fn: () => T): T {
  return scope.run({ done: false, recorded: false, hidden: null }, fn);
}
