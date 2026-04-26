import { prisma } from "../db";
import logger from "../utils/logger";
import type { CruiseInput } from "../schemas/cruise";
import type { ParsedCruise, ParsedCruiseStop } from "./cruiseBookingParser";

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

async function resolveShip(
  shipName: string | undefined,
  cruiseLine: string | undefined,
): Promise<{ id: number | null; line: string | undefined }> {
  if (!shipName) return { id: null, line: cruiseLine };

  const candidates: ShipCandidate[] = await prisma.ship.findMany({
    select: { id: true, name: true, cruiseLine: true },
  });

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
  return prisma.port.findMany({
    select: { id: true, name: true, city: true, country: true },
  });
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

  return { input, shipMatched: ship.id !== null, unmatchedPorts: unmatched };
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
