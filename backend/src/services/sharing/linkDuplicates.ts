/**
 * Before a one-sided entry may be added to the other copy of a linked trip (owner decision,
 * 2026-11-28): is it perhaps already there under another shape? The matcher (`linkMatch.ts`) pairs
 * only what is certainly the same journey or stay; this check is looser on purpose and only WARNS —
 * a likely duplicate is shown as "möglicherweise doppelt mit …" and cannot be ticked without being
 * looked at. Same type, overlapping time, and one of: the same flight or train number, the same
 * hotel by name or chain, or a place nearby.
 */
import { haversineKm } from "../../shared/geo/haversine";
import { normalisedFlightNumber } from "./ownFlightMatch";
import { labelOf, whenOf, type LinkRow } from "./linkMatch";
import { normalisedLodgingName } from "./facts/lodgingStay";

type Facts = Record<string, unknown>;

/** Two places this close are "nearby" for a duplicate warning. */
const NEAR_KM = 5;
/** Two moments this close are "the same time" when an entry knows no end. */
const SAME_TIME_MS = 36 * 3_600_000;

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : t;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";

/** The span an entry covers, by type: [start, end] in epoch ms, or null when it has no time. */
function span(entity: LinkRow["entity"], f: Facts): [number, number] | null {
  const pick = (a: string, b: string) => {
    const s = ms(f[a]);
    if (s === null) return null;
    const e = ms(f[b]);
    return [s, e !== null && e >= s ? e : s] as [number, number];
  };
  switch (entity) {
    case "lodgingStay":
      return (
        pick("checkIn", "checkOut") ??
        pick("checkInDate", "checkOutDate") ??
        pick("checkInAt", "checkOutAt")
      );
    case "cruise":
      return pick("startDate", "endDate") ?? pick("startDay", "endDay");
    case "rental":
      return pick("pickupTime", "returnTime");
    case "flight":
    case "rail":
    case "bus":
    case "ferry":
      return pick("departureTime", "arrivalTime");
    case "tour":
      return pick("tourDate", "tourDate");
    case "stop":
      return pick("startUtc", "endUtc") ?? pick("startDate", "endDate");
    default:
      return null;
  }
}

function overlaps(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return false;
  return a[0] - SAME_TIME_MS <= b[1] && b[0] - SAME_TIME_MS <= a[1];
}

/** A point of the entry: where it starts (or the house). */
function placeOf(entity: LinkRow["entity"], f: Facts): { lat: number; lon: number } | null {
  const at = (lat: unknown, lon: unknown) => {
    const a = num(lat);
    const o = num(lon);
    return a !== null && o !== null ? { lat: a, lon: o } : null;
  };
  if (entity === "lodgingStay") {
    const house = (f.lodging ?? {}) as Facts;
    return at(house.lat, house.lon);
  }
  if (entity === "rental") return at(f.pickupLat, f.pickupLon);
  return at(f.depLat, f.depLon) ?? at(f.lat, f.lon);
}

const near = (a: { lat: number; lon: number } | null, b: { lat: number; lon: number } | null) =>
  !!a && !!b && haversineKm(a, b) <= NEAR_KM;

/** The type-specific sign that two overlapping entries are the same thing. */
function sameThing(entity: LinkRow["entity"], a: Facts, b: Facts): boolean {
  switch (entity) {
    case "flight": {
      const n = normalisedFlightNumber((a.flightNumber as string | null) ?? null);
      if (n && n === normalisedFlightNumber((b.flightNumber as string | null) ?? null)) return true;
      return text(a.depIata) !== "" && text(a.depIata) === text(b.depIata);
    }
    case "rail": {
      const n = text(a.trainNumber);
      if (n && n === text(b.trainNumber)) return true;
      break;
    }
    case "lodgingStay": {
      const h = (a.lodging ?? {}) as Facts;
      const k = (b.lodging ?? {}) as Facts;
      const name = (v: unknown) => (typeof v === "string" ? normalisedLodgingName(v) : "");
      if (name(h.name) && name(h.name) === name(k.name)) return true;
      if (h.catalogueChainId != null && h.catalogueChainId === k.catalogueChainId) return true;
      break;
    }
    case "roadtrip":
    case "tour":
      return text(a.name) !== "" && text(a.name) === text(b.name);
    case "stop":
      if (text(a.title) !== "" && text(a.title) === text(b.title)) return true;
      break;
    default:
      break;
  }
  return near(placeOf(entity, a), placeOf(entity, b));
}

export interface DuplicateHint {
  label: string;
  when: string | null;
}

/** The first entry of `others` the one-sided `row` is perhaps a duplicate of, or null. */
export function likelyDuplicate(row: LinkRow, others: readonly LinkRow[]): DuplicateHint | null {
  const mine = span(row.entity, row.row.facts);
  for (const other of others) {
    if (other.entity !== row.entity || other.row.excluded) continue;
    const theirs = span(other.entity, other.row.facts);
    const timeless = mine === null && theirs === null;
    if (!timeless && !overlaps(mine, theirs)) continue;
    if (!sameThing(row.entity, row.row.facts, other.row.facts)) continue;
    return { label: labelOf(other.entity, other.row), when: whenOf(other.entity, other.row.facts) };
  }
  return null;
}

/** How the link names a one-sided entry in `add`: its type and its row on that side. */
export const oneSidedRef = (r: LinkRow): string => `${r.entity}:${r.row.id}`;
