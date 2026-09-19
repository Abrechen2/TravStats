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
 *   - Bulk trips + bookings linking flights + cruises
 *   - A handful of narrated trips (seedStories) — coherent flights, lodging
 *     stays, places, a tour route and a journal per trip
 *   - Bulk lodging stays + places outside the narrated trips, plus place lists
 *     (seedBulk)
 *   - Flight, cruise, lodging and places domains enabled on user settings
 *   - Achievements recomputed at the end
 */

import { randomUUID } from "crypto";
import { Prisma } from "./prisma";
import { prisma } from "./db";
import { hashPassword, comparePassword } from "./utils/password";
import { DEMO_USERNAME } from "./utils/sharedDemo";
import { appVersion } from "./utils/version";
import { checkAndUpdateAchievements } from "./utils/achievements";
import { calculateCo2Kg, toSeatClass } from "./services/co2Calculator";
import { linkRowsFor, resolveCompanions } from "./services/companionService";
import { seedStories } from "./seedDemo/seedStories";
import { stopTimesForDay } from "./seedDemo/cruiseTiming";
import { seedBulk } from "./seedDemo/seedBulk";

export type AirportRow = {
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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
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
  "MUC",
  "FRA",
  "BER",
  "HAM",
  "DUS",
  "STR",
  "NUE",
  "LHR",
  "CDG",
  "ORY",
  "AMS",
  "MAD",
  "BCN",
  "PMI",
  "AGP",
  "LPA",
  "TFS",
  "FCO",
  "MXP",
  "LIN",
  "NAP",
  "CTA",
  "PSA",
  "VIE",
  "ZRH",
  "GVA",
  "PRG",
  "WAW",
  "BUD",
  "ATH",
  "IST",
  "DUB",
  "CPH",
  "ARN",
  "OSL",
  "LIS",
  "OPO",
  "JFK",
  "LAX",
  "ORD",
  "SFO",
  "MIA",
  "YYZ",
  "YVR",
  "MEX",
  "HND",
  "NRT",
  "KIX",
  "ICN",
  "HKG",
  "SIN",
  "BKK",
  "KUL",
  "MNL",
  "CGK",
  "DEL",
  "BOM",
  "PEK",
  "PVG",
  "TPE",
  "DXB",
  "DOH",
  "AUH",
  "MCT",
  "RUH",
  "JED",
  "TLV",
  "BEY",
  "SYD",
  "MEL",
  "AKL",
  "GRU",
  "EZE",
  "SCL",
  "CPT",
  "JNB",
  "CAI",
  "RAK",
  "NBO",
  "KEF",
  "FLR",
  "BGO",
  "TOS",
];

const AIRLINES = [
  {
    name: "Lufthansa",
    prefix: "LH",
    aircraft: ["A320neo", "A321neo", "A350-900", "B747-8", "A380"],
    hub: "FRA",
  },
  {
    name: "British Airways",
    prefix: "BA",
    aircraft: ["A320", "A321neo", "B787-9", "A380"],
    hub: "LHR",
  },
  {
    name: "Air France",
    prefix: "AF",
    aircraft: ["A220-300", "A320neo", "B777-300ER", "A350-900"],
    hub: "CDG",
  },
  { name: "KLM", prefix: "KL", aircraft: ["E195-E2", "B737-800", "B787-9"], hub: "AMS" },
  {
    name: "Swiss",
    prefix: "LX",
    aircraft: ["A220-300", "A320neo", "A330-300", "B777-300ER"],
    hub: "ZRH",
  },
  {
    name: "Austrian Airlines",
    prefix: "OS",
    aircraft: ["A320", "B767-300ER", "B777-200ER"],
    hub: "VIE",
  },
  { name: "Iberia", prefix: "IB", aircraft: ["A320neo", "A350-900"], hub: "MAD" },
  { name: "Finnair", prefix: "AY", aircraft: ["A320", "A350-900"], hub: "HEL" },
  { name: "SAS", prefix: "SK", aircraft: ["A320neo", "A321LR", "A330-300"], hub: "CPH" },
  { name: "Emirates", prefix: "EK", aircraft: ["A380", "B777-300ER"], hub: "DXB" },
  {
    name: "Qatar Airways",
    prefix: "QR",
    aircraft: ["A350-1000", "B777-300ER", "A380"],
    hub: "DOH",
  },
  {
    name: "Singapore Airlines",
    prefix: "SQ",
    aircraft: ["A380", "A350-900", "B787-10"],
    hub: "SIN",
  },
  {
    name: "Turkish Airlines",
    prefix: "TK",
    aircraft: ["A321neo", "B787-9", "A350-900"],
    hub: "IST",
  },
  { name: "ANA", prefix: "NH", aircraft: ["B787-9", "B777-300ER", "A380"], hub: "HND" },
  {
    name: "American Airlines",
    prefix: "AA",
    aircraft: ["B737 MAX 8", "B787-9", "A321neo"],
    hub: "JFK",
  },
  {
    name: "United Airlines",
    prefix: "UA",
    aircraft: ["B737-900ER", "B787-9", "B777-300ER"],
    hub: "SFO",
  },
  {
    name: "Delta Air Lines",
    prefix: "DL",
    aircraft: ["B767-400ER", "A330-900", "A350-900"],
    hub: "JFK",
  },
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
  "honeymoon",
  "family",
  "solo",
  "weekend",
  "long-haul",
  "award-ticket",
  "status-run",
  "work",
  "conference",
  "redeye",
  "summer",
  "winter",
  "first-time",
  "connection",
  "bucket-list",
];

const COMPANION_POOL = [
  "Sarah Müller",
  "Jonas Weber",
  "Anna Fischer",
  "Max Hoffmann",
  "Clara Becker",
  "Mia Schmidt",
  "Leon Wagner",
  "Emma Schulz",
];

const CO_PASSENGER_POOL = [
  "MUELLER/SARAH MS",
  "WEBER/JONAS MR",
  "FISCHER/ANNA MRS",
  "HOFFMANN/MAX MR",
  "BECKER/CLARA MS",
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

/**
 * One itinerary entry, in exactly the three states a stop may be in (see the
 * cruise-stop invariant in CLAUDE.md).
 *
 * A port call names its port by UN/LOCODE, never by name. The catalogue holds
 * two "Naples" (IT and US), two "Venice", two "Nassau", two "Las Palmas" and
 * more, and the old name-keyed lookup returned whichever row Postgres happened
 * to hand back LAST — which is physical row order, not a decision. Measured on
 * the test database while finding B1 of the independent review of 2026-09-17
 * was open: "Naples" resolved to Italy and "Las Palmas" to ARGENTINA, so the
 * Canaries cruise sailed to the Río de la Plata, and a VACUUM could have
 * swapped the other four the same way.
 *
 * `unresolvedPortName` is the deliberate third state: a place the port
 * catalogue has no row for stays a PORT CALL carrying its name, which is what
 * an import does with a port it cannot match. It used to be written as a sea
 * day with the name in an excursion note (finding B2) — a state the Zod schema
 * rejects and the statistics count as a day at sea.
 */
type CruiseStopTemplate =
  | { locode: string; excursionNote?: string }
  | { atSea: true }
  | { unresolvedPortName: string; excursionNote?: string };

type CruiseTemplate = {
  line: string;
  shipName: string;
  region: string;
  cabinType: string | null;
  deck: number | null;
  priceEur: number | null;
  tags: string[];
  durationDays: number;
  stops: CruiseStopTemplate[];
  companions: string[];
};

/** Exported so a test can assert each stop resolved to the locode it names. */
export const CRUISE_TEMPLATES: readonly CruiseTemplate[] = [
  {
    line: "AIDA Cruises",
    shipName: "AIDAnova",
    region: "Mittelmeer",
    cabinType: "Balkon",
    deck: 9,
    priceEur: 2490,
    durationDays: 7,
    tags: ["mittelmeer", "familie"],
    companions: ["Sarah Müller"],
    stops: [
      { locode: "ESBCN", excursionNote: "Sagrada Família Tour" },
      { locode: "ESPMI", excursionNote: "Kathedrale La Seu" },
      { atSea: true },
      { locode: "ITCVV", excursionNote: "Ausflug Rom" },
      { locode: "ITNAP", excursionNote: "Pompeji + Vesuv" },
      { locode: "FRMRS" },
      { locode: "ESBCN" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAcosma",
    region: "Nordland",
    cabinType: "Juniorsuite",
    deck: 11,
    priceEur: 3390,
    durationDays: 10,
    tags: ["norwegian-fjords", "bucket-list"],
    companions: ["Sarah Müller", "Jonas Weber"],
    stops: [
      { locode: "DEHAM" },
      { atSea: true },
      { locode: "NOBGO" },
      { locode: "NOFLM", excursionNote: "Flåmsbana Bahn" },
      { locode: "NOGEI", excursionNote: "Dalsnibba Aussichtsplattform" },
      { locode: "NOAES" },
      { atSea: true },
      { locode: "NOOSL" },
      { locode: "DKCPH" },
      { locode: "DEHAM" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAprima",
    region: "Ostsee",
    cabinType: "Außenkabine",
    deck: 6,
    priceEur: 1290,
    durationDays: 7,
    tags: ["baltic", "metropolen"],
    companions: [],
    stops: [
      { locode: "DEKEL" },
      { locode: "DKCPH" },
      { locode: "SESTO" },
      { atSea: true },
      { locode: "EETLL" },
      { locode: "PLGDN" },
      { locode: "DEKEL" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAperla",
    region: "Kanaren",
    cabinType: "Balkon",
    deck: 7,
    priceEur: 1890,
    durationDays: 14,
    tags: ["winter", "sonne"],
    companions: ["Sarah Müller"],
    stops: [
      { locode: "ESLPA" },
      { atSea: true },
      { locode: "PTFNC" },
      { atSea: true },
      { locode: "PTLIS" },
      { locode: "ESAGP" },
      { atSea: true },
      { locode: "ESLPA" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAmar",
    region: "Mittelmeer Ost",
    cabinType: "Innenkabine",
    deck: 5,
    priceEur: 990,
    durationDays: 7,
    tags: ["griechenland"],
    companions: [],
    stops: [
      { locode: "GRPIR" },
      { locode: "GRJMK" },
      { locode: "TRKUS", excursionNote: "Ephesos" },
      { locode: "TRIST" },
      { atSea: true },
      { locode: "GRJTR" },
      { locode: "GRPIR" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAbella",
    region: "Adria",
    cabinType: "Außenkabine",
    deck: 6,
    priceEur: 1190,
    durationDays: 7,
    tags: ["adria"],
    companions: [],
    stops: [
      { locode: "ITVCE" },
      { locode: "HRDBV" },
      { locode: "ITNAP" },
      { atSea: true },
      { locode: "ITCVV" },
      { locode: "ITGOA" },
      { locode: "ITVCE" },
    ],
  },
  {
    line: "TUI Cruises",
    shipName: "Mein Schiff 1",
    region: "Karibik",
    cabinType: "Balkonkabine",
    deck: 8,
    priceEur: 2990,
    durationDays: 14,
    tags: ["karibik", "sonne", "winter"],
    companions: ["Anna Fischer"],
    stops: [
      { locode: "USMIA" },
      { locode: "BSNAS" },
      { locode: "PRSJU" },
      { locode: "VISTT" },
      { locode: "BBBGI" },
      { atSea: true },
      { locode: "MXCZM" },
      { atSea: true },
      { locode: "USMIA" },
    ],
  },
  {
    line: "TUI Cruises",
    shipName: "Mein Schiff 2",
    region: "Transatlantik",
    cabinType: "Himmel & Meer Suite",
    deck: 12,
    priceEur: 3590,
    durationDays: 14,
    tags: ["transatlantik", "langstrecke"],
    companions: ["Sarah Müller"],
    stops: [
      { locode: "DEHAM" },
      { atSea: true },
      { atSea: true },
      { locode: "PTFNC" },
      { atSea: true },
      { atSea: true },
      { locode: "BSNAS" },
      { locode: "USMIA" },
    ],
  },
  {
    line: "TUI Cruises",
    shipName: "Mein Schiff 3",
    region: "Mittelmeer West",
    cabinType: "Außenkabine",
    deck: 5,
    priceEur: 1690,
    durationDays: 7,
    tags: ["mittelmeer"],
    companions: [],
    stops: [
      { locode: "ESPMI" },
      { locode: "ESVLC" },
      { locode: "FRMRS" },
      { locode: "ITGOA" },
      { locode: "FRNCE" },
      { atSea: true },
      { locode: "ESPMI" },
    ],
  },
  {
    line: "TUI Cruises",
    shipName: "Mein Schiff 5",
    region: "Norwegen",
    cabinType: "Balkonkabine",
    deck: 9,
    priceEur: 2290,
    durationDays: 8,
    tags: ["fjorde"],
    companions: ["Jonas Weber"],
    stops: [
      { locode: "DEKEL" },
      { atSea: true },
      { locode: "NOBGO" },
      { locode: "NOGEI" },
      { locode: "NOAES" },
      { locode: "NOOSL" },
      { atSea: true },
      { locode: "DEKEL" },
    ],
  },
  {
    line: "TUI Cruises",
    shipName: "Mein Schiff 7",
    region: "Ostsee Premium",
    cabinType: "Suite",
    deck: 10,
    priceEur: 3290,
    durationDays: 7,
    tags: ["baltic", "premium"],
    companions: ["Clara Becker"],
    stops: [
      { locode: "DEKEL" },
      { locode: "DKCPH" },
      { locode: "SESTO" },
      { locode: "FIHEL" },
      { locode: "EETLL" },
      { atSea: true },
      { locode: "DEKEL" },
    ],
  },
  {
    // Palermo and Valletta are port calls again. A `.map()` over this list
    // rewrote them to sea days on the belief that the catalogue held neither —
    // it holds ITPMO and MTMLA, which is what a locode shows and a name never
    // did.
    line: "MSC Cruises",
    shipName: "MSC World Europa",
    region: "Mittelmeer",
    cabinType: "Aurea",
    deck: 12,
    priceEur: 1990,
    durationDays: 7,
    tags: ["mittelmeer", "familie"],
    companions: [],
    stops: [
      { locode: "ITGOA" },
      { locode: "ITCVV" },
      { locode: "ITPMO" },
      { locode: "MTMLA" },
      { locode: "ESBCN" },
      { locode: "FRMRS" },
      { locode: "ITGOA" },
    ],
  },
  {
    line: "MSC Cruises",
    shipName: "MSC Grandiosa",
    region: "Nordeuropa",
    cabinType: "Balkonkabine",
    deck: 10,
    priceEur: 1590,
    durationDays: 7,
    tags: ["nordsee"],
    companions: [],
    stops: [
      { locode: "DEHAM" },
      { locode: "GBSOU" },
      { locode: "NLAMS" },
      { atSea: true },
      { locode: "NLRTM" },
      { locode: "DEBRV" },
      { locode: "DEHAM" },
    ],
  },
  {
    // Same correction as MSC World Europa: all four Gulf ports are in the
    // catalogue (AEDXB, AEAUH, QADOH, OMMCT). The old comment claimed "dev DB
    // has none of these" and turned the whole itinerary into open water.
    line: "MSC Cruises",
    shipName: "MSC Virtuosa",
    region: "Emirate",
    cabinType: "Yacht Club Suite",
    deck: 15,
    priceEur: 2890,
    durationDays: 7,
    tags: ["emirate", "luxus"],
    companions: ["Sarah Müller"],
    stops: [
      { locode: "AEDXB" },
      { locode: "AEAUH" },
      { locode: "QADOH" },
      { atSea: true },
      { locode: "OMMCT" },
      { locode: "AEDXB" },
    ],
  },
  {
    line: "Costa Cruises",
    shipName: "Costa Toscana",
    region: "Mittelmeer West",
    cabinType: "Balkonkabine",
    deck: 9,
    priceEur: 1390,
    durationDays: 7,
    tags: ["mittelmeer"],
    companions: [],
    stops: [
      { locode: "ESBCN" },
      { locode: "FRMRS" },
      { locode: "ITGOA" },
      { locode: "ITCVV" },
      { locode: "ITNAP" },
      { locode: "ESPMI" },
      { locode: "ESBCN" },
    ],
  },
  {
    line: "Costa Cruises",
    shipName: "Costa Smeralda",
    region: "Mittelmeer",
    cabinType: "Außenkabine",
    deck: 6,
    priceEur: 1090,
    durationDays: 7,
    tags: ["mittelmeer"],
    companions: [],
    stops: [
      { locode: "ITCVV" },
      { locode: "ITNAP" },
      { locode: "ITPMO" },
      { locode: "ESBCN" },
      { locode: "FRMRS" },
      { locode: "ITGOA" },
      { locode: "ITCVV" },
    ],
  },
  {
    line: "Royal Caribbean International",
    shipName: "Wonder of the Seas",
    region: "Karibik Ost",
    cabinType: "Balkon",
    deck: 11,
    priceEur: 3290,
    durationDays: 7,
    tags: ["karibik", "familie"],
    companions: ["Anna Fischer"],
    stops: [
      { locode: "USFLL" },
      { atSea: true },
      { locode: "PRSJU" },
      { locode: "VISTT" },
      { locode: "BSNAS" },
      { atSea: true },
      { locode: "USFLL" },
    ],
  },
  {
    line: "Royal Caribbean International",
    shipName: "Icon of the Seas",
    region: "Karibik West",
    cabinType: "Star Class Suite",
    deck: 14,
    priceEur: 5990,
    durationDays: 7,
    tags: ["karibik", "luxus"],
    companions: ["Sarah Müller", "Jonas Weber"],
    stops: [
      { locode: "USMIA" },
      { locode: "MXCZM" },
      { atSea: true },
      { locode: "BSNAS" },
      { locode: "USPCV" },
      { atSea: true },
      { locode: "USMIA" },
    ],
  },
  {
    line: "Carnival Cruise Line",
    shipName: "Carnival Celebration",
    region: "Karibik",
    cabinType: "Havana Cabana",
    deck: 8,
    priceEur: 1490,
    durationDays: 7,
    tags: ["karibik"],
    companions: [],
    stops: [
      { locode: "USMIA" },
      { locode: "BSNAS" },
      { atSea: true },
      { locode: "PRSJU" },
      { locode: "VISTT" },
      { atSea: true },
      { locode: "USMIA" },
    ],
  },
  {
    line: "Norwegian Cruise Line",
    shipName: "Norwegian Prima",
    region: "Alaska",
    cabinType: "The Haven Penthouse",
    deck: 17,
    priceEur: 4790,
    durationDays: 7,
    tags: ["alaska", "bucket-list"],
    companions: ["Clara Becker"],
    stops: [
      { locode: "USSWD" },
      { atSea: true },
      { locode: "USJNU" },
      { locode: "USSKW" },
      { locode: "USKTN" },
      { atSea: true },
      { locode: "CAVAN" },
    ],
  },
  {
    line: "Hapag-Lloyd Cruises",
    shipName: "Europa 2",
    region: "Panama-Kanal",
    cabinType: "Grand Suite",
    deck: 10,
    priceEur: 8990,
    durationDays: 14,
    tags: ["panama", "langstrecke", "luxus"],
    companions: ["Sarah Müller"],
    stops: [
      { locode: "USFLL" },
      { atSea: true },
      { locode: "BSNAS" },
      { atSea: true },
      // The one itinerary entry the port catalogue has no row for, and kept
      // that way on purpose: it is the demo account's example of the third
      // stop state, which a user meets whenever an import names a place the
      // catalogue does not know.
      { unresolvedPortName: "Panama Canal (Colón)", excursionNote: "Panamakanal-Passage" },
      { atSea: true },
      { atSea: true },
      { locode: "CAVAN" },
    ],
  },
  {
    line: "AIDA Cruises",
    shipName: "AIDAluna",
    region: "Kurzreise",
    cabinType: "Innenkabine",
    deck: 5,
    priceEur: 490,
    durationDays: 3,
    tags: ["kurztrip", "wochenende"],
    companions: [],
    stops: [{ locode: "DEKEL" }, { locode: "DKCPH" }, { locode: "DEKEL" }],
  },
];

// ---------------------------------------------------------- main seed logic

/**
 * EVERY model in `prisma/schema.prisma` that belongs to one user, and what
 * happens to it here. Written down because the wipe missed thirteen of them
 * until the independent review of 2026-09-17 (finding A7), and because the
 * next model with a `userId` will be noticed only if this list is read — a
 * cascade you cannot see is indistinguishable from a table nobody thought of.
 *
 * Deleted by this function (31). Rows, not files — an uploaded receipt or
 * training sample leaves its bytes on disk, as `demoGuard.uploads.test.ts`
 * notes, which is why the upload routes refuse the account outright:
 *   AnalyticsEvent · Booking · Companion · CountryDay · Cruise ·
 *   CruiseStop · DataQualityFlag · DawarichSweepState · Document · Flight ·
 *   ImportBatch ·
 *   Lodging · LodgingMembership · LodgingStay · PairingCode ·
 *   ParseTrainingLog · ParserTemplate · PasswordResetRequest ·
 *   PendingFlightUpdate ·
 *   PendingUpdateStatistics · PhotoJourney · Place · PlaceList · PlaceVisit ·
 *   ReceiptUpload · TrainingData · Trip · TripJournalEntry · TripRoute ·
 *   TripStop · UserAchievement
 *
 * Deleted by CASCADE from one of those, so they need no statement of their
 * own — each reaches the user through exactly one owner:
 *   CruiseCompanion, CruiseLeg, CruiseLegRoute (Cruise) ·
 *   FlightCompanion (Flight/Companion) · ImmichImportJob (TripImmichAlbum) ·
 *   LodgingPhoto (Lodging) · LodgingMembershipChain,
 *   LodgingMembershipLodging (LodgingMembership) · PlaceListEntry
 *   (PlaceList/Place) · PlaceVisitPhoto (PlaceVisit) · TripCompanion,
 *   TripImmichAlbum, TripPhoto (Trip) · TripRouteLeg, TripRouteTrack
 *   (TripRoute)
 *
 * Deliberately NOT deleted here, each for a stated reason:
 *   ApiToken, TwoFactorRecoveryCode, WebAuthnCredential — `ensureUser`
 *     removes them BEFORE this runs, together with the credential reset, so a
 *     live session is ended before the first row is deleted (finding I4).
 *   UserSettings — rewritten rather than removed, by `ensureUserSettings`
 *     right after this; deleting it would drop the enabled domains the seeded
 *     account needs and is what the upsert exists to avoid.
 *   Invitation — reaches a user through TWO relations (creator and redeemer)
 *     and is instance-level admin data. The demo cannot create one; deleting
 *     invitations it happened to touch would destroy an admin's records.
 *
 * `Document` is the newest of them and the reason the count moved from 29 to
 * 30: it arrived from main with `routes/documents.ts` AFTER this enumeration
 * was written on 2026-09-17, so the sweep that produced the list never saw it.
 *
 * NOT user-owned at all, and never to be deleted here: Airport, Airline,
 * Aircraft, Ship, Port, LodgingChain, Achievement, CuratedList, CuratedPlace,
 * AdminSettings, SmtpConfig, Backup, AirportSeedingStatus, PoiBackfillAudit.
 * Those are the global catalogues every account reads — which is exactly why
 * the shared demo account may not write to them (finding A3).
 */
async function wipeDemoUser(userId: string): Promise<void> {
  // Cascade-safe teardown: deleting the user would wipe all owned rows via
  // onDelete: Cascade, but we want to keep the user row stable so we just
  // delete owned data. Order matters where there are optional FKs.
  //
  // New domains (Tasks 5-8: narrated trips, tours, lodging, places) go first —
  // deleted before flights/cruises/trips so a stale FK never outlives the row
  // it points at. PlaceVisit before PlaceList before Place: entries cascade
  // off the list, but a place can still be a visit target until visits are
  // gone. LodgingStay before Lodging for the same reason. TripJournalEntry and
  // TripRoute (legs/tracks cascade with it) before TripStop, because
  // TripRouteLeg cascades off either its route OR its endpoint stops — routes
  // first means the legs are already gone by the time stops are deleted, and
  // TripStop.routeId is SetNull on route delete rather than blocking it.
  // Companion last of the new set: its join rows (FlightCompanion,
  // CruiseCompanion) cascade, so it's safe regardless of flight/cruise order.
  // Before everything it hangs off. A document FILED with an entry dies by
  // cascade with that entry, but an UNFILED one has no owner but the user, so
  // it outlived the reseed by up to `UNLINKED_TTL_DAYS` (7 days) with its bytes
  // still readable through `GET /documents/:id/file`. `routes/documents.ts`
  // arrived from main after the wipe was enumerated on 2026-09-17, so `Document`
  // was never in any of the three lists above — an omission, not a decision
  // (security audit of 2026-09-19, finding 1). Rows only: the bytes under
  // `uploads/documents/` are the orphan sweep's business, which is the second
  // reason the upload route now refuses the shared account outright.
  await prisma.document.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.placeList.deleteMany({ where: { userId } }); // entries cascade
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.lodgingStay.deleteMany({ where: { userId } });
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.tripJournalEntry.deleteMany({ where: { trip: { userId } } });
  await prisma.tripRoute.deleteMany({ where: { trip: { userId } } }); // legs/tracks cascade
  await prisma.tripStop.deleteMany({ where: { trip: { userId } } });
  await prisma.companion.deleteMany({ where: { userId } }); // join rows cascade

  await prisma.cruiseStop.deleteMany({
    where: { cruise: { userId } },
  });
  await prisma.cruise.deleteMany({ where: { userId } });
  // Before the flights it hangs off, so the row goes whether or not the
  // cascade fires. See the enumeration below.
  await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
  await prisma.flight.deleteMany({ where: { userId } });
  await prisma.booking.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.userAchievement.deleteMany({ where: { userId } });
  await prisma.analyticsEvent.deleteMany({ where: { userId } });

  /**
   * The twelve tables below were ALL missed until the independent review of
   * 2026-09-17 (finding A7). The wipe covered the domains a visitor is shown
   * — flights, cruises, trips, lodging, places — and nothing else, so a public
   * instance accumulated the shared account's leavings for as long as it ran:
   * a hotel loyalty number, an import batch naming an uploaded file, a parser
   * template trained on somebody's booking mail, an uploaded receipt, a
   * location-history sweep cursor, an unspent pairing code.
   *
   * `ImportBatch` goes LAST of all: flights, cruises, lodgings, stays and
   * places point at it with `onDelete: SetNull`, so the order is not required
   * for correctness, but deleting the batch after its contents keeps the
   * reading obvious.
   */
  await prisma.countryDay.deleteMany({ where: { userId } });
  await prisma.dataQualityFlag.deleteMany({ where: { userId } });
  await prisma.dawarichSweepState.deleteMany({ where: { userId } });
  await prisma.lodgingMembership.deleteMany({ where: { userId } }); // chain/lodging links cascade
  await prisma.pairingCode.deleteMany({ where: { userId } });
  await prisma.parseTrainingLog.deleteMany({ where: { userId } });
  await prisma.parserTemplate.deleteMany({ where: { userId } });
  // An ADMIN INBOX item — "this account asked to have its password reset" —
  // carrying no token, which is why the omission cost nothing that could be
  // spent. What it did cost was an administrator's attention: the row outlived
  // every reset (data-integrity audit 2026-09-19, finding 7), so a public
  // instance left an open task about an account that no longer holds the data
  // the request was raised for, and the account is one whose password is
  // printed on the login page. The table arrived on 2026-09-19 (migration
  // `20260919140631_password_reset_requests`) and was in none of the three
  // lists above, exactly as `Document` had been two days earlier.
  await prisma.passwordResetRequest.deleteMany({ where: { userId } });
  await prisma.pendingUpdateStatistics.deleteMany({ where: { userId } });
  await prisma.photoJourney.deleteMany({ where: { userId } });
  await prisma.receiptUpload.deleteMany({ where: { userId } });
  await prisma.trainingData.deleteMany({ where: { userId } });
  await prisma.importBatch.deleteMany({ where: { userId } });
}

export async function ensureUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { username: DEMO_USERNAME },
  });
  if (existing && !existing.isDemo) {
    // An unflagged row named `demo` is one of two things, and they must not be
    // treated alike.
    //
    // It is the built-in demo account created by a pre-2.5.0 version, which
    // wrote no `isDemo` at all — or it is a real person who happened to pick
    // the name on their own instance. `utils/sharedDemo.ts` already states the
    // difference ("`demo` without the flag is a user who happened to pick the
    // name"), and nothing held the seeder to it: it reset whatever it found.
    //
    // Measured by the data-integrity audit of 2026-09-19 (finding 1) against a
    // real row with `isDemo: false`, a private password hash and a first name:
    // one boot with CREATE_DEMO_USER=true published that person's login as
    // demo/demo123, removed their passkeys, recovery codes, API tokens and
    // two-factor secret, nulled their name and birthdate, and deleted their
    // rows from thirty tables. Nothing about the run was reversible and
    // nothing about it was visible in the UI afterwards.
    //
    // The PASSWORD tells the two apart, and `scripts/backfillDemoFlag.ts`
    // already answers the same question the same way — "the account is
    // identified by its seeded password, not by its name alone". A legacy demo
    // row still carries `demo123`, so it is healed and reseeded exactly as
    // before; a real person's account carries something else, and the seeder
    // refuses rather than reseeding it. One bcrypt compare, only on a boot
    // that finds an unflagged `demo` at all.
    const isLegacyDemoRow = await comparePassword(DEMO_PASSWORD, existing.passwordHash);
    if (!isLegacyDemoRow) {
      throw new Error(
        `A user named "${DEMO_USERNAME}" exists, is not flagged as the demo account, and does ` +
          `not carry the seeded demo password — refusing to reseed. Rename that account (or ` +
          `delete it) before enabling CREATE_DEMO_USER.`
      );
    }
  }
  if (existing) {
    // Restore the account itself BEFORE its data. The route guards should
    // already refuse a credential/2FA/token change on the demo account
    // server-side — this is the second line of defence, in case one of those
    // guards is ever missed or bypassed: every re-seed puts the account back
    // to a known-good, publicly-documented login.
    //
    // The order matters and used to be the other way round. `wipeDemoUser`
    // deletes a few thousand rows across twenty tables; a visitor whose
    // session is still live goes on writing for the whole of that window and
    // leaves rows behind the delete has already passed. Bumping `sessionEpoch`
    // first ends every session issued before this instant, so the wipe runs
    // against an account nobody can reach (final review finding I4).
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isDemo: true,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        mustChangePassword: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorToken: null,
        twoFactorTokenExpiry: null,
        // Whatever a visitor typed about themselves. The name is read by the
        // header greeting on every page and the birthdate feeds an
        // achievement, so both are shown to the next visitor and both
        // survived every reseed until now (finding I1).
        firstName: null,
        lastName: null,
        birthdate: null,
        // The account-takeover chain: set the notification address, ask
        // /auth/forgot-password for a link, own the shared login (finding C3).
        // Both guards that close it are newer than some installs, so the
        // address and any outstanding token are cleared here as well.
        notificationEmail: null,
        resetToken: null,
        resetTokenExpiry: null,
        changeToken: null,
        changeTokenExpiry: null,
        // A reset of a shared public login must end sessions issued before
        // it, exactly like every other credential reset (routes/auth.ts,
        // routes/admin/users.ts, routes/passwordReset.ts) — otherwise a
        // visitor's live demo JWT survives this reset.
        sessionEpoch: { increment: 1 },
      },
    });
    await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: existing.id } });
    await prisma.webAuthnCredential.deleteMany({ where: { userId: existing.id } });
    await prisma.apiToken.deleteMany({ where: { userId: existing.id } });
    await wipeDemoUser(existing.id);
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

/**
 * Both background sweeps stay OFF — historical enrichment (final review
 * finding I5) and, since the independent review of 2026-09-17 (finding A4),
 * flight auto-update beside it.
 *
 * They are the same kind of switch: each one arms a job that spends the
 * instance's flight-API quota, and on a public instance the shared account is
 * unattended by definition — the admin who pays for the key is not the person
 * clicking around in it. The route refuses both blocks and the two workers
 * skip the account, but a row flipped before either guard existed is only
 * healed here, which is why this is an explicit `false` on BOTH branches of
 * the upsert and not a default.
 *
 * `whatsNewSeenVersion` is stamped for the same reason `stampWhatsNewSeen`
 * stamps a fresh signup: nothing is "new" to an account that starts here. The
 * nightly reseed rebuilds this one from scratch, so without the stamp every
 * visitor to a public preview meets the release highlights of a version they
 * never ran before they see a single flight — measured on beta.travstats.de
 * on 2026-09-18, where the 2.6.0 modal opened over the dashboard on first
 * login and again after every reset.
 */
export async function ensureUserSettings(userId: string): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    update: {
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      data: {
        unitsSystem: "metric",
        defaultCategory: "vacation",
        welcomeSeen: true,
        whatsNewSeenVersion: appVersion,
      } as Prisma.InputJsonValue,
      historicalEnrichmentEnabled: false,
      autoUpdateEnabled: false,
    },
    create: {
      userId,
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      data: {
        unitsSystem: "metric",
        defaultCategory: "vacation",
        welcomeSeen: true,
        whatsNewSeenVersion: appVersion,
      } as Prisma.InputJsonValue,
      historicalEnrichmentEnabled: false,
      autoUpdateEnabled: false,
    },
  });
}

/**
 * Ports keyed by UN/LOCODE, never by name — see `CruiseStopTemplate`. The
 * alias exists so the key's meaning travels with the type: a `Map<string,
 * PortRow>` says nothing about which string, and the name-keyed version of
 * this map is exactly what finding B1 was.
 */
export type PortsByLocode = Map<string, PortRow>;

export async function loadPools(): Promise<{
  airports: Map<string, AirportRow>;
  ships: Map<string, ShipRow>;
  ports: PortsByLocode;
}> {
  const airportRows = await prisma.airport.findMany({
    where: { iata: { in: AIRPORT_IATAS }, isClosed: false },
    select: {
      id: true,
      iata: true,
      icao: true,
      name: true,
      city: true,
      country: true,
      lat: true,
      lon: true,
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
    where: { unlocode: { not: null } },
    select: { id: true, name: true, city: true, country: true, unlocode: true },
  });
  const ports: PortsByLocode = new Map();
  // The UN/LOCODE is unique in the catalogue, so this map has no "last one
  // wins" to get wrong. Keying on `name` did, and it decided which country the
  // demo account sailed to (finding B1).
  for (const p of portRows) if (p.unlocode) ports.set(p.unlocode, p);

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
  when: Date
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
    depIcao: dep.icao,
    depIata: dep.iata,
    depName: dep.name,
    depLat: dep.lat,
    depLon: dep.lon,
    arrIcao: arr.icao,
    arrIata: arr.iata,
    arrName: arr.name,
    arrLat: arr.lat,
    arrLon: arr.lon,
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
    price: hasPrice
      ? Math.round(80 + Math.random() * (cls === "first" ? 5000 : cls === "business" ? 2500 : 600))
      : null,
    currency: hasPrice ? "EUR" : null,
    taxes: hasPrice && chance(0.6) ? Math.round(20 + Math.random() * 120) : null,
    fees: hasPrice && chance(0.4) ? Math.round(5 + Math.random() * 60) : null,
    category,
    tags,
    companions,
    coPassengers,
    ticketPrice: hasPrice
      ? Math.round(80 + Math.random() * (cls === "first" ? 5000 : cls === "business" ? 2500 : 600))
      : null,
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

/**
 * Exported for the seed tests, which freeze `now` — see the parameter below.
 */
export async function seedFlights(
  userId: string,
  airports: Map<string, AirportRow>,
  /**
   * The instant this seed run calls "now". It used to be the hard-coded
   * 2026-04-23, so every nightly reseed of a public instance created twenty
   * "scheduled" flights that had already departed, and called flights flown
   * that had not happened yet (finding B6, independent review 2026-09-17).
   */
  now: Date = new Date()
): Promise<void> {
  const pool = Array.from(airports.values());
  const rows: FlightSeed[] = [];

  const past = new Date("2015-01-01T00:00:00Z");
  // The forward horizon is RELATIVE, for the same reason `now` is: a fixed end
  // date becomes the past the moment it arrives, and the upcoming flights
  // would silently all be historic again.
  const future = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);

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
      }))
    );
  }
  if (linkRows.length > 0) {
    await prisma.flightCompanion.createMany({ data: linkRows, skipDuplicates: true });
  }
}

export async function seedCruises(
  userId: string,
  ships: Map<string, ShipRow>,
  ports: PortsByLocode,
  /**
   * The instant this seed run calls "now". Defaults to the real one — a fixed
   * date here is how the nightly reseed of a public instance kept creating
   * SCHEDULED cruises that had already sailed (finding B6). Tests freeze it.
   */
  now: Date = new Date()
): Promise<void> {
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
      startBase = new Date(now.getTime() + (30 + r(200)) * 24 * 60 * 60 * 1000);
    } else {
      // flown, cancelled, historical → spread across years
      startBase = new Date(
        `${yearBase}-${String(1 + r(11)).padStart(2, "0")}-${String(1 + r(27)).padStart(2, "0")}T12:00:00Z`
      );
    }

    const startDate = startBase;
    const endDate = new Date(startBase.getTime() + tpl.durationDays * 24 * 60 * 60 * 1000);

    // Only a RESOLVED port can be the cruise's departure or arrival: a stop
    // whose locode the catalogue does not hold has no id to point at, and the
    // unresolved name lives on the stop rather than on the cruise.
    const resolvedPortIds = tpl.stops
      .map((s) => ("locode" in s ? (ports.get(s.locode)?.id ?? null) : null))
      .filter((id): id is number => id !== null);
    const departurePortId = resolvedPortIds[0] ?? null;
    const arrivalPortId = resolvedPortIds[resolvedPortIds.length - 1] ?? null;

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

    // Create stops. `dayNumber` is `index + 1`, and each stop lands in exactly
    // one of the three states the invariant allows (see `CruiseStopTemplate`).
    for (const [i, stop] of tpl.stops.entries()) {
      const dayNumber = i + 1;
      if ("atSea" in stop) {
        await prisma.cruiseStop.create({
          data: {
            cruiseId: cruise.id,
            portId: null,
            dayNumber,
            isAtSea: true,
            arrivalTime: null,
            departureTime: null,
            excursionNote: null,
            unresolvedPortName: null,
          },
        });
        continue;
      }
      const { arrivalTime, departureTime } = stopTimesForDay(startDate, endDate, i);
      const port = "locode" in stop ? ports.get(stop.locode) : undefined;
      if ("locode" in stop && !port) {
        // A locode the catalogue does not hold means the catalogue is
        // incomplete, not that the ship stayed at sea. The call is kept as an
        // unresolved port carrying the locode, which is all we know about it —
        // the same state an import produces for a port it cannot match.
        await prisma.cruiseStop.create({
          data: {
            cruiseId: cruise.id,
            portId: null,
            dayNumber,
            isAtSea: false,
            arrivalTime,
            departureTime,
            excursionNote: stop.excursionNote ?? null,
            unresolvedPortName: stop.locode,
          },
        });
        continue;
      }
      await prisma.cruiseStop.create({
        data: {
          cruiseId: cruise.id,
          portId: port?.id ?? null,
          dayNumber,
          isAtSea: false,
          arrivalTime,
          departureTime,
          excursionNote: stop.excursionNote ?? null,
          unresolvedPortName: "unresolvedPortName" in stop ? stop.unresolvedPortName : null,
        },
      });
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

  // "Tokio Kurztrip" and "Adria-Kreuzfahrt" — NOT "Japan 2022" / "Mittelmeer-
  // Kreuzfahrt" — because those names are already narrated trips in
  // seedDemo/stories.ts ("Japan – Tokio bis Kyoto", "Mittelmeer-Kreuzfahrt");
  // a duplicate name here would look like the same trip seeded twice.
  const tripDefs = [
    { name: "USA Roadtrip", color: "#38bdf8", tagCount: 6 },
    { name: "Tokio Kurztrip", color: "#f472b6", tagCount: 4 },
    { name: "Südostasien Rundreise", color: "#fb923c", tagCount: 8 },
    { name: "Skandinavien im Sommer", color: "#818cf8", tagCount: 5 },
    { name: "Wochenende Barcelona", color: "#34d399", tagCount: 2 },
    { name: "Adria-Kreuzfahrt", color: "#fbbf24", tagCount: 0 },
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

/**
 * Runs the full standard demo seed and returns the userId plus final row
 * counts per domain. Idempotent: a second call wipes and re-creates
 * everything, landing on exactly the same counts (see
 * `seedDemo.full.test.ts`) — every seeder here is deterministic in row
 * COUNT (only attributes use `Math.random`), except `seedTripsAndBookings`'s
 * optional per-trip `Booking`, which is not part of the counts returned here.
 */
export async function runDemoSeed(
  /**
   * One instant for the whole run, taken once here, so flights and cruises
   * agree on what "now" is and the nightly reseed of a public instance keeps
   * producing journeys that are upcoming when it says they are (finding B6).
   */
  now: Date = new Date()
): Promise<{ userId: string; counts: Record<string, number> }> {
  const userId = await ensureUser();
  await ensureUserSettings(userId);
  const { airports, ships, ports } = await loadPools();
  if (airports.size < 60) {
    throw new Error(
      `Expected 60+ airports in pool, got ${airports.size}. Run seedAirportsFromCSV first.`
    );
  }

  await seedFlights(userId, airports, now);
  await seedCruises(userId, ships, ports, now);
  await seedTripsAndBookings(userId);
  await seedStories(userId, airports);
  await seedBulk(userId);

  try {
    await checkAndUpdateAchievements(userId);
  } catch (err) {
    // Achievement recompute is nice-to-have — not worth failing the seed.
    console.warn("   ! achievement recompute failed:", err);
  }

  const [flights, cruises, trips, stays, places, placeLists, tours, journal] = await Promise.all([
    prisma.flight.count({ where: { userId } }),
    prisma.cruise.count({ where: { userId } }),
    prisma.trip.count({ where: { userId } }),
    prisma.lodgingStay.count({ where: { userId } }),
    prisma.place.count({ where: { userId } }),
    prisma.placeList.count({ where: { userId } }),
    prisma.tripRoute.count({ where: { trip: { userId } } }),
    prisma.tripJournalEntry.count({ where: { trip: { userId } } }),
  ]);

  return { userId, counts: { flights, cruises, trips, stays, places, placeLists, tours, journal } };
}

async function main(): Promise<void> {
  console.log("🌱 Seeding demo account (demo / demo123) ...");
  const { userId, counts } = await runDemoSeed();
  console.log("");
  console.log("✅ Demo seed complete");
  console.log(`   Username: ${DEMO_USERNAME}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`   user id: ${userId}`);
  for (const [k, v] of Object.entries(counts)) console.log(`   ${k}: ${v}`);
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
