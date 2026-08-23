import { z } from "zod";
import { PLACE_CATEGORIES } from "../shared/placeCategories";

// Accept partial datetimes and coerce to full ISO 8601, mirroring
// schemas/cruise.ts and schemas/lodging.ts.
const isoDateTime = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}, z.string().datetime());

/**
 * `.nullable()` on every field the editors can explicitly CLEAR — an emitted
 * `null` must round-trip as "delete this value", distinct from an omitted key
 * ("leave it alone"). Same contract lodging settled on in its finding 4.
 */
const clearableText = (max: number) => z.string().max(max).nullable().optional();

/** Strips tags the same way the lodging notes field does. */
const notesField = z
  .string()
  .max(5000)
  .transform((v) => v.replace(/<[^>]*>/g, ""))
  .nullable()
  .optional();

/**
 * `lat`/`lon` are REQUIRED on create, unlike Lodging's.
 *
 * A place that cannot be drawn defeats the domain, and every creation path
 * (search hit, map click, manual coordinates) already produces a position.
 * Making them optional here would let the UI create rows the map silently
 * drops — the class of bug where the feature "works" and the user sees
 * nothing.
 */
const latField = z.number().min(-90).max(90);
const lonField = z.number().min(-180).max(180);

const basePlaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(PLACE_CATEGORIES).default("other"),
  lat: latField,
  lon: lonField,
  address: clearableText(300),
  city: clearableText(120),
  country: clearableText(120),
  externalRef: clearableText(200),
  notes: notesField,
  /**
   * Defaults to FALSE — the opposite of Lodging.visited, on purpose. The
   * dominant creation path here is "add a target to a list", and a wishlist
   * entry silently counted as visited would inflate "Orte besucht" on day one.
   * The "I was here" path must therefore say so explicitly.
   */
  visited: z.boolean().default(false),
});

export const createPlaceSchema = basePlaceSchema;

/**
 * PATCH is partial, but `lat`/`lon` stay non-nullable when present: a place
 * may be MOVED, never stripped of its position.
 */
export const updatePlaceSchema = basePlaceSchema.partial().extend({
  lat: latField.optional(),
  lon: lonField.optional(),
});

const ratingField = z.number().int().min(1).max(5).nullable().optional();

export const createVisitSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  /** Nullable on purpose: a visit you cannot date is still a visit. */
  visitedAt: isoDateTime.nullable().optional(),
  orderIdx: z.number().int().min(0).max(10000).optional(),
  notes: notesField,
  rating: ratingField,
});

export const updateVisitSchema = createVisitSchema.partial();

/**
 * List query. `visited` is a tri-state on the wire — absent means "everything",
 * which is what the list page shows by default so a wishlist entry is never
 * invisible in the one view that is supposed to contain it.
 */
export const placeQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(PLACE_CATEGORIES).optional(),
  country: z.string().max(120).optional(),
  visited: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  tripId: z.string().uuid().optional(),
  sortBy: z.enum(["name", "city", "category", "visitCount", "lastVisit", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
export type UpdatePlaceInput = z.infer<typeof updatePlaceSchema>;
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
export type PlaceQueryInput = z.infer<typeof placeQuerySchema>;
