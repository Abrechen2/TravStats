/**
 * Seeds a fully-featured demo account that exercises every flight + cruise
 * feature. Idempotent: deletes all existing data for user "demo" and
 * re-creates everything.
 *
 * Invoked automatically by `init.ts` on first install (when no users
 * exist yet) and exposed as the `seed:demo` npm script for manual
 * re-seeding in dev:
 *
 *   DATABASE_URL=... npx tsx src/seedDemoAccount.ts
 *   npm run seed:demo               # uses dist/seedDemoAccount.js
 *
 * Covers:
 *   - 160 flights across every status / category / seat class / year (2015–2027)
 *   - Operating-airline (codeshare), companions, co-passengers, tags, notes
 *   - Prices, taxes, fees, delays, CO₂, actual-times, parser-template metadata
 *   - 22 cruises across every cruise line in seed data + varied regions
 *   - Cruise stops incl. sea days, renumbered consecutively per cruise
 *   - Trips + bookings linking flights + cruises
 *   - Both domains enabled on user settings
 *   - Achievements recomputed at the end
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword } from "./utils/password";
import { checkAndUpdateAchievements } from "./utils/achievements";
import { calculateCo2Kg, toSeatClass } from "./services/co2Calculator";
import { linkRowsFor, resolveCompanions } from "./services/companionService";

type AirportRow = {
  id: number;
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
};

type ShipRow = { id: number; name: string; cruiseLine: string };
type PortRow = {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  unlocode: string | null;
};

const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo123";

// ------------------------------------------------------------------ utilities

const r = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: readonly T[]): T => arr[r(arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(r(copy.length), 1)[0]);
  }
  return out;
};
const chance = (p: number) => Math.random() < p;

function randDateBetween(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function addHours(d: Date, h: number): Date {
  const out = new Date(d);
  out.setUTCHours(out.getUTCHours() + Math.floor(h));
  out.setUTCMinutes(out.getUTCMinutes() + Math.floor((h % 1) * 60));
  return out;
}

function greatCircleKm(a: AirportRow, b: AirportRow): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pnr(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[r(chars.length)];
  return out;
}

function seatNumber(cls: string): string {
  const row = 1 + r(cls === "first" ? 4 : cls === "business" ? 12 : 40);
  const col = "ABCDEF"[r(6)];
  return `${row}${col}`;
}

// --------------------------------------------------------------------- pools

const AIRPORT_IATAS = [
  "MUC", "FRA", "BER", "HAM", "DUS", "STR", "NUE",
  "LHR", "CDG", "ORY", "AMS", "MAD", "BCN", "PMI", "AGP", "LPA", "TFS",
  "FCO", "MXP", "LIN", "NAP", "CTA", "PSA",
  "VIE", "ZRH", "GVA", "PRG", "WAW", "BUD", "ATH", "IST", "DUB", "CPH",
  "ARN", "OSL", "LIS", "OPO",
  "JFK", "LAX", "ORD", "SFO", "MIA", "YYZ", "YVR", "MEX",
  "HND", "NRT", "KIX", "ICN", "HKG", "SIN", "BKK", "KUL", "MNL", "CGK",
  "DEL", "BOM", "PEK", "PVG", "TPE",
  "DXB", "DOH", "AUH", "MCT", "RUH", "JED", "TLV", "BEY",
  "SYD", "MEL", "AKL",
  "GRU", "EZE", "SCL",
  "CPT", "JNB", "CAI", "RAK", "NBO",
];

const AIRLINES = [
  { name: "Lufthansa", prefix: "LH", aircraft: ["A320neo", "A321neo", "A350-900", "B747-8", "A380"], hub: "FRA" },
  { name: "British Airways", prefix: "BA", aircraft: ["A320", "A321neo", "B787-9", "A380"], hub: "LHR" },
  { name: "Air France", prefix: "AF", aircraft: ["A220-300", "A320neo", "B777-300ER", "A350-900"], hub: "CDG" },
  { name: "KLM", prefix: "KL", aircraft: ["E195-E2", "B737-800", "B787-9"], hub: "AMS" },
  { name: "Swiss", prefix: "LX", aircraft: ["A220-300", "A320neo", "A330-300", "B777-300ER"], hub: "ZRH" },
  { name: "Austrian Airlines", prefix: "OS", aircraft: ["A320", "B767-300ER", "B777-200ER"], hub: "VIE" },
  { name: "Iberia", prefix: "IB", aircraft: ["A320neo", "A350-900"], hub: "MAD" },
  { name: "Finnair", prefix: "AY", aircraft: ["A320", "A350-900"], hub: "HEL" },
  { name: "SAS", prefix: "SK", aircraft: ["A320neo", "A321LR", "A330-300"], hub: "CPH" },
  { name: "Emirates", prefix: "EK", aircraft: ["A380", "B777-300ER"], hub: "DXB" },
  { name: "Qatar Airways", prefix: "QR", aircraft: ["A350-1000", "B777-300ER", "A380"], hub: "DOH" },
  { name: "Singapore Airlines", prefix: "SQ", aircraft: ["A380", "A350-900", "B787-10"], hub: "SIN" },
  { name: "Turkish Airlines", prefix: "TK", aircraft: ["A321neo", "B787-9", "A350-900"], hub: "IST" },
  { name: "ANA", prefix: "NH", aircraft: ["B787-9", "B777-300ER", "A380"], hub: "HND" },
  { name: "American Airlines", prefix: "AA", aircraft: ["B737 MAX 8", "B787-9", "A321neo"], hub: "JFK" },
  { name: "United Airlines", prefix: "UA", aircraft: ["B737-900ER", "B787-9", "B777-300ER"], hub: "SFO" },
  { name: "Delta Air Lines", prefix: "DL", aircraft: ["B767-400ER", "A330-900", "A350-900"], hub: "JFK" },
  { name: "Qantas", prefix: "QF", aircraft: ["A380", "B787-9", "A330-300"], hub: "SYD" },
  { name: "Eurowings", prefix: "EW", aircraft: ["A319", "A320neo"], hub: "DUS" },
  { name: "Ryanair", prefix: "FR", aircraft: ["B737-800", "B737 MAX 8-200"], hub: "DUB" },
];

const SEAT_CLASSES = [
  ["economy", 0.68],
  ["premium_economy", 0.15],
  ["business", 0.12],
  ["first", 0.05],
] as const;

const CATEGORIES = [
  ["vacation", 0.5],
  ["business", 0.32],
  ["private", 0.18],
] as const;

const TAG_POOL = [
  "honeymoon", "family", "solo", "weekend", "long-haul", "award-ticket",
  "status-run", "work", "conference", "redeye", "summer", "winter",
  "first-time", "connection", "bucket-list",
];

const COMPANION_POOL = [
  "Sarah Müller", "Jonas Weber", "Anna Fischer", "Max Hoffmann", "Clara Becker",
  "Mia Schmidt", "Leon Wagner", "Emma Schulz",
];

const CO_PASSENGER_POOL = [
  "MUELLER/SARAH MS", "WEBER/JONAS MR", "FISCHER/ANNA MRS",
  "HOFFMANN/MAX MR", "BECKER/CLARA MS",
];

function weightedPick<T extends string>(pairs: ReadonlyArray<readonly [T, number]>): T {
  let acc = 0;
  const roll = Math.random();
  for (const [value, weight] of pairs) {
    acc += weight;
    if (roll <= acc) return value;
  }
  return pairs[pairs.length - 1][0];
}

// ------------------------------------------------------------- cruise domain

type CruiseTemplate = {
  line: string;
  shipName: string;
  region: string;
  cabinType: string | null;
  deck: number | null;
  priceEur: number | null;
  tags: string[];
  durationDays: number;
  stops: Array<{ portName?: string; isAtSea?: boolean; excursionNote?: string }>;
  companions: string[];
};

const CRUISE_TEMPLATES: readonly CruiseTemplate[] = [
  {
    line: "AIDA Cruises", shipName: "AIDAnova", region: "Mittelmeer",
    cabinType: "Balkon", deck: 9, priceEur: 2490, durationDays: 7,
    tags: ["mittelmeer", "familie"], companions: ["Sarah Müller"],
    stops: [
      { portName: "Barcelona", excursionNote: "Sagrada Família Tour" },
      { portName: "Palma de Mallorca", excursionNote: "Kathedrale La Seu" },
      { isAtSea: true }, { portName: "Civitavecchia", excursionNote: "Ausflug Rom" },
      { portName: "Naples", excursionNote: "Pompeji + Vesuv" },
      { portName: "Marseille" }, { portName: "Barcelona" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAcosma", region: "Nordland",
    cabinType: "Juniorsuite", deck: 11, priceEur: 3390, durationDays: 10,
    tags: ["norwegian-fjords", "bucket-list"], companions: ["Sarah Müller", "Jonas Weber"],
    stops: [
      { portName: "Hamburg" }, { isAtSea: true }, { portName: "Bergen" },
      { portName: "Flåm", excursionNote: "Flåmsbana Bahn" },
      { portName: "Geiranger", excursionNote: "Dalsnibba Aussichtsplattform" },
      { portName: "Ålesund" }, { isAtSea: true }, { portName: "Oslo" },
      { portName: "Copenhagen" }, { portName: "Hamburg" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAprima", region: "Ostsee",
    cabinType: "Außenkabine", deck: 6, priceEur: 1290, durationDays: 7,
    tags: ["baltic", "metropolen"], companions: [],
    stops: [
      { portName: "Kiel" }, { portName: "Copenhagen" }, { portName: "Stockholm" },
      { isAtSea: true }, { portName: "Tallinn" }, { portName: "Gdańsk" },
      { portName: "Kiel" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAperla", region: "Kanaren",
    cabinType: "Balkon", deck: 7, priceEur: 1890, durationDays: 14,
    tags: ["winter", "sonne"], companions: ["Sarah Müller"],
    stops: [
      { portName: "Las Palmas" }, { isAtSea: true }, { portName: "Funchal" },
      { isAtSea: true }, { portName: "Lisbon" }, { portName: "Málaga" },
      { isAtSea: true }, { portName: "Las Palmas" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAmar", region: "Mittelmeer Ost",
    cabinType: "Innenkabine", deck: 5, priceEur: 990, durationDays: 7,
    tags: ["griechenland"], companions: [],
    stops: [
      { portName: "Athens (Piraeus)" }, { portName: "Mykonos" },
      { portName: "Kuşadası", excursionNote: "Ephesos" },
      { portName: "Istanbul" }, { isAtSea: true },
      { portName: "Santorini" }, { portName: "Athens (Piraeus)" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAbella", region: "Adria",
    cabinType: "Außenkabine", deck: 6, priceEur: 1190, durationDays: 7,
    tags: ["adria"], companions: [],
    stops: [
      { portName: "Venice" }, { portName: "Dubrovnik" }, { portName: "Naples" },
      { isAtSea: true }, { portName: "Civitavecchia" }, { portName: "Genoa" },
      { portName: "Venice" },
    ],
  },
  {
    line: "TUI Cruises", shipName: "Mein Schiff 1", region: "Karibik",
    cabinType: "Balkonkabine", deck: 8, priceEur: 2990, durationDays: 14,
    tags: ["karibik", "sonne", "winter"], companions: ["Anna Fischer"],
    stops: [
      { portName: "Miami" }, { portName: "Nassau" }, { portName: "San Juan" },
      { portName: "St. Thomas" }, { portName: "Bridgetown" }, { isAtSea: true },
      { portName: "Cozumel" }, { isAtSea: true }, { portName: "Miami" },
    ],
  },
  {
    line: "TUI Cruises", shipName: "Mein Schiff 2", region: "Transatlantik",
    cabinType: "Himmel & Meer Suite", deck: 12, priceEur: 3590, durationDays: 14,
    tags: ["transatlantik", "langstrecke"], companions: ["Sarah Müller"],
    stops: [
      { portName: "Hamburg" }, { isAtSea: true }, { isAtSea: true },
      { portName: "Funchal" }, { isAtSea: true }, { isAtSea: true },
      { portName: "Nassau" }, { portName: "Miami" },
    ],
  },
  {
    line: "TUI Cruises", shipName: "Mein Schiff 3", region: "Mittelmeer West",
    cabinType: "Außenkabine", deck: 5, priceEur: 1690, durationDays: 7,
    tags: ["mittelmeer"], companions: [],
    stops: [
      { portName: "Palma de Mallorca" }, { portName: "Valencia" },
      { portName: "Marseille" }, { portName: "Genoa" }, { portName: "Nice" },
      { isAtSea: true }, { portName: "Palma de Mallorca" },
    ],
  },
  {
    line: "TUI Cruises", shipName: "Mein Schiff 5", region: "Norwegen",
    cabinType: "Balkonkabine", deck: 9, priceEur: 2290, durationDays: 8,
    tags: ["fjorde"], companions: ["Jonas Weber"],
    stops: [
      { portName: "Kiel" }, { isAtSea: true }, { portName: "Bergen" },
      { portName: "Geiranger" }, { portName: "Ålesund" }, { portName: "Oslo" },
      { isAtSea: true }, { portName: "Kiel" },
    ],
  },
  {
    line: "TUI Cruises", shipName: "Mein Schiff 7", region: "Ostsee Premium",
    cabinType: "Suite", deck: 10, priceEur: 3290, durationDays: 7,
    tags: ["baltic", "premium"], companions: ["Clara Becker"],
    stops: [
      { portName: "Kiel" }, { portName: "Copenhagen" }, { portName: "Stockholm" },
      { portName: "Helsinki" }, { portName: "Tallinn" },
      { isAtSea: true }, { portName: "Kiel" },
    ],
  },
  {
    line: "MSC Cruises", shipName: "MSC World Europa", region: "Mittelmeer",
    cabinType: "Aurea", deck: 12, priceEur: 1990, durationDays: 7,
    tags: ["mittelmeer", "familie"], companions: [],
    stops: [
      { portName: "Genoa" }, { portName: "Civitavecchia" }, { portName: "Palermo" },
      { portName: "Valletta" }, { portName: "Barcelona" },
      { portName: "Marseille" }, { portName: "Genoa" },
    ].map((s) =>
      ["Palermo", "Valletta"].includes(s.portName ?? "") ? { isAtSea: true } : s
    ),
  },
  {
    line: "MSC Cruises", shipName: "MSC Grandiosa", region: "Nordeuropa",
    cabinType: "Balkonkabine", deck: 10, priceEur: 1590, durationDays: 7,
    tags: ["nordsee"], companions: [],
    stops: [
      { portName: "Hamburg" }, { portName: "Southampton" },
      { portName: "Amsterdam" }, { isAtSea: true }, { portName: "Rotterdam" },
      { portName: "Bremerhaven" }, { portName: "Hamburg" },
    ],
  },
  {
    line: "MSC Cruises", shipName: "MSC Virtuosa", region: "Emirate",
    cabinType: "Yacht Club Suite", deck: 15, priceEur: 2890, durationDays: 7,
    tags: ["emirate", "luxus"], companions: ["Sarah Müller"],
    stops: [
      { portName: "Dubai" }, { portName: "Abu Dhabi" }, { portName: "Doha" },
      { isAtSea: true }, { portName: "Muscat" }, { portName: "Dubai" },
    ].map((s) =>
      ["Dubai", "Abu Dhabi", "Doha", "Muscat"].includes(s.portName ?? "")
        ? { isAtSea: true } // dev DB has none of these — render as sea days
        : s
    ),
  },
  {
    line: "Costa Cruises", shipName: "Costa Toscana", region: "Mittelmeer West",
    cabinType: "Balkonkabine", deck: 9, priceEur: 1390, durationDays: 7,
    tags: ["mittelmeer"], companions: [],
    stops: [
      { portName: "Barcelona" }, { portName: "Marseille" },
      { portName: "Genoa" }, { portName: "Civitavecchia" }, { portName: "Naples" },
      { portName: "Palma de Mallorca" }, { portName: "Barcelona" },
    ],
  },
  {
    line: "Costa Cruises", shipName: "Costa Smeralda", region: "Mittelmeer",
    cabinType: "Außenkabine", deck: 6, priceEur: 1090, durationDays: 7,
    tags: ["mittelmeer"], companions: [],
    stops: [
      { portName: "Civitavecchia" }, { portName: "Naples" },
      { portName: "Palermo" }, { portName: "Barcelona" },
      { portName: "Marseille" }, { portName: "Genoa" }, { portName: "Civitavecchia" },
    ].map((s) => (s.portName === "Palermo" ? { isAtSea: true } : s)),
  },
  {
    line: "Royal Caribbean International", shipName: "Wonder of the Seas",
    region: "Karibik Ost", cabinType: "Balkon", deck: 11, priceEur: 3290,
    durationDays: 7, tags: ["karibik", "familie"], companions: ["Anna Fischer"],
    stops: [
      { portName: "Fort Lauderdale" }, { isAtSea: true }, { portName: "San Juan" },
      { portName: "St. Thomas" }, { portName: "Nassau" }, { isAtSea: true },
      { portName: "Fort Lauderdale" },
    ],
  },
  {
    line: "Royal Caribbean International", shipName: "Icon of the Seas",
    region: "Karibik West", cabinType: "Star Class Suite", deck: 14,
    priceEur: 5990, durationDays: 7, tags: ["karibik", "luxus"],
    companions: ["Sarah Müller", "Jonas Weber"],
    stops: [
      { portName: "Miami" }, { portName: "Cozumel" }, { isAtSea: true },
      { portName: "Nassau" }, { portName: "Port Canaveral" }, { isAtSea: true },
      { portName: "Miami" },
    ],
  },
  {
    line: "Carnival Cruise Line", shipName: "Carnival Celebration",
    region: "Karibik", cabinType: "Havana Cabana", deck: 8, priceEur: 1490,
    durationDays: 7, tags: ["karibik"], companions: [],
    stops: [
      { portName: "Miami" }, { portName: "Nassau" }, { isAtSea: true },
      { portName: "San Juan" }, { portName: "St. Thomas" }, { isAtSea: true },
      { portName: "Miami" },
    ],
  },
  {
    line: "Norwegian Cruise Line", shipName: "Norwegian Prima",
    region: "Alaska", cabinType: "The Haven Penthouse", deck: 17,
    priceEur: 4790, durationDays: 7, tags: ["alaska", "bucket-list"],
    companions: ["Clara Becker"],
    stops: [
      { portName: "Seward" }, { isAtSea: true }, { portName: "Juneau" },
      { portName: "Skagway" }, { portName: "Ketchikan" }, { isAtSea: true },
      { portName: "Vancouver" },
    ],
  },
  {
    line: "Hapag-Lloyd Cruises", shipName: "Europa 2", region: "Panama-Kanal",
    cabinType: "Grand Suite", deck: 10, priceEur: 8990, durationDays: 14,
    tags: ["panama", "langstrecke", "luxus"], companions: ["Sarah Müller"],
    stops: [
      { portName: "Fort Lauderdale" }, { isAtSea: true }, { portName: "Nassau" },
      { isAtSea: true }, { portName: "Panama Canal (Colón)", excursionNote: "Panamakanal-Passage" },
      { isAtSea: true }, { isAtSea: true }, { portName: "Vancouver" },
    ],
  },
  {
    line: "AIDA Cruises", shipName: "AIDAluna", region: "Kurzreise",
    cabinType: "Innenkabine", deck: 5, priceEur: 490, durationDays: 3,
    tags: ["kurztrip", "wochenende"], companions: [],
    stops: [
      { portName: "Kiel" }, { portName: "Copenhagen" }, { portName: "Kiel" },
    ],
  },
];

// ---------------------------------------------------------- main seed logic

async function wipeDemoUser(userId: string): Promise<void> {
  // Cascade-safe teardown: deleting the user would wipe all owned rows via
  // onDelete: Cascade, but we want to keep the user row stable so we just
  // delete owned data. Order matters where there are optional FKs.
  await prisma.cruiseStop.deleteMany({
    where: { cruise: { userId } },
  });
  await prisma.cruise.deleteMany({ where: { userId } });
  await prisma.flight.deleteMany({ where: { userId } });
  await prisma.booking.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.userAchievement.deleteMany({ where: { userId } });
  await prisma.analyticsEvent.deleteMany({ where: { userId } });
}

export async function ensureUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { username: DEMO_USERNAME },
  });
  if (existing) {
    await wipeDemoUser(existing.id);
    // Heal a row seeded before the flag was set here — see below. Without this
    // the repair only reaches installs that delete the demo user first.
    if (!existing.isDemo) {
      await prisma.user.update({ where: { id: existing.id }, data: { isDemo: true } });
    }
    return existing.id;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.create({
    data: {
      username: DEMO_USERNAME,
      passwordHash,
      mustChangePassword: false,
      // This seeder is the one the Docker entrypoint runs (CREATE_DEMO_USER),
      // and it did NOT set the flag, while the other demo seeder
      // (seedDemoUser) always has. Measured on a production install: the demo
      // account existed with is_demo = false, so its 160 sample flights and 22
      // sample cruises counted as real data in the instance-wide statistics,
      // and the demo guards in routes/flights.ts did not apply to it either.
      isDemo: true,
    },
  });
  return user.id;
}

async function ensureUserSettings(userId: string): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    update: {
      enabledDomains: ["flight", "cruise"],
      data: {
        unitsSystem: "metric",
        defaultCategory: "vacation",
        welcomeSeen: true,
      } as Prisma.InputJsonValue,
      historicalEnrichmentEnabled: true,
    },
    create: {
      userId,
      enabledDomains: ["flight", "cruise"],
      data: {
        unitsSystem: "metric",
        defaultCategory: "vacation",
        welcomeSeen: true,
      } as Prisma.InputJsonValue,
      historicalEnrichmentEnabled: true,
    },
  });
}

export async function loadPools(): Promise<{
  airports: Map<string, AirportRow>;
  ships: Map<string, ShipRow>;
  ports: Map<string, PortRow>;
}> {
  const airportRows = await prisma.airport.findMany({
    where: { iata: { in: AIRPORT_IATAS }, isClosed: false },
    select: {
      id: true, iata: true, icao: true, name: true,
      city: true, country: true, lat: true, lon: true,
    },
  });
  const airports = new Map<string, AirportRow>();
  for (const a of airportRows) if (a.iata) airports.set(a.iata, a);

  const shipRows = await prisma.ship.findMany({
    select: { id: true, name: true, cruiseLine: true },
  });
  const ships = new Map<string, ShipRow>();
  for (const s of shipRows) ships.set(s.name, s);

  const portRows = await prisma.port.findMany({
    select: { id: true, name: true, city: true, country: true, unlocode: true },
  });
  const ports = new Map<string, PortRow>();
  for (const p of portRows) ports.set(p.name, p);

  return { airports, ships, ports };
}

// `companions` is narrowed back to `string[]` (Prisma's CreateManyInput
// widens scalar-list fields to `FlightCreatecompanionsInput | string[]`) so
// callers can read it directly when resolving companion links after the
// bulk insert. `id` is client-generated up front (see buildFlightRow) so
// links can be created without a round trip to re-fetch the inserted rows.
type FlightSeed = Omit<Prisma.FlightCreateManyInput, "userId" | "id" | "companions"> & {
  id: string;
  companions: string[];
};

function buildFlightRow(
  dep: AirportRow,
  arr: AirportRow,
  status: "flown" | "scheduled" | "cancelled" | "historical" | "duplicated",
  when: Date,
): FlightSeed {
  const airline = pick(AIRLINES);
  const operatingAirline = chance(0.12)
    ? pick(AIRLINES.filter((a) => a.name !== airline.name)).name
    : null;
  const distance = greatCircleKm(dep, arr);
  const hours = Math.max(0.5, distance / 850);

  const cls = weightedPick(SEAT_CLASSES);
  const category = weightedPick(CATEGORIES);
  const depTime = when;
  const arrTime = status === "historical" ? null : addHours(depTime, hours);
  const depOut = status === "historical" ? null : depTime;

  const companions = chance(0.3) ? pickN(COMPANION_POOL, 1 + r(2)) : [];
  const coPassengers = chance(0.15) ? pickN(CO_PASSENGER_POOL, 1 + r(2)) : [];
  const tags = chance(0.4) ? pickN(TAG_POOL, 1 + r(3)) : [];

  const hasPrice = chance(0.7);
  const hasDelay = status === "flown" && chance(0.25);
  const hasActualTimes = status === "flown" && chance(0.5);
  const delayMinutes = hasDelay ? 10 + r(90) : null;

  const flightNum = String(100 + r(8900));

  return {
    id: randomUUID(),
    airline: airline.name,
    operatingAirline,
    flightNumber: airline.prefix + flightNum,
    aircraft: pick(airline.aircraft),
    depIcao: dep.icao, depIata: dep.iata, depName: dep.name,
    depLat: dep.lat, depLon: dep.lon,
    arrIcao: arr.icao, arrIata: arr.iata, arrName: arr.name,
    arrLat: arr.lat, arrLon: arr.lon,
    departureTime: depOut,
    arrivalTime: arrTime,
    status,
    notes: chance(0.15) ? "Guter Flug, pünktliche Landung." : null,
    seatNumber: status === "cancelled" ? null : seatNumber(cls),
    seatClass: cls,
    boardingGroup: chance(0.4) ? `Group ${1 + r(5)}` : null,
    gate: chance(0.6) ? `${"ABCDE"[r(5)]}${1 + r(30)}` : null,
    terminal: chance(0.6) ? String(1 + r(3)) : null,
    bookingReference: chance(0.6) ? pnr() : null,
    ticketNumber: chance(0.3) ? `${airline.prefix}${100000 + r(899999)}` : null,
    price: hasPrice ? Math.round(80 + Math.random() * (cls === "first" ? 5000 : cls === "business" ? 2500 : 600)) : null,
    currency: hasPrice ? "EUR" : null,
    taxes: hasPrice && chance(0.6) ? Math.round(20 + Math.random() * 120) : null,
    fees: hasPrice && chance(0.4) ? Math.round(5 + Math.random() * 60) : null,
    category,
    tags,
    companions,
    coPassengers,
    ticketPrice: hasPrice ? Math.round(80 + Math.random() * (cls === "first" ? 5000 : cls === "business" ? 2500 : 600)) : null,
    co2Kg: calculateCo2Kg({
      depLat: dep.lat,
      depLon: dep.lon,
      arrLat: arr.lat,
      arrLon: arr.lon,
      seatClass: toSeatClass(cls),
    }),
    actualDeparture: hasActualTimes && depOut ? addHours(depOut, (delayMinutes ?? 0) / 60) : null,
    actualArrival: hasActualTimes && arrTime ? addHours(arrTime, (delayMinutes ?? 0) / 60) : null,
    delayMinutes,
    baggageAllowance: chance(0.35) ? `${1 + r(2)} x 23kg` : null,
    frequentFlyerNumber: chance(0.2) ? `${airline.prefix}${10000000 + r(89999999)}` : null,
    bookingClassLetter: chance(0.5) ? pick(["Y", "M", "B", "H", "C", "J", "F"]) : null,
    parserTemplate: chance(0.5) ? airline.prefix : null,
    parserConfidence: chance(0.5) ? 60 + r(40) : null,
    dataSource: pick(["manual", "email_import", "boarding_pass_scan", "historical_enrichment"]),
    lastModifiedBy: "user",
    hasLiveTracking: status === "flown" && chance(0.2),
  };
}

async function seedFlights(userId: string, airports: Map<string, AirportRow>): Promise<void> {
  const pool = Array.from(airports.values());
  const rows: FlightSeed[] = [];

  const now = new Date("2026-04-23T00:00:00Z");
  const past = new Date("2015-01-01T00:00:00Z");
  const future = new Date("2027-12-31T00:00:00Z");

  // Realistic route-frequency distribution: routes the user flies often
  // (home-hub pairs, commutes) need to outnumber one-off trips, otherwise
  // buildRouteData's heatmap quantiles collapse to a single bucket and
  // the Flüge-tab shows uniform color. Hand-picked based on the airport
  // pool so every route resolves.
  const byIata = (code: string): AirportRow => {
    const a = airports.get(code);
    if (!a) throw new Error(`seed: airport ${code} missing from pool`);
    return a;
  };
  type Weighted = { dep: AirportRow; arr: AirportRow; n: number };
  const frequentRoutes: Weighted[] = [
    { dep: byIata("MUC"), arr: byIata("FRA"), n: 12 }, // Inlands-Zubringer
    { dep: byIata("FRA"), arr: byIata("MUC"), n: 10 },
    { dep: byIata("MUC"), arr: byIata("LHR"), n: 6 },
    { dep: byIata("LHR"), arr: byIata("MUC"), n: 5 },
    { dep: byIata("FRA"), arr: byIata("JFK"), n: 5 },
  ];
  const moderateRoutes: Weighted[] = [
    { dep: byIata("MUC"), arr: byIata("BCN"), n: 3 },
    { dep: byIata("BCN"), arr: byIata("MUC"), n: 3 },
    { dep: byIata("FRA"), arr: byIata("DXB"), n: 3 },
    { dep: byIata("DXB"), arr: byIata("FRA"), n: 3 },
    { dep: byIata("MUC"), arr: byIata("PMI"), n: 3 },
    { dep: byIata("MUC"), arr: byIata("ZRH"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("VIE"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("CDG"), n: 2 },
    { dep: byIata("CDG"), arr: byIata("MUC"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("AMS"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("FCO"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("MAD"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("LIS"), n: 2 },
    { dep: byIata("LIS"), arr: byIata("MUC"), n: 2 },
    { dep: byIata("MUC"), arr: byIata("IST"), n: 2 },
  ];

  let placed = 0;
  for (const { dep, arr, n } of [...frequentRoutes, ...moderateRoutes]) {
    for (let i = 0; i < n; i++) {
      rows.push(buildFlightRow(dep, arr, "flown", randDateBetween(past, now)));
      placed++;
    }
  }
  // Remainder: random singletons → fills the long tail of the histogram.
  const remaining = 110 - placed;
  for (let i = 0; i < remaining; i++) {
    let dep = pick(pool);
    let arr = pick(pool);
    while (arr.iata === dep.iata) arr = pick(pool);
    rows.push(buildFlightRow(dep, arr, "flown", randDateBetween(past, now)));
  }

  // 20 scheduled (future)
  for (let i = 0; i < 20; i++) {
    let dep = pick(pool);
    let arr = pick(pool);
    while (arr.iata === dep.iata) arr = pick(pool);
    rows.push(buildFlightRow(dep, arr, "scheduled", randDateBetween(now, future)));
  }

  // 12 historical (no times — dates treated as year/month estimate)
  for (let i = 0; i < 12; i++) {
    let dep = pick(pool);
    let arr = pick(pool);
    while (arr.iata === dep.iata) arr = pick(pool);
    // departureTime deliberately kept but null — status-driven UI handles it
    rows.push(buildFlightRow(dep, arr, "historical", randDateBetween(past, now)));
  }

  // 10 cancelled
  for (let i = 0; i < 10; i++) {
    let dep = pick(pool);
    let arr = pick(pool);
    while (arr.iata === dep.iata) arr = pick(pool);
    rows.push(buildFlightRow(dep, arr, "cancelled", randDateBetween(past, now)));
  }

  // 8 duplicated (marked so the dedup UI has something to show)
  for (let i = 0; i < 8; i++) {
    let dep = pick(pool);
    let arr = pick(pool);
    while (arr.iata === dep.iata) arr = pick(pool);
    rows.push(buildFlightRow(dep, arr, "duplicated", randDateBetween(past, now)));
  }

  await prisma.flight.createMany({
    data: rows.map((r) => ({ ...r, userId })),
  });
  await linkFlightCompanions(userId, rows);
  console.log(`   → created ${rows.length} flights`);
}

// Dual write, same as the live create/update/merge routes: resolve each
// flight's raw companion names to Companion entities and write the join
// rows too. Without this a freshly seeded instance shows companion chips
// (from the legacy array) but an empty suggestion list until something else
// happens to run the backfill -- reads as a bug in the feature, not a seed
// gap. Ids are client-generated in buildFlightRow so this can run straight
// off the in-memory rows, no re-fetch needed.
async function linkFlightCompanions(userId: string, rows: FlightSeed[]): Promise<void> {
  const linkRows: Prisma.FlightCompanionCreateManyInput[] = [];
  for (const row of rows) {
    if (row.companions.length === 0) continue;
    const resolved = await resolveCompanions(userId, row.companions);
    linkRows.push(
      ...linkRowsFor(resolved.map((c) => c.id)).map((link) => ({
        flightId: row.id,
        companionId: link.companionId,
        position: link.position,
      })),
    );
  }
  if (linkRows.length > 0) {
    await prisma.flightCompanion.createMany({ data: linkRows, skipDuplicates: true });
  }
}

export async function seedCruises(
  userId: string,
  ships: Map<string, ShipRow>,
  ports: Map<string, PortRow>,
): Promise<void> {
  const now = new Date("2026-04-23T00:00:00Z");
  let created = 0;

  for (const [idx, tpl] of CRUISE_TEMPLATES.entries()) {
    const ship = ships.get(tpl.shipName);
    if (!ship) {
      console.log(`   ! skipping ${tpl.shipName} — ship not in DB`);
      continue;
    }

    // 15 completed, 3 scheduled, 2 cancelled, 2 historical
    let status: "flown" | "scheduled" | "cancelled" | "historical";
    if (idx < 15) status = "flown";
    else if (idx < 18) status = "scheduled";
    else if (idx < 20) status = "cancelled";
    else status = "historical";

    // distribute across years
    const yearOffset = Math.floor((idx / CRUISE_TEMPLATES.length) * 9);
    const yearBase = 2017 + yearOffset;
    let startBase: Date;
    if (status === "scheduled") {
      startBase = new Date(
        now.getTime() + (30 + r(200)) * 24 * 60 * 60 * 1000,
      );
    } else {
      // flown, cancelled, historical → spread across years
      startBase = new Date(
        `${yearBase}-${String(1 + r(11)).padStart(2, "0")}-${String(1 + r(27)).padStart(2, "0")}T12:00:00Z`,
      );
    }

    const startDate = startBase;
    const endDate = new Date(startBase.getTime() + tpl.durationDays * 24 * 60 * 60 * 1000);

    const firstPortStop = tpl.stops.find((s) => s.portName);
    const lastPortStop = [...tpl.stops].reverse().find((s) => s.portName);
    const departurePortId = firstPortStop?.portName
      ? ports.get(firstPortStop.portName)?.id ?? null
      : null;
    const arrivalPortId = lastPortStop?.portName
      ? ports.get(lastPortStop.portName)?.id ?? null
      : null;

    const cruise = await prisma.cruise.create({
      data: {
        userId,
        shipId: ship.id,
        cruiseLine: tpl.line,
        departurePortId,
        arrivalPortId,
        startDate,
        endDate,
        status,
        cabinNumber: `${8000 + r(999)}`,
        cabinType: tpl.cabinType,
        deck: tpl.deck,
        bookingReference: pnr(),
        price: tpl.priceEur,
        currency: "EUR",
        notes: chance(0.5) ? `Region: ${tpl.region}. ${tpl.durationDays} Tage.` : null,
        tags: tpl.tags,
        companions: tpl.companions,
        dataSource: "manual",
        parserTemplate: null,
        parserConfidence: null,
      },
    });

    // Dual write, same as the live create/update routes: resolve the
    // template's raw companion names to Companion entities and write the
    // join rows too, otherwise a freshly seeded instance shows companion
    // chips but an empty suggestion list.
    if (tpl.companions.length > 0) {
      const resolved = await resolveCompanions(userId, tpl.companions);
      await prisma.cruiseCompanion.createMany({
        data: linkRowsFor(resolved.map((c) => c.id)).map((link) => ({
          cruiseId: cruise.id,
          companionId: link.companionId,
          position: link.position,
        })),
        skipDuplicates: true,
      });
    }

    // Create stops. Renumber consecutively; sea days are `isAtSea=true,
    // portId=null` — matches the Zod union.
    for (let i = 0; i < tpl.stops.length; i++) {
      const stop = tpl.stops[i];
      const dayStart = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 10 * 60 * 60 * 1000);
      if (stop.isAtSea) {
        await prisma.cruiseStop.create({
          data: {
            cruiseId: cruise.id,
            portId: null,
            dayNumber: i + 1,
            isAtSea: true,
            arrivalTime: null,
            departureTime: null,
            excursionNote: null,
          },
        });
      } else if (stop.portName) {
        const port = ports.get(stop.portName);
        if (!port) {
          // fall back to a sea day so dayNumbers stay consecutive
          await prisma.cruiseStop.create({
            data: {
              cruiseId: cruise.id,
              portId: null,
              dayNumber: i + 1,
              isAtSea: true,
              arrivalTime: null,
              departureTime: null,
              excursionNote: `(geplant: ${stop.portName} — Hafen nicht im Seed)`,
            },
          });
          continue;
        }
        await prisma.cruiseStop.create({
          data: {
            cruiseId: cruise.id,
            portId: port.id,
            dayNumber: i + 1,
            isAtSea: false,
            arrivalTime: dayStart,
            departureTime: dayEnd,
            excursionNote: stop.excursionNote ?? null,
          },
        });
      }
    }

    created++;
  }
  console.log(`   → created ${created} cruises with stops`);
}

async function seedTripsAndBookings(userId: string): Promise<void> {
  // Group a handful of related past flights + a cruise under a single trip
  // so the dashboard "Trip" view has something to render.
  const flownFlights = await prisma.flight.findMany({
    where: { userId, status: "flown" },
    orderBy: { departureTime: "asc" },
    select: { id: true, departureTime: true, depIata: true, arrIata: true },
  });
  const completedCruises = await prisma.cruise.findMany({
    where: { userId, status: "flown" },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true },
  });

  const tripDefs = [
    { name: "USA Roadtrip", color: "#38bdf8", tagCount: 6 },
    { name: "Japan 2022", color: "#f472b6", tagCount: 4 },
    { name: "Südostasien Rundreise", color: "#fb923c", tagCount: 8 },
    { name: "Skandinavien im Sommer", color: "#818cf8", tagCount: 5 },
    { name: "Wochenende Barcelona", color: "#34d399", tagCount: 2 },
    { name: "Mittelmeer-Kreuzfahrt", color: "#fbbf24", tagCount: 0 },
    { name: "Karibik-Auszeit", color: "#fb7185", tagCount: 0 },
    { name: "Alaska Expedition", color: "#60a5fa", tagCount: 0 },
  ];

  let offset = 0;
  let cruiseIdx = 0;
  for (const def of tripDefs) {
    const trip = await prisma.trip.create({
      data: { userId, name: def.name, color: def.color },
    });

    if (def.tagCount > 0 && offset + def.tagCount <= flownFlights.length) {
      const ids = flownFlights.slice(offset, offset + def.tagCount).map((f) => f.id);
      const withBooking = chance(0.7);
      let bookingId: string | null = null;
      if (withBooking) {
        const booking = await prisma.booking.create({
          data: {
            userId,
            tripId: trip.id,
            pnr: pnr(),
            price: Math.round(500 + Math.random() * 2500),
            currency: "EUR",
          },
        });
        bookingId = booking.id;
      }
      await prisma.flight.updateMany({
        where: { id: { in: ids } },
        data: {
          tripId: trip.id,
          ...(bookingId ? { bookingId } : {}),
        },
      });
      offset += def.tagCount;
    } else if (cruiseIdx < completedCruises.length) {
      const cruise = completedCruises[cruiseIdx++];
      await prisma.cruise.update({
        where: { id: cruise.id },
        data: { tripId: trip.id },
      });
    }
  }
  console.log(`   → created ${tripDefs.length} trips`);
}

async function main(): Promise<void> {
  console.log("🌱 Seeding demo account (demo / demo123) ...");
  const userId = await ensureUser();
  console.log(`   user id = ${userId}`);

  await ensureUserSettings(userId);
  console.log("   ✓ user settings — flight + cruise domains enabled");

  const { airports, ships, ports } = await loadPools();
  console.log(`   pools: ${airports.size} airports, ${ships.size} ships, ${ports.size} ports`);

  if (airports.size < 60) {
    throw new Error(
      `Expected 60+ airports in pool, got ${airports.size}. Run seedAirportsFromCSV first.`,
    );
  }

  await seedFlights(userId, airports);
  await seedCruises(userId, ships, ports);
  await seedTripsAndBookings(userId);

  console.log("   recomputing achievements ...");
  try {
    await checkAndUpdateAchievements(userId);
  } catch (err) {
    // Achievement recompute is nice-to-have — not worth failing the seed.
    console.warn("   ! achievement recompute failed:", err);
  }

  // Final counts
  const [fc, cc, tc, bc, ac] = await Promise.all([
    prisma.flight.count({ where: { userId } }),
    prisma.cruise.count({ where: { userId } }),
    prisma.trip.count({ where: { userId } }),
    prisma.booking.count({ where: { userId } }),
    prisma.userAchievement.count({ where: { userId } }),
  ]);

  console.log("");
  console.log("✅ Demo seed complete");
  console.log(`   Username: ${DEMO_USERNAME}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`   Flights:      ${fc}`);
  console.log(`   Cruises:      ${cc}`);
  console.log(`   Trips:        ${tc}`);
  console.log(`   Bookings:     ${bc}`);
  console.log(`   Achievements: ${ac}`);
}

// Only auto-run the full demo seed when executed directly (npm run seed:demo).
// Guarded so other seeders (e.g. seedDevAdmin) can import loadPools/seedCruises
// without triggering a complete demo-account seed + premature $disconnect.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error("❌ Seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
