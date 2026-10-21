/**
 * What each shareable entry carries on the trip-share wire (spec 2026-10-20 §4): its fact list
 * (`services/sharing/facts/*`) minus the sender's catalogue ids, plus the references that stand
 * for them. Each shape is typed `Record<field, Codec>` against its fact list, so a fact added to
 * a list is a compile error here until someone decides how it travels, and an extra key is one
 * too. `wireShapes.test.ts` holds the same inventory at run time.
 *
 * Catalogue ids never travel: a ship goes by IMO, a port by UN/LOCODE, a rail station by its
 * source id and UIC code, an airport by ICAO and IATA — each with name and position, so the
 * receiver can keep what its own catalogue does not hold. A lodging chain goes by name, and only
 * a catalogue chain (a chain a user made is their own row, S1 rule).
 */
import { z } from "../../../../schemas/zod";
import { SHARE_ENTITIES, type ShareEntity } from "../../shareTypes";
import type {
  BusFactField,
  CruiseFactField,
  CruiseLegFactField,
  CruiseStopFactField,
  FerryFactField,
  FlightFactField,
  LodgingFactField,
  LodgingStayFactField,
  RailFactField,
  RentalFactField,
  StopFactField,
  TripFactField,
} from "../../facts";
import { lat, lon, portRef, shipRef } from "../../../trip/exchange/publicHalf";
import * as C from "./codec";
import type { Codec } from "./codec";

/** The sender's catalogue ids per entity, and the reference that replaces each on the wire. */
export const CATALOGUE_REFS = {
  flight: {},
  lodgingStay: {},
  cruise: { shipId: "ship", departurePortId: "departurePort", arrivalPortId: "arrivalPort" },
  rail: { depStationId: "depStation", arrStationId: "arrStation" },
  bus: {},
  ferry: {},
  rental: { pickupAirportId: "pickupAirport", returnAirportId: "returnAirport" },
  stop: {},
} as const satisfies Readonly<Record<ShareEntity, Readonly<Record<string, string>>>>;
export const CRUISE_STOP_REFS = { portId: "port" } as const;
export const CRUISE_LEG_REFS = { fromPortId: "fromPort", toPortId: "toPort" } as const;

/**
 * The pseudo-facts the adapters add (`adapters/*.ts`): a stay's house, a cruise's port calls and
 * legs, the entries a timeline stop wraps. `lodging` replaces the house's `catalogueChainId`
 * with `chain`, its name.
 */
export const PSEUDO_FACTS = {
  flight: [],
  lodgingStay: ["lodging"],
  cruise: ["stops", "legs"],
  rail: [],
  bus: [],
  ferry: [],
  rental: [],
  stop: ["sourceRef", "lodgingStayRef"],
} as const satisfies Readonly<Record<ShareEntity, readonly string[]>>;

export const stationRef = z.strictObject({
  sourceId: z.string().max(200).nullable(),
  uic: z.string().max(40).nullable(),
  name: z.string().max(200),
  lat,
  lon,
});
export const airportRef = z.strictObject({
  icao: z.string().max(8).nullable(),
  iata: z.string().max(8).nullable(),
  name: z.string().max(200),
  lat,
  lon,
});
/** The entry a timeline stop wraps, by its share key; resolved like locally (stops come last). */
export const entryRef = z.strictObject({
  entity: z.enum(SHARE_ENTITIES.filter((e) => e !== "stop") as [ShareEntity, ...ShareEntity[]]),
  shareKey: z.string().uuid(),
});
export type StationRef = z.infer<typeof stationRef>;
export type AirportRef = z.infer<typeof airportRef>;
export type EntryWireRef = z.infer<typeof entryRef>;

type Replace<F extends string, R extends Readonly<Record<string, string>>> =
  Exclude<F, keyof R> | R[keyof R];
type Shape<K extends string> = Readonly<Record<K, Codec>>;

const port = C.readOnly(portRef);
const optPort = C.readOnly(portRef.nullable());

export const FLIGHT_SHAPE = {
  airline: C.optText(),
  airlineIata: C.optText(8),
  airlineIcao: C.optText(8),
  operatingAirline: C.optText(),
  operatingAirlineIata: C.optText(8),
  operatingAirlineIcao: C.optText(8),
  isCodeshare: C.optBool,
  flightNumber: C.optText(40),
  callsign: C.optText(40),
  aircraft: C.optText(),
  aircraftRegistration: C.optText(40),
  aircraftModeS: C.optText(40),
  depIcao: C.optText(8),
  depIata: C.optText(8),
  depName: C.optText(),
  depLat: C.latitude,
  depLon: C.longitude,
  arrIcao: C.optText(8),
  arrIata: C.optText(8),
  arrName: C.optText(),
  arrLat: C.latitude,
  arrLon: C.longitude,
  departureTime: C.optInstant,
  arrivalTime: C.optInstant,
  depTimeSemantics: C.text(40),
  arrTimeSemantics: C.text(40),
  depTimezone: C.timeZone,
  arrTimezone: C.timeZone,
  depPrecision: C.optText(40),
  arrPrecision: C.optText(40),
  status: C.status,
  gate: C.optText(40),
  terminal: C.optText(40),
  actualDeparture: C.optInstant,
  actualArrival: C.optInstant,
  delayMinutes: C.optInt,
  runwayDepartureTime: C.optInstant,
  runwayArrivalTime: C.optInstant,
  actualRoute: C.geometry,
  overflownCountries: C.strings,
  routeDistance: C.optNum,
  routeSource: C.optText(80),
  co2Kg: C.optNum,
  specialType: C.optText(80),
  eventLat: C.optLatitude,
  eventLon: C.optLongitude,
  eventLabel: C.optText(),
  patternLat: C.optLatitude,
  patternLon: C.optLongitude,
  specialData: C.json,
} as const satisfies Shape<FlightFactField>;

export const HOUSE_SHAPE = {
  countryVisitKind: C.text(40),
  type: C.text(40),
  name: C.name(),
  address: C.optText(),
  city: C.optText(200),
  country: C.optText(200),
  isoCountryCode: C.optText(8),
  lat: C.optLatitude,
  lon: C.optLongitude,
  stars: C.optInt,
  website: C.optText(),
  wikidataId: C.optText(40),
  amenities: C.strings,
  chain: C.optText(200),
} as const satisfies Shape<LodgingFactField | "chain">;

export const STAY_SHAPE = {
  checkIn: C.optInstant,
  checkOut: C.optInstant,
  checkInTime: C.optText(16),
  checkOutTime: C.optText(16),
  checkInDate: C.optDay,
  checkOutDate: C.optDay,
  checkInAt: C.optInstant,
  checkOutAt: C.optInstant,
  stayZone: C.timeZone,
  datePrecision: C.text(40),
  nights: C.optInt,
  status: C.status,
  board: C.optText(80),
  lodging: C.object(HOUSE_SHAPE),
} as const satisfies Shape<LodgingStayFactField | "lodging">;

export const CRUISE_STOP_SHAPE = {
  port: optPort,
  dayNumber: C.int,
  date: C.optInstant,
  isAtSea: C.bool,
  arrivalTime: C.optInstant,
  departureTime: C.optInstant,
  arrivalUtc: C.optInstant,
  departureUtc: C.optInstant,
  stopZone: C.timeZone,
  stopDate: C.optDay,
  timePrecision: C.optText(40),
  unresolvedPortName: C.optText(200),
} as const satisfies Shape<Replace<CruiseStopFactField, typeof CRUISE_STOP_REFS>>;

export const CRUISE_LEG_SHAPE = {
  ordinal: C.int,
  fromPort: port,
  toPort: port,
  distanceKm: C.num,
  method: C.text(80),
  routerVersion: C.text(80),
  dataVersion: C.optText(80),
  confidence: C.text(40),
  computedAt: C.instant,
} as const satisfies Shape<Replace<CruiseLegFactField, typeof CRUISE_LEG_REFS>>;

export const CRUISE_SHAPE = {
  ship: C.readOnly(shipRef.nullable()),
  shipNameOverride: C.optText(200),
  cruiseLine: C.optText(200),
  departurePort: optPort,
  arrivalPort: optPort,
  routeName: C.optText(300),
  startDate: C.optInstant,
  endDate: C.optInstant,
  startDay: C.optDay,
  endDay: C.optDay,
  startZone: C.timeZone,
  endZone: C.timeZone,
  status: C.status,
  stops: C.list(C.object(CRUISE_STOP_SHAPE), 400),
  legs: C.list(C.object(CRUISE_LEG_SHAPE), 400),
} as const satisfies Shape<
  Replace<CruiseFactField, (typeof CATALOGUE_REFS)["cruise"]> | "stops" | "legs"
>;

const station = C.readOnly(stationRef.nullable());

export const RAIL_SHAPE = {
  operator: C.optText(200),
  trainCategory: C.optText(80),
  trainNumber: C.optText(80),
  depStationName: C.name(200),
  depStationCode: C.optText(40),
  depStation: station,
  depLat: C.latitude,
  depLon: C.longitude,
  depCountry: C.optText(200),
  depTimezone: C.timeZone,
  arrStationName: C.name(200),
  arrStationCode: C.optText(40),
  arrStation: station,
  arrLat: C.latitude,
  arrLon: C.longitude,
  arrCountry: C.optText(200),
  arrTimezone: C.timeZone,
  departureTime: C.instant,
  arrivalTime: C.optInstant,
  depPrecision: C.optText(40),
  arrPrecision: C.optText(40),
  distanceKm: C.optNum,
  distanceSource: C.optText(80),
  geometry: C.geometry,
  geometrySource: C.text(80),
  actualDepartureTime: C.optInstant,
  actualArrivalTime: C.optInstant,
  lookupProvider: C.optText(80),
  lookupRef: C.optText(),
  status: C.status,
  delayMinutes: C.optInt,
} as const satisfies Shape<Replace<RailFactField, (typeof CATALOGUE_REFS)["rail"]>>;

/** Bus and ferry share their terminal columns; each adds its own service fields. */
const TERMINALS = {
  depStationName: C.name(200),
  depAddress: C.optText(),
  depLat: C.latitude,
  depLon: C.longitude,
  depCountry: C.optText(200),
  depTimezone: C.timeZone,
  arrStationName: C.name(200),
  arrAddress: C.optText(),
  arrLat: C.latitude,
  arrLon: C.longitude,
  arrCountry: C.optText(200),
  arrTimezone: C.timeZone,
  departureTime: C.instant,
  arrivalTime: C.optInstant,
  depPrecision: C.optText(40),
  arrPrecision: C.optText(40),
  distanceKm: C.optNum,
  distanceSource: C.optText(80),
  geometry: C.geometry,
  geometrySource: C.text(80),
  actualDepartureTime: C.optInstant,
  actualArrivalTime: C.optInstant,
  status: C.status,
  delayMinutes: C.optInt,
} as const;

export const BUS_SHAPE = {
  operator: C.optText(200),
  lineName: C.optText(200),
  rideKind: C.optText(40),
  ...TERMINALS,
} as const satisfies Shape<BusFactField>;

export const FERRY_SHAPE = {
  operator: C.optText(200),
  vesselName: C.optText(200),
  ...TERMINALS,
} as const satisfies Shape<FerryFactField>;

const airport = C.readOnly(airportRef.nullable());

export const RENTAL_SHAPE = {
  provider: C.name(200),
  operatedBy: C.optText(200),
  pickupStationName: C.name(200),
  pickupAddress: C.optText(),
  pickupAirport: airport,
  pickupLat: C.latitude,
  pickupLon: C.longitude,
  pickupCountry: C.optText(200),
  pickupTimezone: C.requiredTimeZone,
  returnStationName: C.name(200),
  returnAddress: C.optText(),
  returnAirport: airport,
  returnLat: C.latitude,
  returnLon: C.longitude,
  returnCountry: C.optText(200),
  returnTimezone: C.requiredTimeZone,
  pickupTime: C.instant,
  returnTime: C.instant,
  pickupPrecision: C.text(40),
  returnPrecision: C.text(40),
  actualPickupTime: C.optInstant,
  actualReturnTime: C.optInstant,
  actualPickupPrecision: C.optText(40),
  actualReturnPrecision: C.optText(40),
  vehicleClass: C.optText(80),
  acrissCode: C.optText(8),
  vehicleExample: C.optText(200),
  vehicleDriven: C.optText(200),
  licensePlate: C.optText(40),
  odometerOutKm: C.optInt,
  odometerInKm: C.optInt,
  distanceKm: C.optInt,
  distanceSource: C.optText(80),
  mileagePolicy: C.optText(80),
  mileageCapKm: C.optInt,
  fuelPolicy: C.optText(80),
  status: C.status,
} as const satisfies Shape<Replace<RentalFactField, (typeof CATALOGUE_REFS)["rental"]>>;

const optEntry = C.readOnly(entryRef.nullable());

export const STOP_SHAPE = {
  orderIdx: C.int,
  domain: C.optText(40),
  title: C.name(300),
  description: C.optText(5_000),
  startDate: C.optInstant,
  endDate: C.optInstant,
  lat: C.optLatitude,
  lon: C.optLongitude,
  startUtc: C.optInstant,
  endUtc: C.optInstant,
  stopZone: C.timeZone,
  precision: C.optText(40),
  sourceRef: optEntry,
  lodgingStayRef: optEntry,
} as const satisfies Shape<StopFactField | "sourceRef" | "lodgingStayRef">;

/** The trip's own facts, as an offer carries them (`TRIP_FACT_FIELDS`). */
export const TRIP_SHAPE = {
  name: C.name(200),
  description: C.optText(5_000),
  color: C.text(32),
  icon: C.optText(80),
  startDate: C.optInstant,
  endDate: C.optInstant,
  startDay: C.optDay,
  endDay: C.optDay,
  startZone: C.timeZone,
  endZone: C.timeZone,
  status: C.status,
  originLabel: C.optText(200),
  destinationLabel: C.optText(200),
  countries: C.strings,
} as const satisfies Shape<TripFactField>;

export const ENTRY_SHAPES: Readonly<Record<ShareEntity, Readonly<Record<string, Codec>>>> = {
  flight: FLIGHT_SHAPE,
  lodgingStay: STAY_SHAPE,
  cruise: CRUISE_SHAPE,
  rail: RAIL_SHAPE,
  bus: BUS_SHAPE,
  ferry: FERRY_SHAPE,
  rental: RENTAL_SHAPE,
  stop: STOP_SHAPE,
};

const shareKey = z.string().uuid();

/** One entry on the wire: `{ entity, shareKey, facts }`, discriminated on `entity`. */
export const wireEntrySchema = z.discriminatedUnion(
  "entity",
  SHARE_ENTITIES.map((entity) =>
    z.strictObject({
      entity: z.literal(entity),
      shareKey,
      facts: C.strictShape(ENTRY_SHAPES[entity]),
    })
  ) as unknown as [z.ZodObject, ...z.ZodObject[]]
);
export type WireEntry = { entity: ShareEntity; shareKey: string; facts: Record<string, unknown> };

export const wireTripSchema = C.strictShape(TRIP_SHAPE);
