/**
 * Where an imported row came from, expressed as a key that stays the same the
 * next time the same file is imported — so a second run recognises the row
 * instead of duplicating it.
 *
 * The key must identify the ENTRY, never merely the booking. A return leg
 * shares its PNR with the outbound one, so `booking:<PNR>` on a flight would
 * make the unique index refuse the second half of every trip — data silently
 * missing, and the user with no way to see why. What identifies a flight is
 * the journey itself: which flight, on which day, between which airports.
 *
 * Rows entered by hand get no key at all. Provenance is a statement about a
 * source; a manual entry has none, and Postgres treats NULLs as distinct, so
 * they never collide with each other.
 */

/** Prefix marking a key as machine-derived rather than a real foreign id. */
const DERIVED = "import";

function segment(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().toUpperCase();
  // A colon would split the key when read back; a missing part becomes "-" so
  // the shape stays fixed and two different absences never look alike.
  return trimmed.length === 0 ? "-" : trimmed.replace(/:/g, "_");
}

function dayOf(localDateTime: string | null | undefined): string {
  const s = (localDateTime ?? "").trim();
  return s.length >= 10 ? s.slice(0, 10) : "-";
}

export interface FlightIdentity {
  flightNumber?: string | null;
  departureLocal?: string | null;
  depIata?: string | null;
  arrIata?: string | null;
}

/**
 * `import:<flightNo>:<YYYY-MM-DD>:<FROM>-<TO>`
 *
 * Returns null when the row carries too little to be identified — a key made
 * of nothing but dashes would collide with every other unidentifiable row and
 * swallow them all.
 */
export function flightExternalRef(f: FlightIdentity): string | null {
  const day = dayOf(f.departureLocal);
  const from = segment(f.depIata);
  const to = segment(f.arrIata);
  const no = segment(f.flightNumber);
  if (day === "-") return null;
  if (no === "-" && (from === "-" || to === "-")) return null;
  return `${DERIVED}:${no}:${day}:${from}-${to}`;
}

export interface CruiseIdentity {
  bookingReference?: string | null;
  shipNameOverride?: string | null;
  cruiseLine?: string | null;
  startDate?: string | null;
}

/**
 * A cruise booking reference identifies ONE cruise (unlike a flight PNR, which
 * spans legs), so it is used directly when present. Without one the identity
 * is the ship and the day it sailed.
 */
export function cruiseExternalRef(c: CruiseIdentity): string | null {
  const ref = segment(c.bookingReference);
  if (ref !== "-") return `booking:${ref}`;
  const day = dayOf(c.startDate);
  const ship = segment(c.shipNameOverride ?? c.cruiseLine);
  if (day === "-" || ship === "-") return null;
  return `${DERIVED}:${ship}:${day}`;
}
