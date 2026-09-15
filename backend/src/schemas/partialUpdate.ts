import { z } from "./zod";

/**
 * Build the PATCH counterpart of a create schema: every field optional, and no
 * field invented when the client did not send it.
 *
 * `.partial()` alone is not that any more. Under zod 3 an absent key
 * short-circuited the whole field, so a `.default()` inside it never ran and
 * the parsed body contained exactly the keys the client sent. Under zod 4 the
 * default fires regardless, and the route then writes it.
 *
 * Measured on the five update schemas that carry top-level defaults, parsing an
 * EMPTY body:
 *
 *   updateFlightSchema  -> { status: "scheduled", companions: [],
 *                            aerodataboxQualityTags: [] }
 *   updateCruiseSchema  -> { status: "planned" }
 *   updateLodgingSchema -> { type: ... }
 *   updateStaySchema    -> { status: "completed" }
 *   updatePlaceSchema   -> { category: ..., visited: ... }
 *
 * So `PATCH /flights/:id` with `{ notes: "x" }` would have reset a flown flight
 * to "scheduled" and dropped its companions — silently, because every one of
 * those is a legitimate value the client never asked for. Two suites caught the
 * empty-body half of it ("rejects empty updates"); nothing would have caught
 * the far worse half, a one-field PATCH overwriting three others.
 *
 * Stripping is deliberately SHALLOW. A default nested inside a field the client
 * did send is part of that value's own shape and still applies — the question
 * this answers is only "did the client supply this field at all".
 */
export function partialForUpdate<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
  const stripped: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(schema.shape)) {
    const field = schema.shape[key] as z.ZodTypeAny;
    stripped[key] =
      field instanceof z.ZodDefault || field instanceof z.ZodPrefault
        ? (field.unwrap() as z.ZodTypeAny)
        : field;
  }
  return z
    .object(stripped)
    .partial() as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
