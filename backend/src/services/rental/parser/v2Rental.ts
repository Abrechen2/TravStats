/**
 * Rental consumption of v2 templates (plan 2026-10-09 P4b): the one place a
 * `rental` template's values become a `ParsedRentalConfirmation` or a
 * `ParsedRentalInvoice`.
 *
 * Values are validated by Zod first — a template is community data, and a
 * value of the wrong type is a template defect, not something to coerce. What
 * is decided here is what the values MEAN for a rental, the same for every
 * provider:
 *
 * - `kind` (a constant the template sets) says which document it reads;
 * - a currency is only stated beside an amount;
 * - inclusions are the codes the template names (comma-separated per item),
 *   in first-seen order, and only codes the schema knows;
 * - a final invoice's vehicle row counts only when its own arithmetic holds
 *   (km in − km out = driven): the row is the proof it was read right. One car
 *   gives an odometer pair, a swap gives none — and the driven km add up.
 */
import { z } from "zod";
import logger from "../../../utils/logger";
import { RENTAL_INCLUSIONS, RENTAL_PAYMENT_TIMINGS } from "../../../schemas/rental";
import type { TemplateEnvelope, TemplateTestInput } from "../../parsers/templates/v2/envelope";
import { applyTemplate } from "../../parsers/templates/v2/runners";
import type { ParsedRentalConfirmation, ParsedRentalInvoice } from "./types";

const text = z.string().min(1).nullish();
const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
  .nullish();
const money = z.number().finite().nonnegative().nullish();
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .nullish();

const common = {
  provider: z.string().min(1),
  confirmationNumber: text,
};

const confirmationSchema = z.object({
  ...common,
  kind: z.literal("confirmation"),
  confirmationNumber: z.string().min(1),
  pickupStation: z.string().min(1),
  pickupLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  returnStation: z.string().min(1),
  returnLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  vehicleClass: text,
  vehicleExample: text,
  acrissCode: text,
  paymentTiming: z.enum(RENTAL_PAYMENT_TIMINGS).nullish(),
  price: money,
  currency,
  mileagePolicy: z.enum(["unlimited", "capped"]).nullish(),
  placeCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  inclusions: z
    .array(z.object({ code: text }))
    .max(50)
    .optional(),
  airportWords: z
    .array(z.object({ word: text }))
    .max(50)
    .optional(),
});

const vehicleRow = z.object({
  odometerOut: z.number().int().nonnegative().nullish(),
  odometerIn: z.number().int().nonnegative().nullish(),
  driven: z.number().int().nonnegative().nullish(),
  model: text,
});

const invoiceSchema = z.object({
  ...common,
  kind: z.literal("invoice"),
  agreementNumber: text,
  invoiceNumber: text,
  actualPickupLocal: localTime,
  actualReturnLocal: localTime,
  finalAmount: money,
  finalCurrency: currency,
  vehicles: z.array(vehicleRow).max(20).optional(),
  fees: z
    .array(z.object({ label: text, amount: money }))
    .max(30)
    .optional(),
});

export type RentalTemplateKind = "confirmation" | "invoice";

/** The document kind a rental template reads: its constant `kind` field. */
export function rentalTemplateKind(template: TemplateEnvelope): RentalTemplateKind | null {
  const kind = template.extraction.fields?.kind?.value;
  return kind === "confirmation" || kind === "invoice" ? kind : null;
}

/** `rental:sixt-invoice` → `sixt-invoice`: the name `parserTemplate` and `source` carry. */
export function rentalTemplateName(template: TemplateEnvelope): string {
  return template.id.slice(template.id.indexOf(":") + 1);
}

const nn = <T>(value: T | null | undefined): T | null => value ?? null;

type Inclusion = (typeof RENTAL_INCLUSIONS)[number];

function inclusionsOf(items: Array<{ code?: string | null }> | undefined): Inclusion[] {
  const known = new Set<string>(RENTAL_INCLUSIONS);
  const found = new Set<Inclusion>();
  for (const item of items ?? []) {
    for (const code of (item.code ?? "").split(",").map((c) => c.trim())) {
      if (known.has(code)) found.add(code as Inclusion);
    }
  }
  return [...found];
}

function toConfirmation(
  v: z.infer<typeof confirmationSchema>,
  name: string
): ParsedRentalConfirmation {
  const price = nn(v.price);
  const words = (v.airportWords ?? []).map((w) => w.word).filter((w): w is string => !!w);
  return {
    kind: "confirmation",
    source: name,
    provider: v.provider,
    confirmationNumber: v.confirmationNumber,
    pickup: { stationName: v.pickupStation, local: v.pickupLocal },
    return: { stationName: v.returnStation, local: v.returnLocal },
    vehicleClass: nn(v.vehicleClass),
    vehicleExample: nn(v.vehicleExample),
    acrissCode: nn(v.acrissCode),
    paymentTiming: nn(v.paymentTiming),
    price,
    // A currency without an amount states nothing.
    currency: price !== null ? nn(v.currency) : null,
    mileagePolicy: nn(v.mileagePolicy),
    inclusions: inclusionsOf(v.inclusions),
    placeHints: { country: nn(v.placeCountry), airportWords: [...new Set(words)] },
  };
}

function toInvoice(v: z.infer<typeof invoiceSchema>, name: string): ParsedRentalInvoice {
  const rows = (v.vehicles ?? []).filter(
    (r): r is { odometerOut: number; odometerIn: number; driven: number; model?: string | null } =>
      typeof r.odometerOut === "number" &&
      typeof r.odometerIn === "number" &&
      typeof r.driven === "number" &&
      r.odometerIn - r.odometerOut === r.driven
  );
  const models = [...new Set(rows.map((r) => r.model).filter((m): m is string => !!m))];
  const finalAmount = nn(v.finalAmount);
  const currency = nn(v.finalCurrency);
  // A fee line is kept whole or not at all: a label without an amount, or an
  // amount in a currency the invoice never states, says nothing (forgejo#237).
  const fees = currency
    ? (v.fees ?? []).flatMap((f) =>
        f.label && typeof f.amount === "number"
          ? [{ label: f.label, amount: f.amount, currency }]
          : []
      )
    : [];
  return {
    kind: "invoice",
    source: name,
    provider: v.provider,
    confirmationNumber: nn(v.confirmationNumber),
    agreementNumber: nn(v.agreementNumber),
    invoiceNumber: nn(v.invoiceNumber),
    odometerOutKm: rows.length === 1 ? rows[0].odometerOut : null,
    odometerInKm: rows.length === 1 ? rows[0].odometerIn : null,
    distanceKm: rows.length > 0 ? rows.reduce((sum, r) => sum + r.driven, 0) : null,
    vehicleDriven: models.length > 0 ? models.join(" / ") : null,
    actualPickupLocal: nn(v.actualPickupLocal),
    actualReturnLocal: nn(v.actualReturnLocal),
    finalAmount,
    finalCurrency: finalAmount !== null ? currency : null,
    fees,
  };
}

export type RentalTemplateRead = ParsedRentalConfirmation | ParsedRentalInvoice;

/** Read one document with one v2 rental template, or decline (null). */
export function applyV2RentalTemplate(
  template: TemplateEnvelope,
  input: TemplateTestInput
): RentalTemplateRead | null {
  if (template.domain !== "rental") return null;
  const application = applyTemplate(template, input);
  if (!application.matched) return null;
  const kind = rentalTemplateKind(template);
  const schema = kind === "invoice" ? invoiceSchema : confirmationSchema;
  const parsed = schema.safeParse(application.values);
  if (!parsed.success) {
    logger.warn(
      {
        template: template.id,
        version: template.version,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      "v2 rental template produced values of the wrong shape — declined"
    );
    return null;
  }
  const name = rentalTemplateName(template);
  return parsed.data.kind === "invoice"
    ? toInvoice(parsed.data, name)
    : toConfirmation(parsed.data, name);
}

/** The first template of `kind` that reads the document, in the order given. */
export function readWithV2RentalTemplates(
  templates: readonly TemplateEnvelope[],
  kind: RentalTemplateKind,
  input: TemplateTestInput
): { read: RentalTemplateRead; template: TemplateEnvelope } | null {
  for (const template of templates) {
    if (rentalTemplateKind(template) !== kind) continue;
    const read = applyV2RentalTemplate(template, input);
    if (read) return { read, template };
  }
  return null;
}
