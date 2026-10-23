/**
 * What kind of vehicle a bahn.de connection leg is (2026-10-23): a train, a
 * U-Bahn, a tram, a bus — or not known. A share link of a ride through a city
 * carries the trams and buses of the local network beside the trains, and the
 * rail review must not offer those as train rides by default.
 *
 * The structured product type wins where bahn.de states one: the web client's
 * `produktGattung` (`ICE`, `REGIONAL`, `UBAHN`, `TRAM`, `BUS`, `SCHIFF`, …; its
 * search filter spells the same groups `HOCHGESCHWINDIGKEITSZUEGE`, `BUSSE`,
 * …), or the HAFAS category code a `hinfahrtRecon` carries per vehicle (`CA#DRB`,
 * `CA#DBS`, `CA#STR` — the codes the recon's own product list enumerates). Only
 * without one is the printed name read ("U 3", "STR 12", "Bus 100", "RE 5").
 *
 * The table is a spelling list, not a guess: a code it does not hold is
 * `unknown` — `FLX`, which bahn.de gives FlixTrain and FlixBus alike, among them —
 * except a name that is a bare train number ("57031"), which is how
 * bahn.de prints a regional train without its category.
 */

export const LEG_MODES = ["rail", "metro", "tram", "bus", "ferry", "unknown"] as const;
export type LegMode = (typeof LEG_MODES)[number];

/** A bus leg's kind: the city's bus, a rail replacement bus („SEV“), or a long-distance coach. */
export const BUS_KINDS = ["city", "replacement", "coach"] as const;
export type BusKind = (typeof BUS_KINDS)[number];

export interface LegTransit {
  mode: LegMode;
  /** Set only for `bus`. */
  busKind: BusKind | null;
}

const RAIL: LegTransit = { mode: "rail", busKind: null };
const METRO: LegTransit = { mode: "metro", busKind: null };
const TRAM: LegTransit = { mode: "tram", busKind: null };
const FERRY: LegTransit = { mode: "ferry", busKind: null };
const UNKNOWN: LegTransit = { mode: "unknown", busKind: null };
const bus = (busKind: BusKind): LegTransit => ({ mode: "bus", busKind });

/** bahn.de's web-client product groups, both spellings. */
const PRODUCT_GROUPS: Readonly<Record<string, LegTransit>> = {
  ICE: RAIL,
  EC_IC: RAIL,
  IR: RAIL,
  REGIONAL: RAIL,
  SBAHN: RAIL,
  HOCHGESCHWINDIGKEITSZUEGE: RAIL,
  INTERCITYUNDEUROCITYZUEGE: RAIL,
  INTERREGIOUNDSCHNELLZUEGE: RAIL,
  NAHVERKEHRSONSTIGEZUEGE: RAIL,
  REGIONALZUEGE: RAIL,
  SBAHNEN: RAIL,
  UBAHN: METRO,
  TRAM: TRAM,
  STRASSENBAHN: TRAM,
  BUS: bus("city"),
  BUSSE: bus("city"),
  SCHIFF: FERRY,
  SCHIFFE: FERRY,
};

/**
 * HAFAS category codes, case kept: bahn.de tells `S` (S-Bahn) from `s` and
 * `Str` from `STR` only by spelling, and every spelling in a recon's product
 * list is here. A Stadtbahn (`Stb`, `stb`) is the light rail of a city's own
 * network and reads as a tram.
 */
const CATEGORY_CODES: Readonly<Record<string, LegTransit>> = {
  // Long distance and international.
  ICE: RAIL,
  IC: RAIL,
  EC: RAIL,
  ECE: RAIL,
  EN: RAIL,
  NJ: RAIL,
  ICd: RAIL,
  ICr: RAIL,
  IXd: RAIL,
  IXr: RAIL,
  RJ: RAIL,
  RJX: RAIL,
  RJd: RAIL,
  TGV: RAIL,
  EST: RAIL,
  WB: RAIL,
  CAT: RAIL,
  CJX: RAIL,
  EBd: RAIL,
  // Regional, S-Bahn and the operators' own regional codes.
  IRE: RAIL,
  RE: RAIL,
  RB: RAIL,
  REX: RAIL,
  RER: RAIL,
  MEX: RAIL,
  FEX: RAIL,
  NRB: RAIL,
  NRE: RAIL,
  DRB: RAIL,
  DRE: RAIL,
  DRS: RAIL,
  DBS: RAIL,
  DPN: RAIL,
  PPN: RAIL,
  SWB: RAIL,
  ZRB: RAIL,
  TER: RAIL,
  SON: RAIL,
  R84: RAIL,
  S84: RAIL,
  T84: RAIL,
  SB: RAIL,
  Sp: RAIL,
  RT: RAIL,
  Os: RAIL,
  OZ: RAIL,
  Zr: RAIL,
  S: RAIL,
  s: RAIL,
  R: RAIL,
  E: RAIL,
  e: RAIL,
  N: RAIL,
  // A city's own network.
  U: METRO,
  u: METRO,
  ubu: METRO,
  STR: TRAM,
  Str: TRAM,
  stR: TRAM,
  Tram: TRAM,
  TRAM: TRAM,
  Stb: TRAM,
  stb: TRAM,
  // Buses: city, replacement, long distance.
  Bus: bus("city"),
  BUS: bus("city"),
  OBU: bus("city"),
  Bsv: bus("replacement"),
  BSV: bus("replacement"),
  SEV: bus("replacement"),
  FB: bus("coach"),
  Fernbus: bus("coach"),
  // Water.
  Schiff: FERRY,
  SCH: FERRY,
  KAT: FERRY,
  BAT: FERRY,
  FAE: FERRY,
};

function fromProductGroup(group: string | null | undefined): LegTransit | null {
  const key = group?.trim().toUpperCase();
  return key ? (PRODUCT_GROUPS[key] ?? null) : null;
}

function fromCategory(code: string | null | undefined): LegTransit | null {
  const key = code?.trim();
  if (!key) return null;
  return CATEGORY_CODES[key] ?? CATEGORY_CODES[key.toUpperCase()] ?? null;
}

/** "SEV/Bus" and "Bus SEV" are replacement buses whatever the category says. */
const REPLACEMENT = /\bSEV\b|Schienenersatz/i;

/** The printed name: its first word ("STR 12" → STR, "U3" → U), or a bare number. */
function fromPrintedName(printed: string | null | undefined): LegTransit | null {
  const name = printed?.replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (REPLACEMENT.test(name)) return bus("replacement");
  if (/^\d{1,6}$/.test(name)) return RAIL;
  const word = /^([A-Za-zÄÖÜäöü]+)/.exec(name)?.[1] ?? null;
  return fromCategory(word);
}

export interface LegModeInput {
  /** bahn.de's web-client `produktGattung` (or the search filter's spelling). */
  productGroup?: string | null;
  /** The HAFAS category code (`CA#…` in a recon). */
  categoryCode?: string | null;
  /** The category as printed beside the number ("RE", "STR"). */
  category?: string | null;
  /** The vehicle's whole printed name ("STR 12", "Bus 100", "57031"). */
  printedName?: string | null;
}

/** The leg's kind of vehicle — structured facts first, the printed name last, never a guess. */
export function classifyLegMode(input: LegModeInput): LegTransit {
  const printed = input.printedName ?? null;
  const stated =
    fromProductGroup(input.productGroup) ??
    fromCategory(input.categoryCode) ??
    fromCategory(input.category) ??
    fromPrintedName(printed);
  if (!stated) return UNKNOWN;
  // A bus the data calls a bus but prints as a replacement is the replacement.
  if (stated.mode === "bus" && printed && REPLACEMENT.test(printed)) return bus("replacement");
  return stated;
}
