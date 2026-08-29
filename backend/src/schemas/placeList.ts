import { z } from "zod";

/**
 * Lists and shipped checklists.
 *
 * Two things share one table on purpose: a hand-made list and a subscription to
 * a shipped checklist are the same kind of thing to everything that renders
 * one. What separates them is `curatedKey`, and these schemas encode the single
 * rule that follows from it — a subscribed list's NAME and MEMBERSHIP come from
 * the catalog, so only its presentation is editable. Enforcing that in the
 * route rather than here would leave the API's contract undocumented.
 */

/** Hex, because it is stored as one and `list` colour mode parses it as one. */
const colorField = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a 6-digit hex value like #5ec2b2");

/**
 * One emoji-ish grapheme, matching `Trip.icon`. Capped by length rather than by
 * a codepoint class: emoji are routinely several codepoints (ZWJ sequences,
 * skin-tone modifiers), and a stricter rule would reject 👨‍👩‍👧 while a
 * looser one is harmless — the value only ever renders as text.
 */
const iconField = z.string().trim().min(1).max(16).nullable().optional();

/**
 * How the map labels this list's places -- the list's DEFAULT only.
 *
 * Not nullable and not clearable: every list has an answer, and "no answer"
 * would just be a third spelling of "name". Absent means "leave it as it is",
 * which is what a PATCH that only changes the colour has to mean.
 */
const labelModeField = z.enum(["name", "icon"]).optional();

export const createPlaceListSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: colorField.optional(),
  icon: iconField,
  labelMode: labelModeField,
  sortIdx: z.number().int().min(0).optional(),
});

/**
 * No `name` here even though the column is writable.
 *
 * A subscribed checklist takes its name from the catalog, and letting the user
 * rename "Neue 7 Weltwunder" locally would make the achievement that measures
 * it report against a list nobody recognises. Hand-made lists rename through
 * the same route, so the field is accepted and the ROUTE rejects it for
 * subscribed ones — see `assertRenamable`.
 */
export const updatePlaceListSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    color: colorField.optional(),
    icon: iconField,
    labelMode: labelModeField,
    sortIdx: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const addListEntrySchema = z.object({
  placeId: z.string().uuid(),
  sortIdx: z.number().int().min(0).optional(),
});

/**
 * Reordering ships as one call rather than N PATCHes: a drag that lands three
 * rows further down renumbers every row between, and doing that as separate
 * requests leaves the list visibly wrong if one of them fails.
 */
export const reorderListEntriesSchema = z.object({
  placeIds: z.array(z.string().uuid()).min(1).max(1000),
});

export const placeListQuerySchema = z.object({
  /** Include the entries themselves; the index only needs the counts. */
  withEntries: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type CreatePlaceListInput = z.infer<typeof createPlaceListSchema>;
export type UpdatePlaceListInput = z.infer<typeof updatePlaceListSchema>;
export type AddListEntryInput = z.infer<typeof addListEntrySchema>;
export type ReorderListEntriesInput = z.infer<typeof reorderListEntriesSchema>;
