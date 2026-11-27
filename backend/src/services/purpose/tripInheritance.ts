import { purposeFromTripCategory } from "../../shared/purpose";
import { purposeKeyFromTripCategory } from "../../shared/purposeCatalogue";

/** The Prisma models that carry a purpose. */
export const PURPOSE_MODELS = new Set([
  "PlaceVisit",
  "Flight",
  "LodgingStay",
  "RailJourney",
  "BusJourney",
  "FerryJourney",
  "RentalBooking",
  "Cruise",
  "TripRoute",
]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Looks up the category of a trip; injected by `db.ts` (the unextended client, no scope). */
export type TripCategoryLookup = (tripId: string) => Promise<string | null>;

function tripIdOf(data: Json): string | null {
  if (typeof data.tripId === "string") return data.tripId;
  const trip = data.trip;
  if (isObject(trip) && isObject(trip.connect) && typeof trip.connect.id === "string") {
    return trip.connect.id;
  }
  return null;
}

async function withPurpose(
  data: Json,
  lookup: TripCategoryLookup,
  cache: Map<string, string | null>
) {
  // A purpose sent either way — the kind or the detail — is the caller's choice, never the trip's.
  if (data.purpose !== undefined || data.purposeKey !== undefined) return data;
  const tripId = tripIdOf(data);
  if (!tripId) return data;
  if (!cache.has(tripId)) cache.set(tripId, await lookup(tripId));
  const category = cache.get(tripId) ?? null;
  const purpose = purposeFromTripCategory(category);
  // The detail travels too (vacation -> "Urlaub", weekend -> "Kurztrip & Wochenende").
  return purpose ? { ...data, purpose, purposeKey: purposeKeyFromTripCategory(category) } : data;
}

/**
 * A new entry created inside a trip starts with the purpose the trip's category implies
 * (business -> business; vacation/weekend/family -> private; other or none -> unknown), unless the
 * caller sent one. A starting value only: it is never re-derived when the trip changes. Done at
 * the one place every write passes (the Prisma hook), so a form, an import, a mail and the
 * Companion agree.
 */
export async function inheritPurposeOnCreate<A>(
  model: string | undefined,
  operation: string,
  args: A,
  lookup: TripCategoryLookup
): Promise<A> {
  if (!model || !PURPOSE_MODELS.has(model)) return args;
  if (operation !== "create" && operation !== "createMany" && operation !== "createManyAndReturn") {
    return args;
  }
  if (!isObject(args) || !("data" in args)) return args;
  const cache = new Map<string, string | null>();
  const data = (args as Json).data;
  if (Array.isArray(data)) {
    const rows = [];
    for (const row of data) rows.push(isObject(row) ? await withPurpose(row, lookup, cache) : row);
    return { ...args, data: rows };
  }
  if (!isObject(data)) return args;
  return { ...args, data: await withPurpose(data, lookup, cache) };
}
