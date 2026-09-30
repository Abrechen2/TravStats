import { ALL_ACCOR, BONVOY, MARKUS, fl, rail, stay } from "./build";
import type { LodgingKey } from "./lodgings";
import type { Anchor } from "../time";
import type { FlightSpec, RailSpec, TripSpec } from "./types";

/**
 * The work trips: out on the first plane or train of the day, back in the
 * evening one or two days later. They are most of the flights, as they are
 * for anyone who commutes to customers — Munich, Hamburg, London, Zürich and
 * Vienna by air, Berlin (and Munich now and then) by ICE.
 */

type Destination = "MUC" | "HAM" | "LHR" | "ZRH" | "VIE" | "BER-rail" | "MUC-rail";

interface Row {
  anchor: Anchor;
  to: Destination;
  nights: number;
  lodging: LodgingKey;
  purpose: string;
  withColleague?: boolean;
  ungrouped?: boolean;
  /** The evening flight home was cancelled; home on the first flight next morning. */
  strike?: boolean;
}

const CITY: Record<Destination, string> = {
  MUC: "München",
  HAM: "Hamburg",
  LHR: "London",
  ZRH: "Zürich",
  VIE: "Wien",
  "BER-rail": "Berlin",
  "MUC-rail": "München",
};

/** Noted arrival delays, cycled; `undefined` is a flight where none was noted. */
const DELAYS: ReadonlyArray<number | undefined> = [
  0,
  7,
  undefined,
  15,
  0,
  42,
  3,
  undefined,
  0,
  22,
  5,
  0,
];
const PRICES = [189, 214, 176, 248, 199, 312, 167, 229, 205, 274];

const REGS: Record<string, readonly string[]> = {
  LH: ["D-AINB", "D-AINF", "D-AINJ", "D-AINQ", "D-AINW"],
  EW: ["D-AGWA", "D-AGWD", "D-AGWM", "D-AGWS"],
  BA: ["G-TTNA", "G-TTNH", "G-TTNM"],
  LX: ["HB-JCA", "HB-JCG", "HB-JCN", "HB-JCS"],
  OS: ["OE-LBO", "OE-LBR", "OE-LBU"],
};

function flightPair(to: Destination | "HAM-strike", nights: number, i: number): FlightSpec[] {
  const pick = <T>(list: readonly T[], k: number): T => list[(i * 3 + k) % list.length];
  const extra = (prefix: string, k: number): Partial<FlightSpec> => ({
    reg: pick(REGS[prefix], k),
    seat: `${3 + ((i * 7 + k) % 20)}${"ACDF"[(i + k) % 4]}`,
    delay: pick(DELAYS, k),
    price: pick(PRICES, k),
  });
  switch (to) {
    case "MUC":
      return [
        fl(0, "LH 2003", "DUS", "MUC", "07:00", "08:10", "A320neo", extra("LH", 0)),
        fl(nights, "LH 2018", "MUC", "DUS", "19:15", "20:25", "A320neo", extra("LH", 1)),
      ];
    case "HAM":
      return [
        fl(0, "EW 30", "CGN", "HAM", "06:50", "07:50", "A319", extra("EW", 0)),
        fl(nights, "EW 37", "HAM", "CGN", "19:05", "20:05", "A319", extra("EW", 1)),
      ];
    case "HAM-strike":
      return [
        fl(0, "EW 30", "CGN", "HAM", "06:50", "07:50", "A319", extra("EW", 0)),
        fl(nights - 1, "EW 37", "HAM", "CGN", "19:05", "20:05", "A319", {
          status: "cancelled",
          notes:
            "Streik bei Eurowings – annulliert. Eine Nacht mehr im Hotel, am nächsten Morgen der erste Flug.",
        }),
        fl(nights, "EW 31", "HAM", "CGN", "07:00", "08:00", "A319", {
          ...extra("EW", 1),
          delay: 12,
        }),
      ];
    case "LHR":
      return [
        fl(0, "BA 931", "DUS", "LHR", "07:05", "07:25", "A320neo", {
          ...extra("BA", 0),
          terminal: "5",
        }),
        fl(nights, "BA 942", "LHR", "DUS", "17:40", "20:00", "A320neo", {
          ...extra("BA", 1),
          terminal: "5",
        }),
      ];
    case "ZRH":
      return [
        fl(0, "LX 1017", "DUS", "ZRH", "07:05", "08:15", "A220-300", extra("LX", 0)),
        fl(nights, "LX 1022", "ZRH", "DUS", "18:50", "20:05", "A220-300", extra("LX", 1)),
      ];
    case "VIE":
      return [
        fl(0, "OS 206", "DUS", "VIE", "06:55", "08:25", "A320", extra("OS", 0)),
        fl(nights, "OS 207", "VIE", "DUS", "17:25", "19:00", "A320", extra("OS", 1)),
      ];
    default:
      return [];
  }
}

function railPair(to: Destination, nights: number, i: number): RailSpec[] {
  const delay = DELAYS[i % DELAYS.length];
  if (to === "BER-rail") {
    return [
      rail(0, "DB Fernverkehr", "ICE", "947", "koeln", "berlin", "06:08", "10:34", "first", {
        price: 139.9,
        delay,
      }),
      rail(nights, "DB Fernverkehr", "ICE", "846", "berlin", "koeln", "16:34", "21:14", "first", {
        price: 139.9,
      }),
    ];
  }
  if (to === "MUC-rail") {
    return [
      rail(0, "DB Fernverkehr", "ICE", "527", "koeln", "muenchen", "05:55", "10:30", "first", {
        price: 149.9,
        delay,
      }),
      rail(nights, "DB Fernverkehr", "ICE", "626", "muenchen", "koeln", "16:28", "21:05", "first", {
        price: 149.9,
      }),
    ];
  }
  return [];
}

const y = (yearsAgo: number, month: number, day: number): Anchor => ({ yearsAgo, month, day });

const ROWS: readonly Row[] = [
  { anchor: y(9, 3, 8), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Messe" },
  {
    anchor: y(9, 5, 16),
    to: "LHR",
    nights: 2,
    lodging: "hilton-paddington",
    purpose: "Kundenworkshop",
    withColleague: true,
  },
  {
    anchor: y(9, 10, 24),
    to: "BER-rail",
    nights: 1,
    lodging: "motel-one-ber",
    purpose: "Konferenz",
  },
  {
    anchor: y(9, 11, 21),
    to: "HAM",
    nights: 1,
    lodging: "scandic-emporio",
    purpose: "Kundentermin",
  },
  {
    anchor: y(8, 2, 7),
    to: "ZRH",
    nights: 1,
    lodging: "motel-one-zurich",
    purpose: "Projektstart",
  },
  { anchor: y(8, 3, 21), to: "MUC", nights: 2, lodging: "motel-one-muc", purpose: "Workshop" },
  {
    anchor: y(8, 6, 13),
    to: "HAM",
    nights: 1,
    lodging: "marriott-hamburg",
    purpose: "Kundentermin",
  },
  { anchor: y(8, 9, 25), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Messe" },
  {
    anchor: y(8, 11, 8),
    to: "VIE",
    nights: 2,
    lodging: "novotel-wien-hbf",
    purpose: "Konferenz",
    withColleague: true,
  },
  { anchor: y(7, 1, 24), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Kundentermin" },
  { anchor: y(7, 4, 4), to: "LHR", nights: 2, lodging: "hilton-paddington", purpose: "Workshop" },
  {
    anchor: y(7, 9, 19),
    to: "BER-rail",
    nights: 2,
    lodging: "nh-berlin-friedrichstrasse",
    purpose: "Messe",
  },
  { anchor: y(7, 10, 16), to: "HAM", nights: 1, lodging: "motel-one-ham", purpose: "Kundentermin" },
  {
    anchor: y(7, 12, 3),
    to: "ZRH",
    nights: 1,
    lodging: "radisson-blu-zurich",
    purpose: "Jahresplanung",
  },
  { anchor: y(6, 2, 12), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Kundentermin" },
  { anchor: y(6, 3, 5), to: "ZRH", nights: 1, lodging: "motel-one-zurich", purpose: "Workshop" },
  {
    anchor: y(6, 5, 22),
    to: "VIE",
    nights: 1,
    lodging: "novotel-wien-hbf",
    purpose: "Kundentermin",
  },
  { anchor: y(6, 7, 7), to: "HAM", nights: 1, lodging: "scandic-emporio", purpose: "Workshop" },
  {
    anchor: y(6, 10, 20),
    to: "LHR",
    nights: 2,
    lodging: "hilton-paddington",
    purpose: "Konferenz",
    withColleague: true,
  },
  { anchor: y(6, 11, 25), to: "MUC-rail", nights: 1, lodging: "motel-one-muc", purpose: "Messe" },
  {
    anchor: y(5, 1, 19),
    to: "ZRH",
    nights: 1,
    lodging: "motel-one-zurich",
    purpose: "Kundentermin",
  },
  { anchor: y(5, 5, 3), to: "MUC", nights: 2, lodging: "motel-one-muc", purpose: "Schulung" },
  {
    anchor: y(5, 9, 8),
    to: "HAM",
    nights: 1,
    lodging: "marriott-hamburg",
    purpose: "Kundentermin",
  },
  {
    anchor: y(5, 11, 17),
    to: "BER-rail",
    nights: 1,
    lodging: "motel-one-ber",
    purpose: "Konferenz",
  },
  {
    anchor: y(5, 12, 7),
    to: "VIE",
    nights: 1,
    lodging: "novotel-wien-hbf",
    purpose: "Jahresabschluss",
  },
  { anchor: y(4, 3, 14), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Messe" },
  { anchor: y(4, 4, 26), to: "LHR", nights: 2, lodging: "hilton-paddington", purpose: "Workshop" },
  { anchor: y(4, 6, 21), to: "HAM", nights: 1, lodging: "motel-one-ham", purpose: "Kundentermin" },
  { anchor: y(4, 9, 8), to: "HAM", nights: 1, lodging: "scandic-emporio", purpose: "Konferenz" },
  {
    anchor: y(4, 10, 11),
    to: "ZRH",
    nights: 1,
    lodging: "radisson-blu-zurich",
    purpose: "Kundentermin",
  },
  {
    anchor: y(4, 11, 29),
    to: "MUC",
    nights: 1,
    lodging: "motel-one-muc",
    purpose: "Kundentermin",
    withColleague: true,
  },
  {
    anchor: y(3, 1, 23),
    to: "VIE",
    nights: 1,
    lodging: "novotel-wien-hbf",
    purpose: "Projektstart",
  },
  { anchor: y(3, 4, 18), to: "MUC", nights: 2, lodging: "motel-one-muc", purpose: "Workshop" },
  { anchor: y(3, 6, 6), to: "HAM", nights: 1, lodging: "scandic-emporio", purpose: "Kundentermin" },
  {
    anchor: y(3, 9, 26),
    to: "LHR",
    nights: 1,
    lodging: "hilton-paddington",
    purpose: "Kundentermin",
  },
  {
    anchor: y(3, 11, 21),
    to: "BER-rail",
    nights: 1,
    lodging: "nh-berlin-friedrichstrasse",
    purpose: "Konferenz",
  },
  { anchor: y(2, 2, 7), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Kundentermin" },
  { anchor: y(2, 5, 14), to: "ZRH", nights: 1, lodging: "motel-one-zurich", purpose: "Workshop" },
  {
    anchor: y(2, 6, 25),
    to: "HAM",
    nights: 2,
    lodging: "marriott-hamburg",
    purpose: "Kundentermin",
    strike: true,
  },
  {
    anchor: y(2, 9, 23),
    to: "MUC",
    nights: 2,
    lodging: "motel-one-muc",
    purpose: "Messe",
    withColleague: true,
  },
  {
    anchor: y(2, 11, 12),
    to: "VIE",
    nights: 1,
    lodging: "novotel-wien-hbf",
    purpose: "Kundentermin",
  },
  { anchor: y(1, 1, 28), to: "HAM", nights: 1, lodging: "motel-one-ham", purpose: "Kundentermin" },
  { anchor: y(1, 3, 18), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Workshop" },
  { anchor: y(1, 4, 22), to: "LHR", nights: 2, lodging: "hilton-paddington", purpose: "Konferenz" },
  {
    anchor: y(1, 6, 17),
    to: "ZRH",
    nights: 1,
    lodging: "radisson-blu-zurich",
    purpose: "Kundentermin",
  },
  { anchor: y(1, 10, 7), to: "BER-rail", nights: 1, lodging: "motel-one-ber", purpose: "Messe" },
  { anchor: y(1, 11, 4), to: "MUC", nights: 1, lodging: "motel-one-muc", purpose: "Kundentermin" },
  {
    anchor: { daysFromNow: -33 },
    to: "MUC",
    nights: 1,
    lodging: "motel-one-muc",
    purpose: "Kundentermin",
  },
  // Written, but left out of any trip: the inbox proposes it as a new trip.
  {
    anchor: { daysFromNow: -12 },
    to: "HAM",
    nights: 1,
    lodging: "motel-one-ham",
    purpose: "Kundentermin",
    ungrouped: true,
  },
];

/** Hotel price per night in the house's own currency. */
const NIGHTLY: Partial<Record<LodgingKey, [number, string]>> = {
  "motel-one-muc": [119, "EUR"],
  "motel-one-ham": [109, "EUR"],
  "motel-one-ber": [99, "EUR"],
  "motel-one-zurich": [165, "CHF"],
  "nh-berlin-friedrichstrasse": [139, "EUR"],
  "hilton-paddington": [229, "GBP"],
  "scandic-emporio": [129, "EUR"],
  "marriott-hamburg": [169, "EUR"],
  "novotel-wien-hbf": [124, "EUR"],
  "radisson-blu-zurich": [189, "CHF"],
};

/** Which card a work stay was credited to — only the houses whose programme the traveller holds. */
const LOYALTY_BY_LODGING: Partial<Record<LodgingKey, string>> = {
  "marriott-hamburg": BONVOY,
  "novotel-wien-hbf": ALL_ACCOR,
};

export const BUSINESS_TRIPS: readonly TripSpec[] = ROWS.map((row, i) => {
  const [nightly, currency] = NIGHTLY[row.lodging] ?? [120, "EUR"];
  const byRail = row.to.endsWith("-rail");
  return {
    key: `business-${i + 1}`,
    name: `Dienstreise ${CITY[row.to]}: ${row.purpose}`,
    anchor: row.anchor,
    days: row.nights + 1,
    category: "business",
    color: "#64748b",
    icon: "💼",
    origin: "Köln",
    destination: CITY[row.to],
    companions: row.withColleague ? [MARKUS] : [],
    tags: ["Dienstreise"],
    flights: byRail ? [] : flightPair(row.strike ? "HAM-strike" : row.to, row.nights, i),
    rail: byRail ? railPair(row.to, row.nights, i) : [],
    stays: [
      stay(
        row.lodging,
        0,
        row.nights,
        nightly * row.nights,
        currency,
        "breakfast",
        3 + (i % 3 === 0 ? 1 : 0),
        {
          loyalty: LOYALTY_BY_LODGING[row.lodging],
        }
      ),
    ],
    ungrouped: row.ungrouped,
  };
});
