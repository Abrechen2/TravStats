import { z } from 'zod';

// Whitelist of allowed receipt URL domains (common cloud storage and document services)
const ALLOWED_RECEIPT_DOMAINS = [
  'dropbox.com',
  'drive.google.com',
  'docs.google.com',
  'onedrive.live.com',
  '1drv.ms',
  'box.com',
  'icloud.com',
  's3.amazonaws.com',
  'cloudinary.com',
  'imgur.com',
  // Add your own domain here if you host receipts
];

/**
 * Custom receipt URL validator
 * Ensures the URL is from a trusted domain or is a local upload
 */
const receiptUrlValidator = z
  .string()
  .refine(
    (url) => {
      // Allow local uploads (starts with /api/v1/uploads/)
      if (url.startsWith('/api/v1/uploads/')) {
        return true;
      }

      // For external URLs, validate domain
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        // Check if hostname ends with any allowed domain
        return ALLOWED_RECEIPT_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        );
      } catch {
        return false;
      }
    },
    {
      message: `Receipt URL must be a local upload (/api/v1/uploads/) or from a trusted domain: ${ALLOWED_RECEIPT_DOMAINS.join(', ')}`,
    }
  )
  .optional();

export const airportSchema = z.object({
  icao: z.string().nullable().optional(),
  iata: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const emptyStringToUndefined = z.string().optional().transform((v) => (v === "" ? undefined : v));

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

const normalizedFlightNumber = z.string().optional().transform((v) => {
  if (!v) return undefined;
  const cleaned = v.replace(/\s+/g, "").toUpperCase();
  return cleaned === "" ? undefined : cleaned;
});

const baseFlightSchema = z.object({
  airline: emptyStringToUndefined,
  operatingAirline: emptyStringToUndefined,
  flightNumber: normalizedFlightNumber,
  callsign: z.string().nullable().optional(),
  aircraft: z.string().nullable().optional(),
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
  depTimezone: ianaTimezone.optional().nullable(),
  arrivalLocal: localDateTime.optional().nullable(),
  arrTimezone: ianaTimezone.optional().nullable(),
  depTimeSemantics: z.enum(['UTC', 'DATE_ONLY', 'UNKNOWN']).optional(),
  arrTimeSemantics: z.enum(['UTC', 'DATE_ONLY', 'UNKNOWN']).optional(),
  actualDepartureLocal: localDateTime.optional().nullable(),
  actualDepartureTz: ianaTimezone.optional().nullable(),
  actualArrivalLocal: localDateTime.optional().nullable(),
  actualArrivalTz: ianaTimezone.optional().nullable(),
  status: z.enum(['scheduled', 'flown', 'cancelled', 'historical', 'duplicated']).default('scheduled'),
  notes: z.string().transform((v) => v.replace(/<[^>]*>/g, '')).optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
  taxes: z.number().min(0).optional(),
  fees: z.number().min(0).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  seatClass: z.enum(['economy', 'premium_economy', 'business', 'first']).nullable().optional(),
  tags: z.array(z.string().max(40)).optional(),
  companions: z.array(z.string().max(100)).max(50).optional().default([]),
  receiptUrl: receiptUrlValidator,
  // Provenance flag — primarily for bulk-import / AI-agent flows that want
  // to mark a row as 'bulk_import' so admins can later audit / re-process
  // them. Defaults to 'manual' in the route when omitted.
  dataSource: z.enum([
    'manual',
    'email_import',
    'boarding_pass_scan',
    'historical_enrichment',
    'live_update',
    'api_lookup',
    'bulk_import',
  ]).optional(),
  // Boarding pass / email import fields
  seatNumber: z.string().max(10).optional(),
  boardingGroup: z.string().max(20).optional(),
  gate: z.string().max(20).optional(),
  terminal: z.string().max(20).optional(),
  bookingReference: z.string().max(20).optional(),
  ticketNumber: z.string().max(30).optional(),
  baggageAllowance: z.string().max(50).optional(),
  frequentFlyerNumber: z.string().max(30).optional(),
  bookingClassLetter: z.string().max(5).optional(),
  coPassengers: z.array(z.string().max(100)).max(50).optional(),
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

export const createFlightSchema = baseFlightSchema
  .superRefine(requirePairedTimezone)
  .refine(
    (data) => {
      if (data.status === 'historical' || data.status === 'duplicated') return true;
      if (!data.departureLocal || !data.arrivalLocal) return false;
      // Compare wall-clock strings lexicographically — only used for sanity
      // bounds (>-12h, <+24h). Real per-second checks would need conversion,
      // but the route handler performs that with the proper tz pair.
      return data.departureLocal <= data.arrivalLocal;
    },
    {
      message: 'Non-historical flights require departureLocal and arrivalLocal in chronological order',
      path: ['arrivalLocal'],
    }
  );

export const updateFlightSchema = baseFlightSchema
  .partial()
  .superRefine(requirePairedTimezone)
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
});

export type CreateFlightInput = z.infer<typeof createFlightSchema>;
export type UpdateFlightInput = z.infer<typeof updateFlightSchema>;
export type FlightQueryInput = z.infer<typeof flightQuerySchema>;
