/**
 * The `.travstats` single-trip file (spec 2026-10-09 trip sharing, decision 6,
 * phase S3).
 *
 * A ZIP holding:
 *   manifest.json   what the file is: format, version, writer, options
 *   trip.json       the trip and every entry's facts — and, only when the
 *                   exporter chose so, the private fields (seat, cabin, own
 *                   price, ratings, notes, journal, companion names)
 *   documents/…     kept originals, only when chosen
 *   photos/…        trip photos, only when chosen
 *
 * One schema serves the writer and the reader, so the writer cannot emit what
 * the reader refuses. Times are written exactly as stored (ADR 0002): an
 * instant column as an ISO instant, a calendar column as `YYYY-MM-DD`, a zone
 * as its IANA name — never re-derived on either side.
 *
 * Entries reference each other by file-local keys (`b1`, `s3`), never by
 * database ids: an id means nothing on another server and says more about
 * this one than the file needs to.
 */
import { z } from "zod";

export const TRIP_FILE_FORMAT = "travstats-trip";
export const TRIP_FILE_VERSION = 1;
export const TRIP_FILE_EXTENSION = ".travstats";

/** Hard limits on what a reader unpacks — a few KB of ZIP must not become gigabytes. */
export const TRIP_FILE_LIMITS = {
  /** The upload itself. */
  maxUploadBytes: 100 * 1024 * 1024,
  /** Everything unpacked together, as actually inflated (not as declared). */
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntries: 2000,
  maxManifestBytes: 64 * 1024,
  maxTripJsonBytes: 10 * 1024 * 1024,
  maxDocumentBytes: 25 * 1024 * 1024,
  maxPhotoBytes: 15 * 1024 * 1024,
} as const;

/** The only names a file entry may carry inside `documents/` and `photos/`. */
export const ENTRY_FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/;

const str = (max: number) => z.string().max(max);
const optStr = (max: number) => str(max).nullable();
const instant = z.iso.datetime({ offset: true }).nullable();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const zone = optStr(200);
const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const money = z.number().finite().nullable();
const currency = optStr(10);
const key = z.string().regex(/^[a-z]{1,3}\d{1,5}$/);
const names = z.array(str(200)).max(50);
const tags = z.array(str(200)).max(50);

// ------------------------------------------------------------------ manifest

export const exportOptionsSchema = z
  .object({ documents: z.boolean(), photos: z.boolean(), private: z.boolean() })
  .strict();
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

/**
 * Checked in two steps: format and version first (so an unknown version is
 * refused by name, not as a schema failure), then the rest.
 */
export const manifestHeadSchema = z.object({
  format: z.literal(TRIP_FILE_FORMAT),
  formatVersion: z.number().int().positive(),
});

export const manifestSchema = manifestHeadSchema
  .extend({
    formatVersion: z.literal(TRIP_FILE_VERSION),
    appVersion: str(200),
    exportedAt: z.iso.datetime({ offset: true }),
    options: exportOptionsSchema,
  })
  .strict();
export type TripFileManifest = z.infer<typeof manifestSchema>;

// ------------------------------------------------------------------ trip.json

const tripSchema = z
  .object({
    name: str(200).min(1),
    description: optStr(5000),
    color: optStr(200),
    icon: optStr(200),
    category: optStr(200),
    tags,
    status: optStr(200),
    startDate: instant,
    endDate: instant,
    startDay: day,
    endDay: day,
    startZone: zone,
    endZone: zone,
    originLabel: optStr(200),
    destinationLabel: optStr(200),
    countries: z.array(str(200)).max(250),
    private: z
      .object({ notes: optStr(50_000), summary: optStr(20_000), companions: names })
      .strict()
      .optional(),
  })
  .strict();

const bookingSchema = z
  .object({ key, pnr: optStr(200), price: money, currency })
  .strict();

const flightPrivate = z
  .object({
    seatNumber: optStr(200),
    seatClass: optStr(200),
    boardingGroup: optStr(200),
    ticketNumber: optStr(200),
    frequentFlyerNumber: optStr(200),
    bookingClassLetter: optStr(200),
    notes: optStr(10_000),
    price: money,
    currency,
    companions: names,
  })
  .strict();

const flightSchema = z
  .object({
    key,
    bookingKey: key.nullable(),
    externalRef: optStr(200),
    flightNumber: optStr(200),
    airline: optStr(200),
    airlineIata: optStr(200),
    airlineIcao: optStr(200),
    operatingAirline: optStr(200),
    operatingAirlineIata: optStr(200),
    operatingAirlineIcao: optStr(200),
    aircraft: optStr(200),
    aircraftRegistration: optStr(200),
    depIata: optStr(200),
    depIcao: optStr(200),
    depName: optStr(200),
    depLat: lat,
    depLon: lon,
    arrIata: optStr(200),
    arrIcao: optStr(200),
    arrName: optStr(200),
    arrLat: lat,
    arrLon: lon,
    departureTime: instant,
    arrivalTime: instant,
    depTimezone: zone,
    arrTimezone: zone,
    depTimeSemantics: str(200),
    arrTimeSemantics: str(200),
    depPrecision: optStr(200),
    arrPrecision: optStr(200),
    status: str(200),
    specialType: optStr(200),
    private: flightPrivate.optional(),
  })
  .strict();

const lodgingSchema = z
  .object({
    type: str(200),
    name: str(200).min(1),
    address: optStr(300),
    city: optStr(200),
    country: optStr(200),
    isoCountryCode: optStr(200),
    lat: lat.nullable(),
    lon: lon.nullable(),
    stars: z.number().int().min(0).max(7).nullable(),
    website: optStr(500),
    wikidataId: optStr(200),
    externalRef: optStr(200),
  })
  .strict();

const stayPrivate = z
  .object({
    roomNumber: optStr(200),
    ratingRoom: z.number().nullable(),
    ratingBreakfast: z.number().nullable(),
    ratingService: z.number().nullable(),
    ratingOverall: z.number().nullable(),
    pricePerNight: money,
    totalPrice: money,
    currency,
    notes: optStr(10_000),
    companions: names,
  })
  .strict();

const staySchema = z
  .object({
    key,
    bookingKey: key.nullable(),
    externalRef: optStr(200),
    lodging: lodgingSchema,
    checkIn: instant,
    checkOut: instant,
    checkInTime: optStr(200),
    checkOutTime: optStr(200),
    checkInDate: day,
    checkOutDate: day,
    checkInAt: instant,
    checkOutAt: instant,
    stayZone: zone,
    datePrecision: str(200),
    nights: z.number().int().min(0).max(3660).nullable(),
    status: str(200),
    board: optStr(200),
    roomCategory: optStr(200),
    guests: z.number().int().min(0).max(100).nullable(),
    private: stayPrivate.optional(),
  })
  .strict();

const portRef = z
  .object({
    unlocode: optStr(200),
    name: str(200),
    country: optStr(200),
    lat,
    lon,
  })
  .strict();

const cruiseStopSchema = z
  .object({
    dayNumber: z.number().int().min(0).max(400),
    date: instant,
    isAtSea: z.boolean(),
    port: portRef.nullable(),
    unresolvedPortName: optStr(200),
    arrivalTime: instant,
    departureTime: instant,
    arrivalUtc: instant,
    departureUtc: instant,
    stopZone: zone,
    stopDate: day,
    timePrecision: optStr(200),
  })
  .strict();

const cruisePrivate = z
  .object({
    cabinNumber: optStr(200),
    cabinType: optStr(200),
    deck: z.number().int().min(-5).max(50).nullable(),
    price: money,
    currency,
    notes: optStr(10_000),
    companions: names,
  })
  .strict();

const cruiseSchema = z
  .object({
    key,
    bookingKey: key.nullable(),
    externalRef: optStr(200),
    bookingReference: optStr(200),
    ship: z
      .object({ name: str(200), imo: optStr(200), cruiseLine: str(200) })
      .strict()
      .nullable(),
    shipNameOverride: optStr(200),
    cruiseLine: optStr(200),
    routeName: optStr(300),
    departurePort: portRef.nullable(),
    arrivalPort: portRef.nullable(),
    startDate: instant,
    endDate: instant,
    startDay: day,
    endDay: day,
    startZone: zone,
    endZone: zone,
    status: str(200),
    stops: z.array(cruiseStopSchema).max(200),
    private: cruisePrivate.optional(),
  })
  .strict();

const stationRef = z
  .object({
    name: str(200).min(1),
    code: optStr(200),
    sourceId: optStr(200),
    lat,
    lon,
    country: optStr(200),
    timezone: zone,
  })
  .strict();

const railPrivate = z
  .object({
    travelClass: optStr(200),
    coach: optStr(200),
    seat: optStr(200),
    price: money,
    currency,
    notes: optStr(10_000),
    companions: names,
  })
  .strict();

const railSchema = z
  .object({
    key,
    bookingKey: key.nullable(),
    externalRef: optStr(200),
    operator: optStr(200),
    trainCategory: optStr(200),
    trainNumber: optStr(200),
    bookingReference: optStr(200),
    dep: stationRef,
    arr: stationRef,
    departureTime: z.iso.datetime({ offset: true }),
    arrivalTime: instant,
    depPrecision: optStr(200),
    arrPrecision: optStr(200),
    distanceKm: z.number().min(0).max(50_000).nullable(),
    distanceSource: optStr(200),
    status: str(200),
    private: railPrivate.optional(),
  })
  .strict();

const rentalEnd = z
  .object({
    stationName: str(200).min(1),
    address: optStr(300),
    airportIata: optStr(200),
    lat,
    lon,
    country: optStr(200),
    timezone: str(200),
  })
  .strict();

const rentalPrivate = z
  .object({
    brokerReference: optStr(200),
    agreementNumber: optStr(200),
    invoiceNumber: optStr(200),
    vehicleDriven: optStr(200),
    licensePlate: optStr(200),
    odometerOutKm: z.number().int().min(0).nullable(),
    odometerInKm: z.number().int().min(0).nullable(),
    price: money,
    currency,
    finalAmount: money,
    finalCurrency: currency,
    notes: optStr(10_000),
    companions: names,
  })
  .strict();

const rentalSchema = z
  .object({
    key,
    externalRef: optStr(200),
    provider: str(200).min(1),
    operatedBy: optStr(200),
    broker: optStr(200),
    confirmationNumber: optStr(200),
    pickup: rentalEnd,
    return: rentalEnd,
    pickupTime: z.iso.datetime({ offset: true }),
    returnTime: z.iso.datetime({ offset: true }),
    pickupPrecision: str(200),
    returnPrecision: str(200),
    vehicleClass: optStr(200),
    acrissCode: optStr(200),
    vehicleExample: optStr(200),
    mileagePolicy: optStr(200),
    mileageCapKm: z.number().int().min(0).nullable(),
    fuelPolicy: optStr(200),
    paymentTiming: optStr(200),
    inclusions: z.array(str(200)).max(50),
    arrivalFlightNumber: optStr(200),
    status: str(200),
    private: rentalPrivate.optional(),
  })
  .strict();

const placeSchema = z
  .object({
    key,
    name: str(300).min(1),
    localName: optStr(300),
    category: str(200),
    lat,
    lon,
    address: optStr(300),
    city: optStr(200),
    country: optStr(200),
    isoCountryCode: optStr(200),
    externalRef: optStr(200),
    wikidataId: optStr(200),
  })
  .strict();

const visitSchema = z
  .object({
    key,
    placeKey: key,
    visitedAt: instant,
    visitedAtUtc: instant,
    visitedZone: zone,
    visitedPrecision: optStr(200),
    orderIdx: z.number().int().min(0).max(100_000),
    private: z
      .object({ notes: optStr(10_000), rating: z.number().int().min(0).max(10).nullable() })
      .strict()
      .optional(),
  })
  .strict();

const stopSchema = z
  .object({
    key,
    orderIdx: z.number().int().min(0).max(100_000),
    title: str(300).min(1),
    description: optStr(5000),
    startDate: instant,
    endDate: instant,
    startUtc: instant,
    endUtc: instant,
    stopZone: zone,
    precision: optStr(200),
    lat: lat.nullable(),
    lon: lon.nullable(),
    overnight: z.boolean(),
    placeKey: key.nullable(),
    stayKey: key.nullable(),
    private: z
      .object({ notes: optStr(10_000) })
      .strict()
      .optional(),
  })
  .strict();

const journalSchema = z
  .object({
    date: z.iso.datetime({ offset: true }),
    day,
    title: optStr(300),
    body: str(50_000),
    mood: optStr(200),
    weather: optStr(200),
  })
  .strict();

export const ENTITY_KINDS = [
  "trip",
  "flight",
  "stay",
  "cruise",
  "rail",
  "rental",
  "visit",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

const documentSchema = z
  .object({
    file: z.string().regex(/^documents\/[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/),
    entity: z.object({ kind: z.enum(ENTITY_KINDS), key: key.nullable() }).strict(),
    kind: optStr(200),
    issuedOn: day,
    originalName: optStr(200),
  })
  .strict();

const photoSchema = z
  .object({
    file: z.string().regex(/^photos\/[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/),
    caption: optStr(2000),
    takenAt: instant,
    lat: lat.nullable(),
    lon: lon.nullable(),
    sortIdx: z.number().int().min(0).max(100_000),
    stopKey: key.nullable(),
  })
  .strict();

export const tripFileSchema = z
  .object({
    trip: tripSchema,
    bookings: z.array(bookingSchema).max(100),
    flights: z.array(flightSchema).max(300),
    stays: z.array(staySchema).max(300),
    cruises: z.array(cruiseSchema).max(20),
    rail: z.array(railSchema).max(300),
    rentals: z.array(rentalSchema).max(50),
    places: z.array(placeSchema).max(1000),
    visits: z.array(visitSchema).max(2000),
    stops: z.array(stopSchema).max(1000),
    journal: z.array(journalSchema).max(2000).optional(),
    documents: z.array(documentSchema).max(500),
    photos: z.array(photoSchema).max(1500),
  })
  .strict()
  .superRefine((file, ctx) => {
    // Every reference must name an entry of the file — a dangling key is a
    // broken file, not something to guess around.
    const keysOf = (list: readonly { key: string }[]) => new Set(list.map((e) => e.key));
    const bookings = keysOf(file.bookings);
    const places = keysOf(file.places);
    const stays = keysOf(file.stays);
    const stops = keysOf(file.stops);
    const byKind: Record<EntityKind, Set<string>> = {
      trip: new Set(),
      flight: keysOf(file.flights),
      stay: stays,
      cruise: keysOf(file.cruises),
      rail: keysOf(file.rail),
      rental: keysOf(file.rentals),
      visit: keysOf(file.visits),
    };
    const dangling = (path: (string | number)[], ref: string | null, known: Set<string>) => {
      if (ref !== null && !known.has(ref)) {
        ctx.addIssue({ code: "custom", path, message: `unknown key "${ref}"` });
      }
    };
    for (const [list, name] of [
      [file.flights, "flights"],
      [file.stays, "stays"],
      [file.cruises, "cruises"],
      [file.rail, "rail"],
    ] as const) {
      list.forEach((e, i) => dangling([name, i, "bookingKey"], e.bookingKey, bookings));
    }
    file.visits.forEach((v, i) => dangling(["visits", i, "placeKey"], v.placeKey, places));
    file.stops.forEach((s, i) => {
      dangling(["stops", i, "placeKey"], s.placeKey, places);
      dangling(["stops", i, "stayKey"], s.stayKey, stays);
    });
    file.photos.forEach((p, i) => dangling(["photos", i, "stopKey"], p.stopKey, stops));
    file.documents.forEach((d, i) => {
      if (d.entity.kind === "trip") return;
      if (d.entity.key === null) {
        ctx.addIssue({ code: "custom", path: ["documents", i], message: "entity key missing" });
      } else dangling(["documents", i, "entity"], d.entity.key, byKind[d.entity.kind]);
    });
  });
export type TripFile = z.infer<typeof tripFileSchema>;
export type TripFileFlight = TripFile["flights"][number];
export type TripFileStay = TripFile["stays"][number];
export type TripFileCruise = TripFile["cruises"][number];
export type TripFileRail = TripFile["rail"][number];
export type TripFileRental = TripFile["rentals"][number];
export type TripFilePlace = TripFile["places"][number];
export type TripFileVisit = TripFile["visits"][number];
export type TripFileStop = TripFile["stops"][number];
export type TripFilePortRef = z.infer<typeof portRef>;
