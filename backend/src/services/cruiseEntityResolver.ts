import type { Port, Ship } from "@prisma/client";
import { prisma } from "../db";
import logger from "../utils/logger";
import type { CruiseInput } from "../schemas/cruise";
import type { ParsedCruise, ParsedCruiseStop, ParsedFlight } from "./cruiseBookingParser";
import { findNearestAirport, type AirportData } from "./airportLookup";
import { getCurrentHomeAirport, normalizeHistory } from "../utils/homeAirport";

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
  if (c.startsWith(n) || n.startsWith(c)) return 80;
  if (c.includes(n) || n.includes(c)) return 60;
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

function findBestPort(
  needle: { name?: string; city?: string; country?: string },
  candidates: PortCandidate[],
): PortCandidate | null {
  if (!needle.name && !needle.city) return null;

  // Pre-strip "X (Y)" → use X as primary needle, Y as country/region hint.
  const [bareName, parenHint] = needle.name ? splitParenSuffix(needle.name) : [undefined, undefined];
  const country = needle.country ?? parenHint;

  let best: { score: number; port: PortCandidate | null } = { score: 0, port: null };
  for (const port of candidates) {
    let score = 0;
    if (bareName) {
      score = Math.max(score, similarity(bareName, port.name));
      if (port.city) score = Math.max(score, similarity(bareName, port.city));
    }
    if (needle.city && port.city) {
      score = Math.max(score, similarity(needle.city, port.city));
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
 * `/api/v1/cruises` POST endpoint accepts. Unmatched ports are turned into
 * stops with `portId=null` + a stub excursionNote so the user sees them and
 * can pick the right port manually in the UI.
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

  // Tag unmatched ports in the excursionNote so the user can spot them in
  // the editor; an unresolved port + isAtSea=false would otherwise fail Zod
  // validation (the union demands one or the other).
  const excursion = match
    ? stop.excursionNote
    : [stop.excursionNote, stop.portName ? `[unmatched: ${stop.portName}]` : null]
        .filter(Boolean)
        .join(" ") || undefined;

  return {
    portId: match?.id ?? null,
    dayNumber: index + 1,
    // Force isAtSea=true when the port could not be resolved to keep the Zod
    // refinement happy. The user can correct this in the UI by picking a port.
    isAtSea: !match,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    excursionNote: excursion,
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
