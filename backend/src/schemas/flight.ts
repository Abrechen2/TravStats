import { z } from 'zod';
import { receiptUrlValidator } from './receiptUrl';

export const airportSchema = z.object({
  icao: z.string().nullable().optional(),
  iata: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

// "" and null both mean "clear" on the wire; undefined means "don't change"
// on update. Collapsing "" to undefined made clearing impossible from the
// edit forms — a blanked field turned into "keep the old value".
const emptyStringToNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v === "" ? null : v));

// Local wall-clock datetime — `YYYY-MM-DDTHH:mm` or with seconds. Deliberately
// no timezone suffix: timezone is conveyed in the paired *Timezone field so
// the server (not the browser) does the IANA conversion to UTC.
const LOCAL_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const localDateTime = z
  .string()
  .regex(LOCAL_DATETIME_REGEX, 'Expected YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss');

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const ianaTimezone = z
  .string()
  .refine(isValidIanaTimezone, { message: 'Invalid IANA timezone' });

/**
 * Canonical flight-number normalisation: strip every whitespace character
 * (incl. tabs and non-breaking spaces) and uppercase. Empty results collapse
 * to undefined so optional fields stay nullable. Used by both the Zod schema
 * and any code path that needs to compare flight numbers across sources
 * (importers, dedupe-hint, etc.).
 */
export function normalizeFlightNumber(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  const cleaned = v.replace(/\s+/g, "").toUpperCase();
  return cleaned === "" ? undefined : cleaned;
}

/**
 * Flight number in the form flight-data PROVIDERS use: the IATA designator
 * followed by the number WITHOUT leading zeros.
 *
 * Airlines print zero-padded numbers on itineraries ("EK051"), but AirLabs,
 * Aviationstack and AeroDataBox all key on the unpadded IATA form ("EK51").
 * Querying the padded form returns an empty result set — verified against
 * AirLabs on 2026-08-11: `flight_iata=EK051` → 0 records, `flight_iata=EK51`
 * → the real flight. Every zero-padded booking (Emirates, Qatar, Gulf Air,
 * EgyptAir …) was therefore invisible to live tracking.
 *
 * ONLY for outgoing provider requests. The stored number keeps the user's
 * own spelling — mapping a response back onto the padded form is what stops
 * auto-apply from silently renaming their flight to the provider's spelling.
 */
export function toProviderFlightNumber(v: string | undefined | null): string | undefined {
  const normalized = normalizeFlightNumber(v);
  if (!normalized) return undefined;
  // Designator: 2-3 letters (incl. ICAO), or the letter+digit / digit+letter
  // IATA forms ("U2", "9W"). Anything unrecognised is passed through as-is.
  const m = normalized.match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])0*(\d{1,4})$/);
  if (!m) return normalized;
  return `${m[1]}${m[2]}`;
}

const normalizedFlightNumber = z
  .string()
  .nullable()
  .optional()
  // Preserve an explicit null (= clear the stored number); only normalise
  // actual strings. normalizeFlightNumber would collapse null to undefined,
  // which the update handler reads as "don't change".
  .transform((v) => (v === null ? null : normalizeFlightNumber(v)));

const baseFlightSchema = z.object({
  airline: emptyStringToNull,
  airlineIata: z.string().max(4).nullable().optional(),
  airlineIcao: z.string().max(5).nullable().optional(),
  operatingAirline: emptyStringToNull,
  operatingAirlineIata: z.string().max(4).nullable().optional(),
  operatingAirlineIcao: z.string().max(5).nullable().optional(),
  isCodeshare: z.boolean().nullable().optional(),
  flightNumber: normalizedFlightNumber,
  callsign: z.string().nullable().optional(),
  aircraft: z.string().nullable().optional(),
  aircraftRegistration: z.string().max(20).nullable().optional(),
  aircraftModeS: z.string().max(10).nullable().optional(),
  departure: z.object({
    icao: z.string().nullable().optional(),
    iata: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  arrival: z.object({
    icao: z.string().nullable().optional(),
    iata: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  // Canonical-UTC contract: clients send a local wall-clock string + an IANA
  // timezone. The server converts to a real UTC instant via fromZonedTime and
  // marks the row with depTimeSemantics='UTC'. Bulk imports (xlsx, CSV) that
  // only know the calendar date can opt into 'DATE_ONLY' semantics — the
  // server then accepts dep == arr (12:00 placeholder) and the frontend hides
  // the meaningless time component / falls back to a great-circle estimate
  // for duration. 'UNKNOWN' is for legacy / unresolvable rows.
  departureLocal: localDateTime.optional().nullable(),
  depTimezone: ianaTimezone
    .optional()
    .nullable()
    .describe(
      "IANA zone of the departure airport. Required whenever " +
        "departureLocal is set: a wall-clock time without a zone cannot be turned into " +
        "an instant. It may be OMITTED when departure carries an IATA or ICAO code, " +
        "because the server then reads the zone from the airport catalogue. A value " +
        "given here always wins over the catalogue, so a caller who knows better (a " +
        "historical flight from an airport that has since changed zone) can say so."
    ),
  arrivalLocal: localDateTime.optional().nullable(),
  arrTimezone: ianaTimezone
    .optional()
    .nullable()
    .describe(
      "IANA zone of the arrival airport. Required whenever " +
        "arrivalLocal is set: a wall-clock time without a zone cannot be turned into " +
        "an instant. It may be OMITTED when arrival carries an IATA or ICAO code, " +
        "because the server then reads the zone from the airport catalogue. A value " +
        "given here always wins over the catalogue, so a caller who knows better (a " +
        "historical flight from an airport that has since changed zone) can say so."
    ),
  depTimeSemantics: z.enum(['UTC', 'DATE_ONLY', 'UNKNOWN']).optional(),
  arrTimeSemantics: z.enum(['UTC', 'DATE_ONLY', 'UNKNOWN']).optional(),
  actualDepartureLocal: localDateTime.optional().nullable(),
  actualDepartureTz: ianaTimezone
    .optional()
    .nullable()
    .describe(
      "IANA zone of the departure airport. Required whenever " +
        "actualDepartureLocal is set: a wall-clock time without a zone cannot be turned into " +
        "an instant. It may be OMITTED when departure carries an IATA or ICAO code, " +
        "because the server then reads the zone from the airport catalogue. A value " +
        "given here always wins over the catalogue, so a caller who knows better (a " +
        "historical flight from an airport that has since changed zone) can say so."
    ),
  actualArrivalLocal: localDateTime.optional().nullable(),
  actualArrivalTz: ianaTimezone
    .optional()
    .nullable()
    .describe(
      "IANA zone of the arrival airport. Required whenever " +
        "actualArrivalLocal is set: a wall-clock time without a zone cannot be turned into " +
        "an instant. It may be OMITTED when arrival carries an IATA or ICAO code, " +
        "because the server then reads the zone from the airport catalogue. A value " +
        "given here always wins over the catalogue, so a caller who knows better (a " +
        "historical flight from an airport that has since changed zone) can say so."
    ),
  // 'scheduled'/'flown' are HINTS only — the server derives the actual
  // temporal status from departureLocal/arrivalLocal (deriveFlightStatus,
  // shared/statusDerivation.ts; spec 2026-07-17-status-from-dates).
  // 'cancelled'/'historical'/'duplicated' are passthrough: always stored
  // verbatim, never overridden by derivation.
  status: z.enum(['scheduled', 'flown', 'cancelled', 'historical', 'duplicated']).default('scheduled'),
  notes: z
    .string()
    .transform((v) => {
      // Loop until convergence so `<<script>foo<</script>>` cannot smuggle a
      // tag through a single pass of the strip.
      let out = v;
      let prev: string;
      do {
        prev = out;
        out = out.replace(/<[^>]*>/g, '');
      } while (out !== prev);
      return out;
    })
    .nullable()
    .optional(),
  price: z.number().min(0).nullable().optional(),
  // Any ISO 4217 alpha-3 code — validated only for shape, not against a
  // hard-coded allow-list, so users worldwide can record costs in their
  // local currency (INR, JPY, AUD, …). Intl.NumberFormat handles
  // formatting natively for every code it supports.
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)')
    .optional(),
  taxes: z.number().min(0).nullable().optional(),
  fees: z.number().min(0).nullable().optional(),
  // Nullable like seatClass below: the edit form offers a "(optional)" choice,
  // and clearing must be expressible on the wire. `undefined` means "don't
  // change" on update, `null` means "clear" — without the nullable, the clear
  // silently kept the old value while the UI showed it removed.
  category: z.enum(['business', 'private', 'vacation']).nullable().optional(),
  seatClass: z.enum(['economy', 'premium_economy', 'business', 'first']).nullable().optional(),
  tags: z.array(z.string().max(40)).optional(),
  companions: z.array(z.string().max(100)).max(50).optional().default([]),
  // `.nullable()` at the use site, not in the shared validator: the flight
  // edit form must be able to CLEAR the receipt (null = clear, undefined =
  // leave alone). schemas/lodging.ts does the same on its own use site.
  receiptUrl: receiptUrlValidator.nullable(),
  // Provenance flag — primarily for bulk-import / AI-agent flows that want
  // to mark a row as 'bulk_import' so admins can later audit / re-process
  // them. Defaults to 'manual' in the route when omitted.
  /**
   * Set when the flight arrives from an import rather than the form. The
   * server derives the provenance key itself — what counts as "the same
   * flight" is a rule about the data, not something each client should
   * restate.
   */
  importBatchId: z.string().uuid().nullable().optional(),
  dataSource: z.enum([
    'manual',
    'email_import',
    'boarding_pass_scan',
    'historical_enrichment',
    'live_update',
    'api_lookup',
    'bulk_import',
    'imported_fr24',
    'imported_generic_csv',
    'imported_roundtrip',
  ]).optional(),
  // Boarding pass / email import fields
  seatNumber: z.string().max(10).nullable().optional(),
  boardingGroup: z.string().max(20).nullable().optional(),
  gate: z.string().max(20).nullable().optional(),
  terminal: z.string().max(20).nullable().optional(),
  bookingReference: z.string().max(20).nullable().optional(),
  ticketNumber: z.string().max(30).nullable().optional(),
  baggageAllowance: z.string().max(50).nullable().optional(),
  frequentFlyerNumber: z.string().max(30).nullable().optional(),
  bookingClassLetter: z.string().max(5).nullable().optional(),
  coPassengers: z.array(z.string().max(100)).max(50).optional(),
  // AeroDataBox extended fields (v1.5 importers)
  runwayDepartureTime: z.coerce.date().nullable().optional(),
  runwayArrivalTime: z.coerce.date().nullable().optional(),
  isCargo: z.boolean().nullable().optional(),
  aerodataboxLastUpdatedUtc: z.coerce.date().nullable().optional(),
  aerodataboxQualityTags: z.array(z.string().max(64)).max(20).optional().default([]),
  baggageBelt: z.string().max(20).nullable().optional(),
  checkInDesk: z.string().max(40).nullable().optional(),
  // Special flights (Sonder-Flüge) — flight subtype, see schema.prisma
  specialType: z
    .enum([
      'sightseeing',
      'eclipse',
      'rocket_launch',
      'zerog',
      'aurora',
      'training',
      'ferry',
      'test',
    ])
    .nullable()
    .optional(),
  eventLat: z.number().min(-90).max(90).nullable().optional(),
  eventLon: z.number().min(-180).max(180).nullable().optional(),
  eventLabel: z.string().max(120).nullable().optional(),
  patternLat: z.number().min(-90).max(90).nullable().optional(),
  patternLon: z.number().min(-180).max(180).nullable().optional(),
  specialData: z.record(z.unknown()).nullable().optional(),
});

type LocalTzPair =
  | 'departureLocal' | 'depTimezone'
  | 'arrivalLocal' | 'arrTimezone'
  | 'actualDepartureLocal' | 'actualDepartureTz'
  | 'actualArrivalLocal' | 'actualArrivalTz';

const requirePairedTimezone = (
  data: Partial<Record<LocalTzPair, string | null | undefined>>,
  ctx: z.RefinementCtx,
): void => {
  const pairs: Array<[LocalTzPair, LocalTzPair]> = [
    ['departureLocal', 'depTimezone'],
    ['arrivalLocal', 'arrTimezone'],
    ['actualDepartureLocal', 'actualDepartureTz'],
    ['actualArrivalLocal', 'actualArrivalTz'],
  ];
  for (const [localField, tzField] of pairs) {
    const local = data[localField];
    const tz = data[tzField];
    if (local && !tz) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${tzField} is required when ${localField} is set`,
        path: [tzField],
      });
    }
  }
};

/**
 * Cross-field validations applied to BOTH create and update.
 *
 * 1. Chronological order — for any status where both departureLocal AND
 *    arrivalLocal are supplied (and the wall-clock strings parse), arrival
 *    must not precede departure. Previously only `flown` and `scheduled`
 *    were checked; v1.5.0-rc.3 extends this to `historical` because the
 *    Norbert UAT (issue #99) surfaced an ATL→MUC 1986 row with arr 8 h
 *    BEFORE dep that the handler had silently accepted. NULL `arrivalLocal`
 *    remains legal for `historical` (legitimate date-only bulk imports).
 *
 *    DATE_ONLY granularity (issue #106A): when either side is DATE_ONLY,
 *    the time component is a 12:00 placeholder that the server may shift
 *    via airport-timezone conversion (frontend sends "12:00 local" → CET
 *    becomes 10:00 UTC, WET becomes 12:00 UTC). A naïve string compare
 *    can flag a same-day round-trip as arr<dep purely from the TZ shift.
 *    Compare date-portion only when DATE_ONLY semantics are in play.
 *
 * 2. Status / time-axis sanity — `flown` and `historical` cannot have a
 *    departure in the future; both states mean the flight has already
 *    happened. `scheduled` past-dated rows are NOT rejected here (a
 *    legitimate edge case is a manually re-edited row whose flight has
 *    just departed) — the route handler logs them as a warning instead.
 */
const requireChronologicalOrder = (
  data: {
    departureLocal?: string | null;
    arrivalLocal?: string | null;
    depTimeSemantics?: string | null;
    arrTimeSemantics?: string | null;
  },
  ctx: z.RefinementCtx,
): void => {
  if (!data.departureLocal || !data.arrivalLocal) return;

  const depDate = data.departureLocal.slice(0, 10);
  const arrDate = data.arrivalLocal.slice(0, 10);

  if (depDate < arrDate) return;
  if (depDate > arrDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'arrival date must not precede departure date',
      path: ['arrivalLocal'],
    });
    return;
  }

  // Same-day: only reject if wall-clock arrival precedes departure AND
  // we are certain this isn't a DATE_ONLY row (where 12:00 is a placeholder).
  const isDateOnly =
    data.depTimeSemantics === 'DATE_ONLY' ||
    data.arrTimeSemantics === 'DATE_ONLY' ||
    (data.departureLocal.endsWith('T12:00') && data.arrivalLocal.endsWith('T12:00'));

  if (!isDateOnly && data.departureLocal > data.arrivalLocal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'arrivalLocal must not precede departureLocal',
      path: ['arrivalLocal'],
    });
  }
};

const requireStatusTimeAxisSanity = (
  data: { status?: string; departureLocal?: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (!data.departureLocal) return;
  // departureLocal is a wall-clock string; compare against now via ISO
  // string slicing — both are YYYY-MM-DDTHH:mm[:ss]. We accept the local
  // string at face value (the proper IANA conversion happens in the
  // handler). For sanity bounds this lexicographic compare is enough.
  const nowIso = new Date().toISOString().slice(0, 19);
  if ((data.status === 'historical' || data.status === 'flown') && data.departureLocal > nowIso) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${data.status} flights cannot have a departureLocal in the future`,
      path: ['departureLocal'],
    });
  }
};

export const createFlightSchema = baseFlightSchema
  .superRefine(requirePairedTimezone)
  .superRefine(requireChronologicalOrder)
  .superRefine(requireStatusTimeAxisSanity)
  .refine(
    (data) => {
      if (data.status === 'historical' || data.status === 'duplicated') return true;
      // `flown` and `scheduled` need both dep + arr times — historicals can
      // legitimately omit arrival (date-only bulk imports). Chronological
      // order itself is now handled in `requireChronologicalOrder` above.
      return Boolean(data.departureLocal && data.arrivalLocal);
    },
    {
      message: 'Non-historical flights require both departureLocal and arrivalLocal',
      path: ['arrivalLocal'],
    }
  );

export const updateFlightSchema = baseFlightSchema
  .partial()
  .superRefine(requirePairedTimezone)
  .superRefine(requireChronologicalOrder)
  .superRefine(requireStatusTimeAxisSanity)
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: 'At least one field must be provided for update',
    }
  );

export const flightQuerySchema = z.object({
  airline: z.union([z.string(), z.array(z.string())]).optional(),
  flightNumber: z.string().optional(),
  departureAirport: z.string().optional(),
  arrivalAirport: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  status: z.union([z.enum(['scheduled', 'flown', 'cancelled', 'historical', 'duplicated']), z.array(z.enum(['scheduled', 'flown', 'cancelled', 'historical', 'duplicated']))]).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRouteCount: z.coerce.number().min(1).max(100).optional(), // frontend-only; ignored server-side
  limit: z.coerce.number().min(1).default(100),
  offset: z.coerce.number().min(0).default(0),
  // ?all=true bypasses the 500-row cap and pagination so external API
  // consumers can sync the full row set in one request. Authentication
  // already scopes the query to the calling user's flights, so there's
  // no enumeration risk to gate behind beyond the existing auth check.
  all: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type CreateFlightInput = z.infer<typeof createFlightSchema>;
export type UpdateFlightInput = z.infer<typeof updateFlightSchema>;
export type FlightQueryInput = z.infer<typeof flightQuerySchema>;
