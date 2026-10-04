import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";

/**
 * Car rentals — spec docs/superpowers/specs/2026-10-01-rental-domain-design.md.
 *
 * The WRITE vocabulary is narrower than the stored one on purpose, as for
 * rail: a client may say "scheduled" (a hint, derived over) or "cancelled"
 * (kept verbatim); `in_progress` and `completed` come from the clock.
 */
export const RENTAL_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export const RENTAL_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
export const RENTAL_PAYMENT_TIMINGS = ["prepaid", "pay_at_counter", "package"] as const;
export const RENTAL_MILEAGE_POLICIES = ["unlimited", "capped"] as const;
export const RENTAL_FUEL_POLICIES = ["full_to_full", "prepaid_tank", "full_to_empty"] as const;
/**
 * Where the driven km came from. `invoice` and `agreement` are written only by
 * the document path (the invoice frame, §4.5); a person's figure is `user` —
 * a labelled correction, never passed off as the invoice's.
 */
export const RENTAL_DISTANCE_SOURCES = ["invoice", "agreement", "user"] as const;
export type RentalDistanceSource = (typeof RENTAL_DISTANCE_SOURCES)[number];
/** Normalised inclusion codes (§3.1) — included or bought, never their prices. */
export const RENTAL_INCLUSIONS = [
  "cdw",
  "tp",
  "scdw",
  "pai",
  "slp",
  "ep",
  "roadside",
  "gps",
  "child_seat",
  "additional_driver",
  "one_way_fee",
] as const;
export const RENTAL_SORT_FIELDS = ["pickup", "created"] as const;
/** Longest licence plate accepted — generous for any country's format plus spaces. */
export const RENTAL_LICENSE_PLATE_MAX = 20;

/**
 * ACRISS / SIPP: four positions, each from its own alphabet — category, type,
 * transmission + drive, fuel + air conditioning. Validated per position, so a
 * four-letter word that merely LOOKS like a code ("CARS") is refused.
 */
export const ACRISS_ALPHABET = [
  "MNEHCDIJSRFGPULWOX",
  "BCDWVLSTFJXPQZEMRHYNGK",
  "MNCABD",
  "RNDQHIECLSABMFVZUX",
] as const;

export function isAcrissCode(value: string): boolean {
  const code = value.toUpperCase();
  return code.length === 4 && [...code].every((letter, i) => ACRISS_ALPHABET[i].includes(letter));
}

/**
 * What a valid code says about the car, derived on read and never stored
 * (§3.1). Null for a code that is not ACRISS — no guess from a near miss.
 */
export function acrissTraits(
  value: string | null
): { transmission: "manual" | "automatic"; airConditioning: boolean } | null {
  if (!value || !isAcrissCode(value)) return null;
  const code = value.toUpperCase();
  return {
    transmission: "MNC".includes(code[2]) ? "manual" : "automatic",
    airConditioning: "RDHELAMVU".includes(code[3]),
  };
}

/**
 * The wall clock at the station as a booking prints it: `YYYY-MM-DDTHH:mm`
 * (seconds optional) — or only the day, `YYYY-MM-DD`, for a mail that names
 * no time (precision `day`). NO offset: whose clock it is comes from the
 * station on the server.
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const wallClock = z
  .string()
  .regex(WALL_CLOCK, "must be a local wall clock YYYY-MM-DDTHH:mm (or a day) without an offset")
  .refine(
    (v) => !Number.isNaN(new Date(v.length === 10 ? `${v}T00:00Z` : `${v}Z`).getTime()),
    "is not a real date and time"
  );

/** "" and null both clear a text field; undefined leaves it alone. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

/**
 * A station as the client knows it. Resolution on the server, in order
 * (§3.2): a picked airport (`airportId`), a printed IATA code (`iata`),
 * a position the client already has (`lat`/`lon` from a geocoder pick or an
 * earlier station), an address the server geocodes. A station none of those
 * places is refused with `RENTAL_STATION_UNRESOLVED` — never the user's home,
 * never the trip's first airport.
 */
export const rentalStationSchema = z
  .object({
    airportId: z.number().int().positive().nullable().optional(),
    iata: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((v) => v.toUpperCase())
      .nullable()
      .optional(),
    name: z.string().trim().min(1).max(200),
    address: optionalText(300),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    /** ISO 3166-1 alpha-2. */
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .nullable()
      .optional(),
  })
  .refine((s) => (s.lat == null) === (s.lon == null), {
    message: "lat and lon come together",
    path: ["lat"],
  });

const foldField = z.enum(["earlier", "later"]).nullable().optional();

/** The fold keys a rental write understands — see `strayFoldKey`. */
export const RENTAL_FOLD_KEYS = ["pickupFold", "returnFold"] as const;

/**
 * A `…Fold` key the schema does not know. zod strips unknown keys, so a
 * misspelt fold would be dropped without a word and the rental stored at the
 * hour the user just said was wrong; the route refuses it instead (rail's rule).
 */
export function strayFoldKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const known: readonly string[] = RENTAL_FOLD_KEYS;
  return Object.keys(body).find((key) => /fold/i.test(key) && !known.includes(key)) ?? null;
}

const money = z.number().min(0).max(10_000_000);

const baseRentalSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  operatedBy: optionalText(100),
  broker: optionalText(100),
  confirmationNumber: optionalText(60),
  brokerReference: optionalText(60),
  agreementNumber: optionalText(60),
  invoiceNumber: optionalText(60),
  pickupStation: rentalStationSchema,
  /**
   * Absent on create means "returned where it was picked up" — the form's
   * default tick. Sent, it is the return station.
   */
  returnStation: rentalStationSchema.nullable().optional(),
  pickupLocal: wallClock,
  returnLocal: wallClock,
  pickupFold: foldField,
  returnFold: foldField,
  /** What happened at the counter, when recorded; null clears it. */
  actualPickupLocal: wallClock.nullable().optional(),
  actualReturnLocal: wallClock.nullable().optional(),
  vehicleClass: optionalText(80),
  acrissCode: z
    .string()
    .trim()
    .refine(isAcrissCode, "is not an ACRISS code")
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  vehicleExample: optionalText(120),
  vehicleDriven: optionalText(120),
  /**
   * The licence plate as the reader typed it (forgejo#196). Free text: plates
   * differ by country and a rental's may be foreign, so only the length is
   * checked; trimmed, and "" clears it like every other text field.
   */
  licensePlate: optionalText(RENTAL_LICENSE_PLATE_MAX),
  /**
   * A person's km figure is a labelled correction (`distanceSource: user`);
   * the invoice's figure arrives through the document path. Null clears it.
   */
  distanceKm: z.number().int().min(0).max(100_000).nullable().optional(),
  mileagePolicy: z.enum(RENTAL_MILEAGE_POLICIES).nullable().optional(),
  mileageCapKm: z.number().int().positive().max(100_000).nullable().optional(),
  fuelPolicy: z.enum(RENTAL_FUEL_POLICIES).nullable().optional(),
  paymentTiming: z.enum(RENTAL_PAYMENT_TIMINGS).nullable().optional(),
  /** Null = unknown. A package price is null, not 0 (§1.3 no. 4). */
  price: money.nullable().optional(),
  currency: currencyField.nullable().optional(),
  /**
   * The invoice's charged total, typed only as a labelled correction
   * (`finalAmountSource: user`); the invoice path writes it as `invoice`.
   */
  finalAmount: money.nullable().optional(),
  finalCurrency: currencyField.nullable().optional(),
  inclusions: z.array(z.enum(RENTAL_INCLUSIONS)).max(RENTAL_INCLUSIONS.length).optional(),
  arrivalFlightNumber: optionalText(12),
  status: z.enum(RENTAL_WRITE_STATUSES).default("scheduled"),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  routeId: z.string().uuid().nullable().optional(),
});

/**
 * No return-before-pickup refine here: two wall clocks in two zones do not
 * compare (a one-way rental across a zone line). The route checks the
 * INSTANTS once it knows both zones.
 */
export const createRentalSchema = baseRentalSchema;

export const updateRentalSchema = partialForUpdate(baseRentalSchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const rentalQuerySchema = z.object({
  status: z.union([z.enum(RENTAL_STATUSES), z.array(z.enum(RENTAL_STATUSES))]).optional(),
  /** Free text over provider, broker, numbers, stations and vehicle. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Calendar year of the pickup, on the pickup station's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(RENTAL_SORT_FIELDS).default("pickup"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** GET /rentals/stations — airports plus the user's own earlier stations. */
export const rentalStationSearchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RentalStationInput = z.infer<typeof rentalStationSchema>;
export type CreateRentalInput = z.infer<typeof createRentalSchema>;
/** The write body as a client sends it (before defaults and transforms) — what a parse candidate carries. */
export type CreateRentalBody = z.input<typeof createRentalSchema>;
export type UpdateRentalInput = z.infer<typeof updateRentalSchema>;
export type RentalQueryInput = z.infer<typeof rentalQuerySchema>;
