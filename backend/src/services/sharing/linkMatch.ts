import { localDay } from "../../shared/time/instant";
import { calculateDistance } from "../../utils/geo";
import { ADAPTERS, type ShareEntity, type SharedRow } from "./adapters";
import { changedKeys, type FactRecord } from "./factValues";
import { isSameHouse, normalisedLodgingName, type HouseIdentity } from "./facts/lodgingStay";
import { sameFlight, type FlightIdentity } from "./ownFlightMatch";

/**
 * Linking an existing copy (forgejo#440): two accounts that already hold the same trip are joined
 * without creating anything. This file is the pure half — which entry on one side IS which entry
 * on the other. Identity, by type:
 *
 * - flight: flight number + route + local departure day (`sameFlight`, as the copy path joins);
 *   a flight with no number on either side (a sightseeing or charter round) by route + the same
 *   departure instant (`sameNumberlessFlight`);
 * - stay: the same house (`isSameHouse`, name AND place) and the same check-in and check-out day;
 * - rail, bus: departure and arrival station names + local departure day;
 * - ferry: local departure day + both ports by name, or both within `FERRY_PORT_KM`;
 * - rental: provider + local pickup and return day;
 * - cruise: ship (or line + route name) + first day; roadtrip: name; tour: name + day;
 * - timeline stop: domain + title + day.
 *
 * Several candidates are paired greedily by the smallest time gap, so two flights of one number on
 * consecutive days never cross. A pair already holding the same share key is linked already.
 * Nothing here reads the database.
 */

/** `best`: the better value wins each difference, a tie keeps both (`linkResolve.ts`). */
export type LinkDecision = "mine" | "theirs" | "both" | "best";
export const LINK_DECISIONS: readonly LinkDecision[] = ["mine", "theirs", "both", "best"];

export interface LinkRow {
  entity: ShareEntity;
  row: SharedRow;
}

export interface LinkPair {
  entity: ShareEntity;
  here: SharedRow;
  there: SharedRow;
  /** The facts that differ — what the decision settles. */
  conflicts: string[];
  /** Both rows hold the same key already (a repeated link). */
  linked: boolean;
}

export interface LinkPlan {
  pairs: LinkPair[];
  onlyHere: LinkRow[];
  onlyThere: LinkRow[];
}

/**
 * Facts never compared: the advisory status (each server derives its own) and a stop's references
 * to the entries it wraps — keys that differ until the link itself sets them.
 */
const NOT_COMPARED = new Set(["status", "sourceRef", "lodgingStayRef"]);

/** Two ferry ports this close are one port (pier vs. terminal centroid). */
const FERRY_PORT_KM = 10;

const norm = (v: unknown): string =>
  typeof v === "string" ? normalisedLodgingName(v) : v == null ? "" : String(v);

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A calendar column (`@db.Date`) as its day. */
const dateDay = (v: unknown): string | null => asDate(v)?.toISOString().slice(0, 10) ?? null;

/** An instant as the local day in `zone` (UTC when the zone is unknown). */
function zonedDay(v: unknown, zone: unknown): string | null {
  const d = asDate(v);
  if (!d) return null;
  try {
    return localDay(d, typeof zone === "string" && zone !== "" ? zone : "UTC");
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const sameNonEmpty = (a: string, b: string) => a !== "" && a === b;
const sameDay = (a: string | null, b: string | null) => a !== null && a === b;

function nearPoint(a: FactRecord, b: FactRecord, lat: string, lon: string): boolean {
  const [la, lo, lb, mb] = [a[lat], a[lon], b[lat], b[lon]];
  if (typeof la !== "number" || typeof lo !== "number") return false;
  if (typeof lb !== "number" || typeof mb !== "number") return false;
  return calculateDistance(la, lo, lb, mb) <= FERRY_PORT_KM;
}

function stationRoute(a: FactRecord, b: FactRecord): boolean {
  return (
    sameNonEmpty(norm(a.depStationName), norm(b.depStationName)) &&
    sameNonEmpty(norm(a.arrStationName), norm(b.arrStationName)) &&
    sameDay(zonedDay(a.departureTime, a.depTimezone), zonedDay(b.departureTime, b.depTimezone))
  );
}

function ferryRoute(a: FactRecord, b: FactRecord): boolean {
  if (!sameDay(zonedDay(a.departureTime, a.depTimezone), zonedDay(b.departureTime, b.depTimezone)))
    return false;
  const dep =
    sameNonEmpty(norm(a.depStationName), norm(b.depStationName)) ||
    nearPoint(a, b, "depLat", "depLon");
  const arr =
    sameNonEmpty(norm(a.arrStationName), norm(b.arrStationName)) ||
    nearPoint(a, b, "arrLat", "arrLon");
  return dep && arr;
}

function sameStay(a: FactRecord, b: FactRecord): boolean {
  const ha = a.lodging as HouseIdentity | null | undefined;
  const hb = b.lodging as HouseIdentity | null | undefined;
  if (!ha || !hb || !isSameHouse(ha, hb)) return false;
  const inA = dateDay(a.checkInDate) ?? zonedDay(a.checkIn, a.stayZone);
  const inB = dateDay(b.checkInDate) ?? zonedDay(b.checkIn, b.stayZone);
  const outA = dateDay(a.checkOutDate) ?? zonedDay(a.checkOut, a.stayZone);
  const outB = dateDay(b.checkOutDate) ?? zonedDay(b.checkOut, b.stayZone);
  return sameDay(inA, inB) && sameDay(outA, outB);
}

function sameRental(a: FactRecord, b: FactRecord): boolean {
  const provider = sameNonEmpty(norm(a.provider), norm(b.provider));
  const station = sameNonEmpty(norm(a.pickupStationName), norm(b.pickupStationName));
  return (
    (provider || station) &&
    sameDay(zonedDay(a.pickupTime, a.pickupTimezone), zonedDay(b.pickupTime, b.pickupTimezone)) &&
    sameDay(zonedDay(a.returnTime, a.returnTimezone), zonedDay(b.returnTime, b.returnTimezone))
  );
}

function sameCruise(a: FactRecord, b: FactRecord): boolean {
  const ship =
    (a.shipId != null && a.shipId === b.shipId) ||
    sameNonEmpty(norm(a.shipNameOverride), norm(b.shipNameOverride)) ||
    (sameNonEmpty(norm(a.cruiseLine), norm(b.cruiseLine)) &&
      norm(a.routeName) === norm(b.routeName));
  const first = (f: FactRecord) => dateDay(f.startDay) ?? zonedDay(f.startDate, f.startZone);
  return ship && sameDay(first(a), first(b));
}

/**
 * Two flights neither of which has a number (helicopter rounds, charters, gliders: 11 on the
 * owner's account) are the same flight on the same route at the same instant. A day is not
 * enough here: two rounds from one airfield on one day are common, and nothing else tells them
 * apart.
 */
function sameNumberlessFlight(a: FactRecord, b: FactRecord): boolean {
  const f = a as unknown as FlightIdentity;
  const g = b as unknown as FlightIdentity;
  if (f.flightNumber?.trim() || g.flightNumber?.trim()) return false;
  const code = (iata: string | null, icao: string | null) =>
    (iata ?? icao)?.trim().toUpperCase() || null;
  const dep = code(f.depIata, f.depIcao);
  const arr = code(f.arrIata, f.arrIcao);
  if (!dep || !arr || dep !== code(g.depIata, g.depIcao) || arr !== code(g.arrIata, g.arrIcao))
    return false;
  const t = asDate(a.departureTime);
  const u = asDate(b.departureTime);
  return t !== null && u !== null && t.getTime() === u.getTime();
}

/** A stop without a date (a place on the timeline) matches on domain and title alone. */
function sameStop(a: FactRecord, b: FactRecord): boolean {
  return (
    (a.domain ?? null) === (b.domain ?? null) &&
    sameNonEmpty(norm(a.title), norm(b.title)) &&
    dateDay(a.startDate) === dateDay(b.startDate)
  );
}

const SAME: Record<ShareEntity, (a: FactRecord, b: FactRecord) => boolean> = {
  flight: (a, b) =>
    sameFlight(a as unknown as FlightIdentity, b as unknown as FlightIdentity) ||
    sameNumberlessFlight(a, b),
  lodgingStay: sameStay,
  cruise: sameCruise,
  rail: stationRoute,
  bus: stationRoute,
  ferry: ferryRoute,
  rental: sameRental,
  roadtrip: (a, b) => sameNonEmpty(norm(a.name), norm(b.name)),
  tour: (a, b) =>
    sameNonEmpty(norm(a.name), norm(b.name)) && dateDay(a.tourDate) === dateDay(b.tourDate),
  stop: sameStop,
};

/** The fact an entry's time is read from, by type — for the pairing order and the dry run. */
const TIME_FACT: Record<ShareEntity, string> = {
  flight: "departureTime",
  lodgingStay: "checkIn",
  cruise: "startDate",
  rail: "departureTime",
  bus: "departureTime",
  ferry: "departureTime",
  rental: "pickupTime",
  roadtrip: "startDate",
  tour: "tourDate",
  stop: "startUtc",
};

/** When an entry happens, as an ISO instant, or null. */
export function whenOf(entity: ShareEntity, facts: FactRecord): string | null {
  const d =
    asDate(facts[TIME_FACT[entity]]) ??
    asDate(facts.checkInDate) ??
    asDate(facts.startDay) ??
    asDate(facts.startDate);
  return d ? d.toISOString() : null;
}

/** A label for a row that came without one (an entry decoded from the wire). */
export function labelOf(entity: ShareEntity, row: SharedRow): string {
  if (row.label) return row.label;
  const f = row.facts;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const route = (dep: string, arr: string) => `${s(f[dep]) || "?"} → ${s(f[arr]) || "?"}`;
  switch (entity) {
    case "flight":
      return `${s(f.flightNumber) || s(f.airline)} ${route("depIata", "arrIata")}`.trim();
    case "lodgingStay":
      return s((f.lodging as { name?: unknown } | null)?.name) || "?";
    case "rail":
    case "bus":
    case "ferry":
      return route("depStationName", "arrStationName");
    case "rental":
      return `${s(f.provider)} ${s(f.pickupStationName)}`.trim() || "?";
    case "cruise":
      return s(f.shipNameOverride) || s(f.routeName) || s(f.cruiseLine) || "?";
    case "stop":
      return s(f.title) || "?";
    default:
      return s(f.name) || "?";
  }
}

const gap = (entity: ShareEntity, a: SharedRow, b: SharedRow): number => {
  const ta = asDate(a.facts[TIME_FACT[entity]])?.getTime();
  const tb = asDate(b.facts[TIME_FACT[entity]])?.getTime();
  return ta === undefined || tb === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(ta - tb);
};

/** The facts in which `here` and `there` disagree, the uncompared ones aside. */
export function conflictsOf(entity: ShareEntity, here: FactRecord, there: FactRecord): string[] {
  return changedKeys(here, there, ADAPTERS[entity].fields).filter((k) => !NOT_COMPARED.has(k));
}

function pairType(entity: ShareEntity, here: SharedRow[], there: SharedRow[]): LinkPlan {
  const pairs: LinkPair[] = [];
  const usedHere = new Set<string>();
  const usedThere = new Set<string>();
  const take = (h: SharedRow, t: SharedRow, linked: boolean) => {
    usedHere.add(h.id);
    usedThere.add(t.id);
    pairs.push({
      entity,
      here: h,
      there: t,
      linked,
      conflicts: conflictsOf(entity, h.facts, t.facts),
    });
  };
  // Linked already: the same key on both sides.
  const byKey = new Map(there.flatMap((t) => (t.shareKey ? [[t.shareKey, t] as const] : [])));
  for (const h of here) {
    const t = h.shareKey ? byKey.get(h.shareKey) : undefined;
    if (t) take(h, t, true);
  }
  const candidates: { h: SharedRow; t: SharedRow; d: number }[] = [];
  for (const h of here) {
    if (usedHere.has(h.id)) continue;
    for (const t of there) {
      if (usedThere.has(t.id) || !SAME[entity](h.facts, t.facts)) continue;
      candidates.push({ h, t, d: gap(entity, h, t) });
    }
  }
  candidates.sort((x, y) => x.d - y.d || x.h.id.localeCompare(y.h.id));
  for (const { h, t } of candidates) {
    if (usedHere.has(h.id) || usedThere.has(t.id)) continue;
    take(h, t, false);
  }
  return {
    pairs,
    onlyHere: here.filter((h) => !usedHere.has(h.id)).map((row) => ({ entity, row })),
    onlyThere: there.filter((t) => !usedThere.has(t.id)).map((row) => ({ entity, row })),
  };
}

/** Pair every entry of `here` with the one of `there` that is the same journey or stay. */
export function planLink(here: readonly LinkRow[], there: readonly LinkRow[]): LinkPlan {
  const out: LinkPlan = { pairs: [], onlyHere: [], onlyThere: [] };
  const entities = [...new Set([...here, ...there].map((r) => r.entity))];
  for (const entity of entities) {
    const rows = (list: readonly LinkRow[]) =>
      list.filter((r) => r.entity === entity && !r.row.excluded).map((r) => r.row);
    const part = pairType(entity, rows(here), rows(there));
    out.pairs.push(...part.pairs);
    out.onlyHere.push(...part.onlyHere);
    out.onlyThere.push(...part.onlyThere);
  }
  return out;
}
