/**
 * The COVERAGE cruise seed: one cruise per cruise line in the ship catalogue,
 * across every status and region, with every stop state. It used to be the
 * demo account's content; since the realistic demo account (2026-09-26) it
 * fills the dev admin (`seedDevAdmin.ts`), whose job is to exercise every
 * feature rather than to read like somebody's life, and its tests keep the
 * stop invariants it was fixed for.
 */

import { prisma } from "../db";
import { linkRowsFor, resolveCompanions } from "../services/companionService";
import { stopTimesForDay } from "./cruiseTiming";

type ShipRow = { id: number; name: string; cruiseLine: string };
type PortRow = {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  unlocode: string | null;
};

const r = (n: number) => Math.floor(Math.random() * n);
const chance = (p: number) => Math.random() < p;

function pnr(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[r(chars.length)];
  return out;
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
  /** One of the four values the cruise schema stores — never a label. */
  cabinType: "inside" | "oceanview" | "balcony" | "suite" | null;
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
    cabinType: "balcony",
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
    cabinType: "suite",
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
    cabinType: "oceanview",
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
    cabinType: "balcony",
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
    cabinType: "inside",
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
    cabinType: "oceanview",
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
    cabinType: "balcony",
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
    cabinType: "suite",
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
    cabinType: "oceanview",
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
    cabinType: "balcony",
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
    cabinType: "suite",
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
    cabinType: "balcony",
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
    cabinType: "balcony",
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
    cabinType: "suite",
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
    cabinType: "balcony",
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
    cabinType: "oceanview",
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
    cabinType: "balcony",
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
    cabinType: "suite",
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
    cabinType: "oceanview",
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
    cabinType: "suite",
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
    cabinType: "suite",
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
    cabinType: "inside",
    deck: 5,
    priceEur: 490,
    durationDays: 3,
    tags: ["kurztrip", "wochenende"],
    companions: [],
    stops: [{ locode: "DEKEL" }, { locode: "DKCPH" }, { locode: "DEKEL" }],
  },
];

/**
 * Ports keyed by UN/LOCODE, never by name — see `CruiseStopTemplate`. The
 * alias exists so the key's meaning travels with the type: a `Map<string,
 * PortRow>` says nothing about which string, and the name-keyed version of
 * this map is exactly what finding B1 was.
 */
export type PortsByLocode = Map<string, PortRow>;

export async function loadPools(): Promise<{
  ships: Map<string, ShipRow>;
  ports: PortsByLocode;
}> {
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

  return { ships, ports };
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
    let status: "completed" | "scheduled" | "cancelled" | "historical";
    if (idx < 15) status = "completed";
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
