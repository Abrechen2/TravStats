/**
 * The package-tour extraction contract (plan 2026-10-09 P3).
 *
 * A `package` template is generic data from the template repository; the
 * engine (`parsers/templates/v2`) reads it without knowing what a flight or a
 * stay is. THIS file is where the names acquire meaning: a package template's
 * `extraction` must yield exactly these names, and `applyTemplate(...).values`
 * passes through {@link packageContractSchema} before anything downstream
 * reads them. A template that yields something else is not half-used — its
 * reading is refused with the paths that failed, so a broken template is a
 * named failure, never a quietly thinner trip.
 *
 * Fields (one value each):
 *   bookingReference  required — the operator's booking number
 *   issuedOn          required — the day the document was issued (FX day)
 *   tripName, startDate, endDate, travellers (integer), totalPrice, currency
 *   cruiseShip, cruiseFrom, cruiseTo, cruiseCabin, cruiseStart, cruiseEnd
 *
 * Repeats (arrays of objects):
 *   flights  flightNumber, date, depIata | depCity, arrIata | arrCity,
 *            depTime?, arrTime?, arrDayOffset?, airline?
 *   stays    name, checkIn, checkOut, address?, city?, country?, board?, room?
 *
 * `cruiseStart`/`cruiseEnd` go beyond the list the plan names: a cruise row
 * cannot exist without a start day (`createCruiseSchema`), and guessing it
 * from the package span would put a sailing on days it did not sail.
 *
 * Dates are calendar strings (`YYYY-MM-DD`), times wall clocks (`HH:MM`) —
 * what the engine's transforms emit; no `Date` here (ADR 0002).
 */
import { z } from "zod";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const isoDay = z.string().regex(ISO_DAY, "must be YYYY-MM-DD");
const wallClock = z.string().regex(HH_MM, "must be HH:MM");
const text = z.string().trim().min(1);
const iataCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "must be a three-letter IATA code")
  .transform((v) => v.toUpperCase());

/**
 * "QR070" / "QR 0070" → "QR70". The operators zero-pad the number part; the
 * airline's own numbering does not, and the padded form matches nothing a
 * flight lookup or an existing logbook row holds (`tripDocumentParser.ts`
 * measured both spellings in the same booking).
 */
export function canonicalFlightNumber(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s\u00a0-]+/g, "");
  const m = /^([A-Z0-9]{2})(\d{1,5})([A-Z]?)$/.exec(compact);
  if (!m) return null;
  const digits = m[2].replace(/^0+(?=\d)/, "");
  return `${m[1]}${digits}${m[3]}`;
}

const flightNumber = z
  .string()
  .max(12)
  .transform((raw, ctx) => {
    const canonical = canonicalFlightNumber(raw);
    if (canonical === null) {
      ctx.addIssue({ code: "custom", message: `"${raw}" is not a flight number` });
      return z.NEVER;
    }
    return canonical;
  });

export const packageFlightSchema = z
  .object({
    flightNumber,
    date: isoDay,
    depIata: iataCode.nullish(),
    arrIata: iataCode.nullish(),
    depCity: text.max(120).nullish(),
    arrCity: text.max(120).nullish(),
    depTime: wallClock.nullish(),
    arrTime: wallClock.nullish(),
    arrDayOffset: z.number().int().min(0).max(3).nullish(),
    airline: text.max(80).nullish(),
  })
  .refine((f) => Boolean(f.depIata || f.depCity), {
    message: "needs depIata or depCity",
    path: ["depIata"],
  })
  .refine((f) => Boolean(f.arrIata || f.arrCity), {
    message: "needs arrIata or arrCity",
    path: ["arrIata"],
  });
export type PackageFlight = z.infer<typeof packageFlightSchema>;

export const packageStaySchema = z
  .object({
    name: text.max(200),
    checkIn: isoDay,
    checkOut: isoDay,
    address: text.max(300).nullish(),
    city: text.max(120).nullish(),
    country: text.max(120).nullish(),
    board: text.max(120).nullish(),
    room: text.max(120).nullish(),
  })
  .refine((s) => s.checkOut >= s.checkIn, {
    message: "checkOut must not precede checkIn",
    path: ["checkOut"],
  });
export type PackageStay = z.infer<typeof packageStaySchema>;

export const packageContractSchema = z
  .object({
    bookingReference: text.max(20),
    issuedOn: isoDay,
    tripName: text.max(200).nullish(),
    startDate: isoDay.nullish(),
    endDate: isoDay.nullish(),
    travellers: z.number().int().min(1).max(50).nullish(),
    totalPrice: z.number().min(0).nullish(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "must be an ISO 4217 code")
      .nullish(),
    flights: z.array(packageFlightSchema).max(40).default([]),
    stays: z.array(packageStaySchema).max(60).default([]),
    cruiseShip: text.max(200).nullish(),
    cruiseFrom: text.max(120).nullish(),
    cruiseTo: text.max(120).nullish(),
    cruiseCabin: text.max(40).nullish(),
    cruiseStart: isoDay.nullish(),
    cruiseEnd: isoDay.nullish(),
  })
  .refine((p) => !p.startDate || !p.endDate || p.endDate >= p.startDate, {
    message: "endDate must not precede startDate",
    path: ["endDate"],
  })
  .refine((p) => p.totalPrice == null || p.currency != null, {
    message: "a total price needs its currency",
    path: ["currency"],
  });
export type PackageContract = z.infer<typeof packageContractSchema>;

export type ContractValidation =
  { ok: true; contract: PackageContract } | { ok: false; issues: string[] };

/** Validates what a package template read. Never throws. */
export function validatePackageValues(values: unknown): ContractValidation {
  const result = packageContractSchema.safeParse(values);
  if (result.success) return { ok: true, contract: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * The span the package covers: its own dates where the document states them,
 * else the earliest and latest day any flight or stay names. Null when the
 * document dates nothing at all.
 */
export function packageSpan(p: PackageContract): { first: string; last: string } | null {
  const days = [
    ...p.flights.map((f) => f.date),
    ...p.flights.map((f) => arrivalDay(f)),
    ...p.stays.flatMap((s) => [s.checkIn, s.checkOut]),
    ...(p.cruiseStart ? [p.cruiseStart] : []),
    ...(p.cruiseEnd ? [p.cruiseEnd] : []),
  ].sort();
  const first = p.startDate ?? days[0];
  const last = p.endDate ?? days[days.length - 1];
  return first && last ? { first, last: last < first ? first : last } : null;
}

/** The calendar day a flight lands, after its `+N` rollover. */
export function arrivalDay(f: Pick<PackageFlight, "date" | "arrDayOffset">): string {
  return addDays(f.date, f.arrDayOffset ?? 0);
}

/** Pure calendar arithmetic on `YYYY-MM-DD` — UTC midnight is only the carrier. */
export function addDays(day: string, days: number): string {
  if (days === 0) return day;
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
