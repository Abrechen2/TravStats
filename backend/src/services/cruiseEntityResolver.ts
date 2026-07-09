import type { Port, Ship } from "@prisma/client";
import { prisma } from "../db";
import logger from "../utils/logger";
import type { CruiseInput } from "../schemas/cruise";
import type { ParsedCruise, ParsedCruiseStop, ParsedFlight } from "./cruiseBookingParser";
import { findNearestAirport, type AirportData } from "./airportLookup";
import { getCurrentHomeAirport, normalizeHistory } from "../utils/homeAirport";
import { expandPortSearchTerms } from "./portExonyms";

// In-memory cache for ship + port candidate lists. Both tables are populated
// from a static CSV at boot and mutated only via /ports POST and /ships POST
// (rare, manual). Caching the candidate arrays in module scope shaves the
// resolve step from ~50ms (fetch ~1000 ports + ~30 ships) down to <1ms once
// warm. Bumping `cacheVersion` (via invalidateCruiseEntityCache, called from
// the port/ship route handlers on create) is enough — there's no TTL because
// stale entries can't drift on their own.
let cachedShips: ShipCandidate[] | null = null;
let cachedPorts: PortCandidate[] | null = null;

export function invalidateCruiseEntityCache(): void {
  cachedShips = null;
  cachedPorts = null;
}

/**
 * Resolved cruise input ready to POST to /api/v1/cruises, plus a side-channel
 * report describing what could not be matched. Unmatched ports become
 * `excursionNote` annotations so the user sees them in the UI rather than
 * silently dropped.
 */
export interface ResolvedCruise {
  input: CruiseInput;
  shipMatched: boolean;
  unmatchedPorts: { dayNumber: number; portName: string }[];
  /** Fly & cruise flights bundled with the booking, passed through verbatim
   *  for the import preview to turn into editable flight cards. */
  flights: ParsedFlight[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TUI itineraries spell ports like "Bayonne (New York)" or "Sydney
 * (Neuschottland)" — parens hold the region/country. Try the bare leading
 * portion first; the suffix becomes a country/region hint via the second
 * pass. Returns [bare, hint] (hint may be undefined).
 */
function splitParenSuffix(name: string): [string, string | undefined] {
  const m = name.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return [name.trim(), undefined];
  return [m[1].trim(), m[2].trim()];
}

/**
 * Score how well a candidate string matches a needle. Higher = better.
 * 100 = exact, 80 = startsWith, 60 = contains, 0 = no match.
 */
function similarity(needle: string, candidate: string): number {
  const n = normalize(needle);
  const c = normalize(candidate);
  if (!n || !c) return 0;
  if (n === c) return 100;
  // Candidate is the fuller string (catalog carries a region/suffix the parsed
  // name omits, e.g. "Bayonne" ⊆ "Bayonne (Cape Liberty)"): always safe.
  if (c.startsWith(n)) return 80;
  if (c.includes(n)) return 60;
  // Needle is the fuller string (parsed name has extra text): only trust it
  // when the catalog token is substantial, so a short catalog name can't be
  // swallowed by a longer needle — e.g. "Atlantis" must NOT match "Atla".
  if (c.length >= 5 && n.startsWith(c)) return 80;
  if (c.length >= 5 && n.includes(c)) return 60;
  return 0;
}

/**
 * Bounded Levenshtein distance — returns the true distance, or `max + 1`
 * as soon as the lower bound provably exceeds `max` (cheap early-out so we
 * never do the full DP for far-apart strings across ~12k port candidates).
 */
function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Fuzzy name match for close spellings the exonym map doesn't cover —
 * e.g. the Portuguese endonym "Lisboa" vs the catalog "Lisbon", or minor
 * transliteration drift. Deliberately strict (edit distance ≤1 on names
 * ≥5 chars, ≤2 on names ≥8) so it never out-ranks a real prefix/contains
 * hit and rarely fires on unrelated ports. Scored below `similarity`'s
 * exact/startsWith tiers but above its 60 acceptance threshold.
 */
function fuzzyNameScore(needle: string, candidate: string): number {
  const n = normalize(needle);
  const c = normalize(candidate);
  if (!n || !c || n[0] !== c[0]) return 0;
  const shorter = Math.min(n.length, c.length);
  if (shorter < 5) return 0;
  if (levenshtein(n, c, 1) <= 1) return 75;
  if (shorter >= 8 && levenshtein(n, c, 2) <= 2) return 70;
  return 0;
}

interface ShipCandidate {
  id: number;
  name: string;
  cruiseLine: string;
}

interface PortCandidate {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
}

async function loadShipCandidates(): Promise<ShipCandidate[]> {
  if (cachedShips) return cachedShips;
  cachedShips = await prisma.ship.findMany({
    select: { id: true, name: true, cruiseLine: true },
  });
  return cachedShips;
}

async function resolveShip(
  shipName: string | undefined,
  cruiseLine: string | undefined,
): Promise<{ id: number | null; line: string | undefined }> {
  if (!shipName) return { id: null, line: cruiseLine };

  const candidates = await loadShipCandidates();

  let best: { score: number; ship: ShipCandidate | null } = { score: 0, ship: null };
  for (const ship of candidates) {
    let score = similarity(shipName, ship.name);
    // Boost when the cruise line matches the LLM output — disambiguates ships
    // with identical names across operators (rare but real, e.g. "Spirit").
    if (cruiseLine && similarity(cruiseLine, ship.cruiseLine) >= 60) score += 5;
    if (score > best.score) best = { score, ship };
  }

  if (best.ship && best.score >= 60) {
    return { id: best.ship.id, line: best.ship.cruiseLine };
  }
  logger.info(
    { shipName, cruiseLine, bestScore: best.score },
    "[Cruise Resolver] No matching ship in DB — preserving free-text via shipNameOverride",
  );
  return { id: null, line: cruiseLine };
}

async function loadPortCandidates(): Promise<PortCandidate[]> {
  if (cachedPorts) return cachedPorts;
  cachedPorts = await prisma.port.findMany({
    select: { id: true, name: true, city: true, country: true },
  });
  return cachedPorts;
}

/** Best name score for one needle against one candidate string (exact/
 *  startsWith/contains via `similarity`, then the fuzzy fallback). */
function nameScore(needle: string, candidate: string): number {
  return Math.max(similarity(needle, candidate), fuzzyNameScore(needle, candidate));
}

function findBestPort(
  needle: { name?: string; city?: string; country?: string },
  candidates: PortCandidate[],
): PortCandidate | null {
  if (!needle.name && !needle.city) return null;

  // Pre-strip "X (Y)" → use X as primary needle, Y as country/region hint.
  const [bareName, parenHint] = needle.name ? splitParenSuffix(needle.name) : [undefined, undefined];
  const country = needle.country ?? parenHint;

  // Expand German exonyms / local endonyms to their English catalog names
  // ("Lissabon"/"Lisboa" → "Lisbon", "Singapur" → "Singapore"). Booking
  // confirmations are German/local, the catalog is English — without this
  // every exonym port falls through to "unmatched" on import.
  const nameNeedles = bareName ? [bareName, ...expandPortSearchTerms(bareName)] : [];
  const cityNeedles = needle.city ? [needle.city, ...expandPortSearchTerms(needle.city)] : [];

  let best: { score: number; port: PortCandidate | null } = { score: 0, port: null };
  for (const port of candidates) {
    let score = 0;
    for (const nn of nameNeedles) {
      score = Math.max(score, nameScore(nn, port.name));
      if (port.city) score = Math.max(score, nameScore(nn, port.city));
    }
    for (const cn of cityNeedles) {
      if (port.city) score = Math.max(score, nameScore(cn, port.city));
    }
    // Country / region acts as a tiebreaker. Use either the explicit country
    // field or the paren-hint pulled from "Sydney (Neuschottland)".
    if (country && port.country && similarity(country, port.country) >= 60) {
      score += 5;
    }
    if (score > best.score) best = { score, port };
  }

  return best.score >= 60 ? best.port : null;
}

/**
 * Convert a parsed cruise from the LLM into a CruiseInput shape that the
 * `/api/v1/cruises` POST endpoint accepts. Unmatched ports become unresolved
 * stops (portId=null, isAtSea=false, unresolvedPortName set) so the name is
 * never lost and the user can pick the catalog port later in the UI.
 */
export async function resolveCruiseEntities(
  parsed: ParsedCruise,
): Promise<ResolvedCruise> {
  const ship = await resolveShip(parsed.shipName, parsed.cruiseLine);
  const ports = await loadPortCandidates();
  const unmatched: { dayNumber: number; portName: string }[] = [];

  // Resolve departure / arrival overview ports — only used when the user gave
  // explicit "Abfahrt: <port>" / "Ankunft: <port>" in addition to the stops.
  const departurePort = parsed.departurePortName
    ? findBestPort({ name: parsed.departurePortName }, ports)
    : null;
  const arrivalPort = parsed.arrivalPortName
    ? findBestPort({ name: parsed.arrivalPortName }, ports)
    : null;

  const stops = parsed.stops.map((stop, index) => mapStop(stop, index, ports, unmatched));

  const input: CruiseInput = {
    shipId: ship.id ?? undefined,
    shipNameOverride: ship.id ? undefined : parsed.shipName,
    cruiseLine: ship.line,
    routeName: parsed.routeName,
    departurePortId: departurePort?.id ?? undefined,
    arrivalPortId: arrivalPort?.id ?? undefined,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    status: "scheduled",
    cabinNumber: parsed.cabinNumber,
    cabinType: parsed.cabinType,
    deck: parsed.deck,
    bookingReference: parsed.bookingReference,
    price: parsed.price,
    currency: parsed.currency,
    stops,
  };

  return {
    input,
    shipMatched: ship.id !== null,
    unmatchedPorts: unmatched,
    flights: parsed.flights ?? [],
  };
}

function mapStop(
  stop: ParsedCruiseStop,
  index: number,
  ports: PortCandidate[],
  unmatched: { dayNumber: number; portName: string }[],
): NonNullable<CruiseInput["stops"]>[number] {
  if (stop.isAtSea) {
    return {
      portId: null,
      dayNumber: index + 1,
      date: stop.date,
      isAtSea: true,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      excursionNote: stop.excursionNote,
    };
  }

  const match = findBestPort(
    { name: stop.portName, city: stop.city, country: stop.country },
    ports,
  );
  if (!match && stop.portName) {
    unmatched.push({ dayNumber: index + 1, portName: stop.portName });
  }

  // Unmatched named ports become a first-class unresolved stop: the name is
  // preserved in its own field, the stop stays a port (not a sea day), and the
  // user can resolve it to a catalog port later. The excursion note stays clean.
  const hasName = Boolean(stop.portName);
  return {
    portId: match?.id ?? null,
    dayNumber: index + 1,
    date: stop.date,
    // A non-sea stop with neither a matched port nor a name has nothing to
    // preserve — degrade it to a sea day so it stays Zod-valid (the unresolved
    // state requires a name).
    isAtSea: !match && !hasName,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    excursionNote: stop.excursionNote,
    unresolvedPortName: match ? undefined : (stop.portName ?? undefined),
  };
}

/**
 * A resolved cruise enriched with the full Ship / Port rows for every matched
 * id. The import preview uses these to DISPLAY and let the user edit the
 * matched ship and ports inline — `input` itself stays IDs-only (that's what
 * gets POSTed). `stopPorts` is keyed by `dayNumber`.
 */
/** A bundled flight with its dep/arr airports pre-filled (home airport on the
 *  home side, nearest airport to the embarkation/disembarkation port on the
 *  cruise side). All editable on the frontend. */
export interface HydratedFlight {
  flightNumber?: string;
  airline?: string;
  direction?: "outbound" | "return";
  date?: string;
  cabinClass?: ParsedFlight["cabinClass"];
  departureAirport: AirportData | null;
  arrivalAirport: AirportData | null;
}

export interface HydratedParsedCruise extends Omit<ResolvedCruise, "flights"> {
  ship: Ship | null;
  departurePort: Port | null;
  arrivalPort: Port | null;
  stopPorts: Record<number, Port>;
  flights: HydratedFlight[];
}

// Cruise ports are often well outside a 5km airport radius (e.g. Kiel -> HAM
// ~90km), so use a generous search radius for the fly & cruise pre-fill.
const PORT_AIRPORT_RADIUS_KM = 250;

async function getHomeAirport(userId: string | undefined): Promise<AirportData | null> {
  if (!userId) return null;
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const history = normalizeHistory(
    (settings?.data as { homeAirportHistory?: unknown } | null)?.homeAirportHistory,
  );
  const iata = getCurrentHomeAirport(history);
  if (!iata) return null;
  return prisma.airport.findFirst({ where: { iata, isClosed: false } });
}

/**
 * Batch-hydrate a list of resolved cruises: collect every matched ship/port id
 * across all entries, fetch the full rows in two queries, and attach them so
 * the frontend can seed its pickers without a get-by-id endpoint (which the
 * search-only /ships and /ports routes don't offer).
 */
export async function hydrateResolvedCruises(
  resolved: ResolvedCruise[],
  userId: string | undefined,
): Promise<HydratedParsedCruise[]> {
  const homeAirport = await getHomeAirport(userId);
  const shipIds = new Set<number>();
  const portIds = new Set<number>();
  for (const r of resolved) {
    if (r.input.shipId != null) shipIds.add(r.input.shipId);
    if (r.input.departurePortId != null) portIds.add(r.input.departurePortId);
    if (r.input.arrivalPortId != null) portIds.add(r.input.arrivalPortId);
    for (const s of r.input.stops ?? []) {
      if (s.portId != null) portIds.add(s.portId);
    }
  }

  const [ships, ports] = await Promise.all([
    shipIds.size > 0
      ? prisma.ship.findMany({ where: { id: { in: [...shipIds] } } })
      : Promise.resolve([] as Ship[]),
    portIds.size > 0
      ? prisma.port.findMany({ where: { id: { in: [...portIds] } } })
      : Promise.resolve([] as Port[]),
  ]);
  const shipMap = new Map(ships.map((s) => [s.id, s]));
  const portMap = new Map(ports.map((p) => [p.id, p]));

  return Promise.all(
    resolved.map(async (r): Promise<HydratedParsedCruise> => {
      const stopPorts: Record<number, Port> = {};
      for (const s of r.input.stops ?? []) {
        if (s.portId != null) {
          const port = portMap.get(s.portId);
          if (port) stopPorts[s.dayNumber] = port;
        }
      }

      const ship = r.input.shipId != null ? shipMap.get(r.input.shipId) ?? null : null;
      const departurePort =
        r.input.departurePortId != null ? portMap.get(r.input.departurePortId) ?? null : null;
      const arrivalPort =
        r.input.arrivalPortId != null ? portMap.get(r.input.arrivalPortId) ?? null : null;

      const flights = r.flights.length
        ? await hydrateFlights(r, stopPorts, departurePort, arrivalPort, homeAirport)
        : [];

      return { ...r, ship, departurePort, arrivalPort, stopPorts, flights };
    }),
  );
}

/**
 * Pre-fill each flight's dep/arr airports: home airport on the home side,
 * nearest airport to the embarkation/disembarkation port on the cruise side.
 * Outbound = home -> embarkation; return = disembarkation -> home. The user
 * can change any of them in the import editor.
 */
async function hydrateFlights(
  r: ResolvedCruise,
  stopPorts: Record<number, Port>,
  departurePort: Port | null,
  arrivalPort: Port | null,
  homeAirport: AirportData | null,
): Promise<HydratedFlight[]> {
  const portStops = (r.input.stops ?? [])
    .filter((s) => !s.isAtSea && s.portId != null)
    .sort((a, b) => a.dayNumber - b.dayNumber);
  const embarkPort =
    departurePort ?? (portStops[0] ? stopPorts[portStops[0].dayNumber] ?? null : null);
  const disembarkPort =
    arrivalPort ??
    (portStops.length ? stopPorts[portStops[portStops.length - 1].dayNumber] ?? null : null);

  const [embarkAirport, disembarkAirport] = await Promise.all([
    embarkPort ? findNearestAirport(embarkPort.lat, embarkPort.lon, PORT_AIRPORT_RADIUS_KM) : null,
    disembarkPort
      ? findNearestAirport(disembarkPort.lat, disembarkPort.lon, PORT_AIRPORT_RADIUS_KM)
      : null,
  ]);

  return r.flights.map((f) => {
    const isReturn = f.direction === "return";
    return {
      flightNumber: f.flightNumber,
      airline: f.airline,
      direction: f.direction,
      date: f.date,
      cabinClass: f.cabinClass,
      departureAirport: isReturn ? disembarkAirport : homeAirport,
      arrivalAirport: isReturn ? homeAirport : embarkAirport,
    };
  });
}
