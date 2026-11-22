import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";

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
 * Only reads are narrowed: a write, `findUnique` and nested `include`s are left alone. The scope
 * exists only on GETs of the prefixes in `RECORDED_ONLY_PREFIXES`.
 */
const scope = new AsyncLocalStorage<{ onlyRecorded: true }>();

/** What the statistics page reads: the stats routes plus the lists it computes figures from. */
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
  "count",
  "aggregate",
  "groupBy",
]);

const RECORDED = { OR: [{ provenance: null }, { provenance: { not: "remembered" } }] };

/** Express middleware: opens the scope when the query asks for it, and removes the parameter. */
export function recordedOnlyScope(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== "GET" || !("onlyRecorded" in req.query)) {
    next();
    return;
  }
  const asked = req.query.onlyRecorded === "true";
  // Strict query schemas downstream must never see a parameter they do not know.
  delete req.query.onlyRecorded;
  if (asked) scope.run({ onlyRecorded: true }, next);
  else next();
}

/** Called by the Prisma query hook with every operation's arguments. */
export function applyRecordedOnly<A>(model: string | undefined, operation: string, args: A): A {
  if (!scope.getStore() || !model || !MODELS.has(model) || !READS.has(operation)) return args;
  const a = (args ?? {}) as { where?: object };
  return { ...a, where: { AND: [a.where ?? {}, RECORDED] } } as A;
}
