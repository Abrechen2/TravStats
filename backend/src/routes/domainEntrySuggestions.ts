import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import { escapeLike, rankedColumn } from "../services/entrySuggestions/ranked";
import { terminalsFor, type TerminalSuggestion } from "../services/entrySuggestions/terminals";

/**
 * "Forms suggest what you entered before" for the domains that had none
 * (forgejo#405): ferry, rental, cruise and places — the bus/rail/flight/lodging
 * endpoints' sibling. Four routers in one file because each is a handful of
 * ranked columns over the user's own rows; each mounts FIRST on its domain's
 * prefix (a domain router's `/:id` would read "entry-suggestions" as an id).
 *
 * Offered, never written: a chip fills a field only when clicked, so everything
 * returned is a value some earlier row of THIS user stored. Enveloped, like the
 * bus family; the stats rate-limit bucket (several aggregations, asked when a
 * field settles, not per keystroke). An empty logbook is an empty answer.
 */

const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const typed = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Run a loader behind the shared auth + limiter + query parsing + envelope. */
function suggestionsRouter<Q extends z.ZodTypeAny, R>(
  schema: Q,
  load: (userId: string, query: z.infer<Q>) => Promise<R>
): Router {
  const router = Router();
  router.use(authenticate);
  router.get(
    "/",
    statsLimiter,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = schema.safeParse(req.query);
        if (!parsed.success) throw new AppError(parsed.error.message, 400);
        const data = await load((req as AuthRequest).userId!, parsed.data);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );
  return router;
}

/** The rows of one value of a column, matched case-insensitively (a form's typed text). */
const same = (field: string, value: string | undefined): object =>
  value ? { [field]: { equals: value, mode: "insensitive" } } : {};

// ─── Ferry ──────────────────────────────────────────────────────────────────

export const ferryEntrySuggestionsQuerySchema = z.object({
  depName: typed(200),
  arrName: typed(200),
  operator: typed(100),
});

export interface FerryEntrySuggestions {
  operators: string[];
  vessels: string[];
  fareClasses: string[];
  cabinTypes: string[];
  terminals: TerminalSuggestion[];
}

export async function loadFerryEntrySuggestions(
  userId: string,
  query: z.infer<typeof ferryEntrySuggestionsQuerySchema>
): Promise<FerryEntrySuggestions> {
  const forOperator = { userId, ...same("operator", query.operator) };
  const d = prisma.ferryJourney;
  const [operators, vessels, fareClasses, cabinTypes, terminals] = await Promise.all([
    rankedColumn(d, "operator", { userId }, 5),
    rankedColumn(d, "vesselName", forOperator, 5),
    rankedColumn(d, "fareClass", forOperator, 4),
    rankedColumn(d, "cabinType", forOperator, 4),
    terminalsFor(d, userId, query),
  ]);
  return { operators, vessels, fareClasses, cabinTypes, terminals };
}

export const ferryEntrySuggestionsRouter = suggestionsRouter(
  ferryEntrySuggestionsQuerySchema,
  loadFerryEntrySuggestions
);

// ─── Rental ─────────────────────────────────────────────────────────────────

export const rentalEntrySuggestionsQuerySchema = z.object({ provider: typed(120) });

export interface RentalEntrySuggestions {
  providers: string[];
  brokers: string[];
  vehicleClasses: string[];
  vehicleExamples: string[];
}

/**
 * Stations are NOT here: `/rentals/stations` already searches airports and the
 * user's earlier stations. What was missing is the free text a counter prints.
 */
export async function loadRentalEntrySuggestions(
  userId: string,
  query: z.infer<typeof rentalEntrySuggestionsQuerySchema>
): Promise<RentalEntrySuggestions> {
  const forProvider = { userId, ...same("provider", query.provider) };
  const d = prisma.rentalBooking;
  const [providers, brokers, vehicleClasses, vehicleExamples] = await Promise.all([
    rankedColumn(d, "provider", { userId }, 5, false),
    rankedColumn(d, "broker", { userId }, 5),
    rankedColumn(d, "vehicleClass", forProvider, 5),
    rankedColumn(d, "vehicleExample", forProvider, 5),
  ]);
  return { providers, brokers, vehicleClasses, vehicleExamples };
}

export const rentalEntrySuggestionsRouter = suggestionsRouter(
  rentalEntrySuggestionsQuerySchema,
  loadRentalEntrySuggestions
);

// ─── Cruise ─────────────────────────────────────────────────────────────────

export const cruiseEntrySuggestionsQuerySchema = z.object({ cruiseLine: typed(120) });

export interface CruiseEntrySuggestions {
  cruiseLines: string[];
  shipNames: string[];
  cabinTypes: string[];
}

/**
 * Cruise lines, the ships typed by hand (a ship the catalogue does not know
 * is stored as an override) and the cabin types used — the last two narrowed to
 * the line typed, since a cabin vocabulary belongs to its line.
 */
export async function loadCruiseEntrySuggestions(
  userId: string,
  query: z.infer<typeof cruiseEntrySuggestionsQuerySchema>
): Promise<CruiseEntrySuggestions> {
  const forLine = { userId, ...same("cruiseLine", query.cruiseLine) };
  const d = prisma.cruise;
  const [cruiseLines, shipNames, cabinTypes] = await Promise.all([
    rankedColumn(d, "cruiseLine", { userId }, 5),
    rankedColumn(d, "shipNameOverride", forLine, 5),
    rankedColumn(d, "cabinType", forLine, 5),
  ]);
  return { cruiseLines, shipNames, cabinTypes };
}

export const cruiseEntrySuggestionsRouter = suggestionsRouter(
  cruiseEntrySuggestionsQuerySchema,
  loadCruiseEntrySuggestions
);

// ─── Places ─────────────────────────────────────────────────────────────────

export const placeEntrySuggestionsQuerySchema = z.object({ city: typed(120), country: typed(120) });

export interface PlaceEntrySuggestions {
  cities: Array<{ city: string; country: string | null; isoCountryCode: string | null }>;
  countries: Array<{ country: string; isoCountryCode: string | null }>;
}

const PLACE_CAP = 6;

/**
 * Cities and countries of the user's own places that start with what is typed,
 * most used first. A pick fills city, country and the ISO code together (a
 * choice carries its data), so a place typed by hand is not left without the
 * code its country statistics read.
 */
export async function loadPlaceEntrySuggestions(
  userId: string,
  query: z.infer<typeof placeEntrySuggestionsQuerySchema>
): Promise<PlaceEntrySuggestions> {
  const prefix = (field: string, value: string | undefined): object =>
    value ? { [field]: { startsWith: escapeLike(value), mode: "insensitive" } } : {};
  const [cities, countries] = await Promise.all([
    prisma.place.groupBy({
      by: ["city", "country", "isoCountryCode"],
      where: {
        userId,
        city: { not: null },
        NOT: { city: "" },
        ...prefix("city", query.city),
        ...(query.country ? same("country", query.country) : {}),
      },
      _count: { _all: true },
      orderBy: [{ _count: { city: "desc" } }, { city: "asc" }],
      take: PLACE_CAP,
    }),
    prisma.place.groupBy({
      by: ["country", "isoCountryCode"],
      where: {
        userId,
        country: { not: null },
        NOT: { country: "" },
        ...prefix("country", query.country),
      },
      _count: { _all: true },
      orderBy: [{ _count: { country: "desc" } }, { country: "asc" }],
      take: PLACE_CAP,
    }),
  ]);
  return {
    cities: cities.map((c) => ({
      city: (c.city ?? "").trim(),
      country: c.country,
      isoCountryCode: c.isoCountryCode,
    })),
    countries: countries.map((c) => ({
      country: (c.country ?? "").trim(),
      isoCountryCode: c.isoCountryCode,
    })),
  };
}

export const placeEntrySuggestionsRouter = suggestionsRouter(
  placeEntrySuggestionsQuerySchema,
  loadPlaceEntrySuggestions
);
