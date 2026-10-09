/**
 * Lodging consumption of v2 templates (plan 2026-10-09 P4a).
 *
 * A v2 `lodging` template is generic extraction: it yields named values and
 * knows nothing about stays. This adapter is the one place those values
 * become a `ParsedLodgingBooking` — validated by Zod first, because a template
 * is community data and a value of the wrong type is a template defect, not
 * something to coerce — and then through the same `finishLodgingRead` the
 * user-template engine uses, so a stay means the same thing whoever wrote the
 * reader.
 *
 * The value names a lodging template may set are the keys of
 * {@link lodgingValuesSchema}; anything else it extracts (a helper such as
 * the subject's year) is ignored here.
 */
import { z } from "zod";
import logger from "../../../utils/logger";
import { LODGING_TYPES } from "../../../schemas/lodging";
import type { ParsedLodgingBooking } from "../bookingComTemplate";
import { applyTemplate } from "../../parsers/templates/v2/runners";
import type { TemplateEnvelope } from "../../parsers/templates/v2/envelope";
import { finishLodgingRead, type LodgingRead } from "./finishRead";

const text = z.string().min(1).nullish();
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();
const amount = z.number().finite().nonnegative().nullish();

export const lodgingValuesSchema = z.object({
  hotelName: text,
  checkIn: isoDay,
  checkOut: isoDay,
  roomCategory: text,
  address: text,
  city: text,
  postcode: text,
  country: text,
  totalPrice: amount,
  pricePerNight: amount,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  guests: z.number().int().nonnegative().nullish(),
  confirmationNumber: text,
  type: z.enum(LODGING_TYPES).nullish(),
  chainName: text,
});
export type LodgingValues = z.infer<typeof lodgingValuesSchema>;

const READ_KEYS = [
  "hotelName",
  "checkIn",
  "checkOut",
  "roomCategory",
  "address",
  "city",
  "postcode",
  "country",
  "totalPrice",
  "pricePerNight",
  "currency",
  "guests",
  "confirmationNumber",
] as const satisfies ReadonlyArray<keyof LodgingRead & keyof LodgingValues>;

/** `lodging:koa` → `koa`: the short name `parserTemplate` has always carried. */
export function lodgingTemplateName(template: TemplateEnvelope): string {
  return template.id.slice(template.id.indexOf(":") + 1);
}

/**
 * Read one document with one v2 lodging template, or decline (null).
 *
 * `subject` and `body` are joined exactly as the user-template engine joins
 * them, so a pattern anchored at the start of the text sees the subject.
 */
export function applyV2LodgingTemplate(
  template: TemplateEnvelope,
  subject: string,
  body: string
): ParsedLodgingBooking | null {
  if (template.domain !== "lodging") return null;
  const application = applyTemplate(template, `${subject}\n${body}`);
  if (!application.matched) return null;

  const parsed = lodgingValuesSchema.safeParse(application.values);
  if (!parsed.success) {
    logger.warn(
      {
        template: template.id,
        version: template.version,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      "v2 lodging template produced values of the wrong shape — declined"
    );
    return null;
  }
  const values = parsed.data;
  const read: LodgingRead = {};
  for (const key of READ_KEYS) {
    const value = values[key];
    if (value !== null && value !== undefined) read[key] = value;
  }
  return finishLodgingRead(read, {
    parserTemplate: lodgingTemplateName(template),
    checkOutYearBorrowed: template.extraction.fields?.checkOut?.yearFrom !== undefined,
    type: values.type ?? null,
    chainName: values.chainName ?? null,
  });
}

/** The first of `templates` that reads the document, in the order given. */
export function readWithV2LodgingTemplates(
  templates: readonly TemplateEnvelope[],
  subject: string,
  body: string
): ParsedLodgingBooking | null {
  for (const template of templates) {
    const hit = applyV2LodgingTemplate(template, subject, body);
    if (hit) return hit;
  }
  return null;
}
