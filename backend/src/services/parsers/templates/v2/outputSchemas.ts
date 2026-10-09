/**
 * The `output` blocks a domain consumer reads (plan 2026-10-09 P4b), checked
 * when the template is VALIDATED — a malformed block refuses the template at
 * load, rather than loading it and then declining every document it is shown.
 *
 * A domain without an entry takes no `output` at all.
 */
import { z } from "zod";

/** Lodging fields whose absence a template may ask `missing` to report. */
export const LODGING_REPORTABLE_FIELDS = [
  "roomCategory",
  "address",
  "postcode",
  "city",
  "country",
  "totalPrice",
  "pricePerNight",
  "guests",
  "confirmationNumber",
] as const;
export type LodgingReportableField = (typeof LODGING_REPORTABLE_FIELDS)[number];

/**
 * Lodging: the confidence figures (complete / something missing) and which
 * absent fields `missing` reports, in order. Booking.com reports a missing
 * room and says 95 / 80; the default is city, total, number and 75 / 65.
 */
export const lodgingOutputSchema = z
  .object({
    report: z
      .array(z.enum(LODGING_REPORTABLE_FIELDS))
      .max(LODGING_REPORTABLE_FIELDS.length)
      .optional(),
    confidence: z
      .object({
        complete: z.number().int().min(0).max(100),
        partial: z.number().int().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LodgingOutput = z.infer<typeof lodgingOutputSchema>;

export const OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  lodging: lodgingOutputSchema,
};
