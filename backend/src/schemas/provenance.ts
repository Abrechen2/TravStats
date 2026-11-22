import { z } from "./zod";

/**
 * Where an entry came from (docs/superpowers/specs/2026-11-22-remembered-facts.md).
 * `recorded`: a document, booking, track or import. `remembered`: typed in from
 * memory, dates approximate. Absent/null: unknown — every row older than the field.
 */
export const PROVENANCES = ["recorded", "remembered"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** The nine kinds of entry that can carry a provenance, in the names of their Prisma delegates. */
export const PROVENANCE_ENTRY_TYPES = [
  "trip",
  "flight",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
  "cruise",
  "placeVisit",
] as const;
export type ProvenanceEntryType = (typeof PROVENANCE_ENTRY_TYPES)[number];

export const MAX_REMEMBERED_NOTE = 500;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  // 2026-02-30 matches the pattern and would silently roll into March.
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a calendar day");

/**
 * The body of `PUT /provenance/:entryType/:id`. `provenance: null` clears the field (back to
 * unknown), and with it the date and the note — they belong to `remembered` only.
 */
export const setProvenanceSchema = z
  .object({
    provenance: z.enum(PROVENANCES).nullable(),
    rememberedOn: day.nullable().optional(),
    rememberedNote: z.string().trim().max(MAX_REMEMBERED_NOTE).nullable().optional(),
  })
  .strict()
  .refine((b) => b.provenance === "remembered" || (!b.rememberedOn && !b.rememberedNote), {
    message: "rememberedOn and rememberedNote belong to provenance 'remembered' only",
    path: ["provenance"],
  });
export type SetProvenanceInput = z.infer<typeof setProvenanceSchema>;
