import { z } from "./zod";
import { isLocalDate } from "../shared/time/localDate";

/**
 * What the Companion keeps on the server that used to live on the phone only
 * (Companion audit 2026-10-23): a trip's packing list, the home place and the
 * passport's expiry. Validated here and nowhere else.
 */

/**
 * The Companion's own limit for adding items (`app/src/lib/packing.ts`). A
 * merged trip may hold more (the merge drops nothing): a write is refused only
 * when it is over this AND longer than the stored list (`tripPacking.ts`).
 */
export const PACKING_MAX_ITEMS = 200;
export const PACKING_MAX_LABEL = 120;

export const packingItemSchema = z.object({
  /** The client's id for the row, stable across edits and devices. */
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(PACKING_MAX_LABEL),
  done: z.boolean(),
});

export type PackingItem = z.infer<typeof packingItemSchema>;

export const putPackingListSchema = z.object({
  // No item cap here: the cap depends on the stored list (`tripPacking.ts` —
  // over PACKING_MAX_ITEMS only while it does not grow), because a trip merge
  // drops nothing and may leave a list no fixed cap would let anyone edit.
  // The JSON body limit bounds what one request can carry at all.
  items: z
    .array(packingItemSchema)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: "Every item id appears once",
    }),
  /** The `rev` the client's edit started from; 0 when it saw no list. */
  baseRev: z.number().int().min(0),
  /** The client's id for this write — a resend after a lost answer carries the same one. */
  mutationId: z.string().trim().min(1).max(100),
});

export type PutPackingList = z.infer<typeof putPackingListSchema>;

export const homePlaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  /** IANA zone when the source knew one (an airport does). */
  zone: z.string().trim().min(1).max(64).nullable(),
});

export type HomePlace = z.infer<typeof homePlaceSchema>;

export const putPersonalSettingsSchema = z
  .object({
    /** `null` clears it; absent leaves it alone. */
    homePlace: homePlaceSchema.nullable().optional(),
    /** A calendar day `YYYY-MM-DD`; `null` clears it. */
    passportExpiry: z
      .string()
      .refine(isLocalDate, "A calendar day, YYYY-MM-DD")
      .nullable()
      .optional(),
    /**
     * Write each named field only where the server holds none yet — the
     * Companion's one-time upload of what it kept before the server could.
     * Decided per field in one statement, so two phones racing cannot both win.
     */
    onlyIfEmpty: z.boolean().optional(),
  })
  .strict();

export type PutPersonalSettings = z.infer<typeof putPersonalSettingsSchema>;
