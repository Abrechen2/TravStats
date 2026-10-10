/**
 * Cruise consumption of v2 templates (plan 2026-10-09 P4b): the one place a
 * `cruise` template's values become `ParsedCruise` objects. The TUI Cruises
 * reader that used to be compiled in is now such a template file.
 *
 * A template yields a `cruises` repeat — one item per voyage, each with a
 * `stops` repeat — plus document-level values (booking reference, cruise
 * line, currency) that apply to every voyage that does not state its own.
 * Values are validated by Zod first: a template is community data, and a value
 * of the wrong type is a template defect, not something to coerce.
 *
 * What a voyage MEANS is decided here, the same for every cruise line:
 * - stops are numbered from one in the order printed; a sea day carries no
 *   port name at all (the three-state invariant, CLAUDE.md);
 * - a stop day printed without a year (`--MM-DD`) is dated from the voyage's
 *   start date, rolling over New Year; without one it stays undated
 *   (`resolveStopYears`);
 * - a voyage without a single stop is no voyage and is dropped;
 * - start and end date, departure and arrival port come from the first and
 *   last stop unless the template reads them;
 * - the cabin type is the stored value or the category prose mapped by the
 *   one shared mapping (`cabinType.ts`);
 * - a currency is only stated beside a price;
 * - `missing` names what a useful booking lacks, so the caller can ask the
 *   model or the user rather than store a half-read booking as complete.
 */
import { z } from "zod";
import logger from "../../utils/logger";
import { isCurrencyCode } from "../../shared/currencies";
import type { CruiseCurrency, ParsedCruise, ParsedCruiseStop } from "../cruiseBookingParser";
import type { TemplateEnvelope } from "../parsers/templates/v2/envelope";
import { applyTemplate } from "../parsers/templates/v2/runners";
import { toCabinType } from "./cabinType";
import { isoDate } from "../parsers/templates/v2/calendar";

/** Every field here was read from a fixed position, not inferred — above the model's 80. */
export const CRUISE_TEMPLATE_CONFIDENCE = 95;

const text = z.string().min(1).nullish();
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

/** A stop's day: a full date, or `--MM-DD` when the document printed no year. */
const stopDay = z
  .string()
  .regex(/^(?:\d{4}|-)-\d{2}-\d{2}$/)
  .nullish();

const stopSchema = z.object({
  date: stopDay,
  portName: text,
  isAtSea: z.boolean().nullish(),
});

const voyageFields = {
  shipName: text,
  cruiseLine: text,
  routeName: text,
  startDate: isoDay,
  endDate: isoDay,
  departurePortName: text,
  arrivalPortName: text,
  cabinNumber: text,
  cabinType: text,
  deck: z.number().int().positive().nullish(),
  bookingReference: text,
  price: z.number().finite().nonnegative().nullish(),
  currency: z
    .string()
    .refine((c) => isCurrencyCode(c), "must be an ISO 4217 code")
    .nullish(),
};

export const cruiseValuesSchema = z.object({
  ...voyageFields,
  cruises: z
    .array(z.object({ ...voyageFields, stops: z.array(stopSchema).max(400).optional() }))
    .max(20),
});
type CruiseValues = z.infer<typeof cruiseValuesSchema>;
type Voyage = CruiseValues["cruises"][number];

/** `cruise:tui-cruises-confirmation` → `tui-cruises-confirmation`, the `parserTemplate` name. */
export function cruiseTemplateName(template: TemplateEnvelope): string {
  return template.id.slice(template.id.indexOf(":") + 1);
}

/**
 * The year of every stop printed without one (`--MM-DD`), from the voyage's
 * start date: stops run forward in time, so a day earlier in the calendar
 * than the stop before it is in the next year (a voyage over New Year). A
 * day that year does not have (29 February) is no date. Without a start date
 * nothing is inferred — the stop keeps no date rather than a guessed year.
 */
export function resolveStopYears(
  dates: ReadonlyArray<string | null | undefined>,
  startDate: string | null | undefined
): Array<string | null> {
  const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  let year = start ? Number(start.slice(0, 4)) : null;
  let previous = start;
  return dates.map((d) => {
    if (!d) return null;
    if (/^\d{4}-/.test(d)) {
      previous = d;
      year = Number(d.slice(0, 4));
      return d;
    }
    if (year === null || previous === null) return null;
    const monthDay = d.slice(1); // "-MM-DD"
    let candidate = `${year}${monthDay}`;
    if (candidate < previous) {
      year += 1;
      candidate = `${year}${monthDay}`;
    }
    const [y, m, day] = candidate.split("-").map(Number);
    if (isoDate(y, m, day) === null) return null;
    previous = candidate;
    return candidate;
  });
}

function toStops(items: Voyage["stops"], startDate: string | null | undefined): ParsedCruiseStop[] {
  const dates = resolveStopYears(
    (items ?? []).map((item) => item.date),
    startDate
  );
  return (items ?? []).map((item, i) => {
    const atSea = item.isAtSea === true;
    const date = dates[i];
    return {
      dayNumber: i + 1,
      ...(date ? { date } : {}),
      isAtSea: atSea,
      ...(atSea || !item.portName ? {} : { portName: item.portName }),
    };
  });
}

/** The order `missing` names gaps in — the same for every cruise template. */
const EXPECTED = [
  "shipName",
  "startDate",
  "endDate",
  "bookingReference",
  "price",
  "cabinType",
] as const;

function toCruise(voyage: Voyage, doc: CruiseValues, name: string): ParsedCruise | null {
  const stops = toStops(voyage.stops, voyage.startDate ?? doc.startDate);
  if (stops.length === 0) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const pick = <K extends keyof typeof voyageFields>(key: K): Voyage[K] =>
    voyage[key] ?? doc[key] ?? undefined;
  const price = pick("price") ?? undefined;
  const currency = price !== undefined ? (pick("currency") ?? undefined) : undefined;
  const category = pick("cabinType");
  const cruise = {
    shipName: pick("shipName") ?? undefined,
    cruiseLine: pick("cruiseLine") ?? undefined,
    routeName: pick("routeName") ?? undefined,
    startDate: pick("startDate") ?? first.date,
    endDate: pick("endDate") ?? last.date,
    departurePortName: pick("departurePortName") ?? first.portName,
    arrivalPortName: pick("arrivalPortName") ?? last.portName,
    cabinNumber: pick("cabinNumber") ?? undefined,
    cabinType: category ? toCabinType(category) : undefined,
    deck: pick("deck") ?? undefined,
    bookingReference: pick("bookingReference") ?? undefined,
    price,
    currency: currency as CruiseCurrency | undefined,
  };
  // Absent, not undefined-valued: a reader that could not read a field leaves it out.
  const present = Object.fromEntries(
    Object.entries(cruise).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<ParsedCruise>;
  return {
    ...present,
    stops,
    flights: [],
    parserTemplate: name,
    parserConfidence: CRUISE_TEMPLATE_CONFIDENCE,
    missing: EXPECTED.filter((key) => present[key] === undefined),
  };
}

/** Every voyage one v2 cruise template reads from the document; empty when it declines. */
export function applyV2CruiseTemplate(template: TemplateEnvelope, text: string): ParsedCruise[] {
  if (template.domain !== "cruise") return [];
  const application = applyTemplate(template, text);
  if (!application.matched) return [];
  const parsed = cruiseValuesSchema.safeParse(application.values);
  if (!parsed.success) {
    logger.warn(
      {
        template: template.id,
        version: template.version,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      "v2 cruise template produced values of the wrong shape — declined"
    );
    return [];
  }
  const name = cruiseTemplateName(template);
  return parsed.data.cruises
    .map((voyage) => toCruise(voyage, parsed.data, name))
    .filter((c): c is ParsedCruise => c !== null);
}

/** The voyages of the first template, in the order given, that reads any. */
export function readWithV2CruiseTemplates(
  templates: readonly TemplateEnvelope[],
  text: string
): ParsedCruise[] {
  for (const template of templates) {
    const cruises = applyV2CruiseTemplate(template, text);
    if (cruises.length > 0) return cruises;
  }
  return [];
}
