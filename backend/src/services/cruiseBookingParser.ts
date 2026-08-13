import http from "http";
import https from "https";
import { type CurrencyCode, isCurrencyCode } from "../shared/currencies";
import logger from "../utils/logger";
import { getAdminParserSettings } from "./parserSettings";

const CRUISE_CABIN_TYPES = ["inside", "oceanview", "balcony", "suite"] as const;

export type CruiseCabinType = (typeof CRUISE_CABIN_TYPES)[number];
export type CruiseCurrency = CurrencyCode;

export interface ParsedCruiseStop {
  portName?: string;
  city?: string;
  country?: string;
  dayNumber: number;
  /** Calendar date of the stop ("YYYY-MM-DD"). Booking confirmations list a
   *  date per stop, often without clock times — this captures it regardless. */
  date?: string;
  isAtSea: boolean;
  arrivalTime?: string;
  departureTime?: string;
  excursionNote?: string;
}

const FLIGHT_CABINS = ["economy", "premium_economy", "business", "first"] as const;
export type FlightCabinClass = (typeof FLIGHT_CABINS)[number];

/** A flight mentioned inside a fly & cruise booking. Tentative by nature —
 *  exact times/airports are usually released only ~4 months before departure,
 *  so most fields are optional. */
export interface ParsedFlight {
  flightNumber?: string;
  airline?: string;
  /** "outbound" = the flight to the cruise (before embarkation); "return" =
   *  the flight home (after disembarkation). */
  direction?: "outbound" | "return";
  date?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  cabinClass?: FlightCabinClass;
}

export interface ParsedCruise {
  shipName?: string;
  cruiseLine?: string;
  /** Official itinerary / route name from the confirmation, e.g.
   *  "Kanaren mit Marokko". Distinct from the trip's user-defined label. */
  routeName?: string;
  startDate?: string;
  endDate?: string;
  departurePortName?: string;
  arrivalPortName?: string;
  cabinNumber?: string;
  cabinType?: CruiseCabinType;
  deck?: number;
  bookingReference?: string;
  price?: number;
  currency?: CruiseCurrency;
  stops: ParsedCruiseStop[];
  /** Flights bundled with the cruise (fly & cruise). Empty when none. */
  flights: ParsedFlight[];
  parserTemplate: string;
  parserConfidence: number;
  missing: string[];
}

export interface CruiseParseResult {
  cruises: ParsedCruise[];
  parserUsed: "ollama";
  ollamaAvailable: boolean;
}

const SYSTEM_PROMPT = `You extract structured data from German cruise booking confirmations (TUI "Mein Schiff", AIDA, and similar).

Return ONLY this JSON, with no prose before or after: {"cruises":[ CRUISE ]}.
There is almost always exactly ONE cruise — return a single-element array. Return more than one cruise ONLY if the document clearly lists separate voyages, each with its own date range.

Copy every value VERBATIM from the document. If a value is not in the text, use null. NEVER output placeholder strings like "Ship Name", "Port", "Cabin Number", "string".

A CRUISE object has these fields:
- shipName: e.g. "Mein Schiff 1", "AIDAcosma".
- cruiseLine: e.g. "TUI Cruises", "AIDA Cruises".
- routeName: the itinerary/route name as printed, e.g. "Kanaren mit Marokko", "Mittelmeer Klassik", "Metropolen ab Hamburg". null if none is given.
- startDate, endDate: ISO "YYYY-MM-DD". German "08.10.2027" -> "2027-10-08". A range like "Ihr Reisedatum: 08.10. - 29.10.2027" means startDate "2027-10-08", endDate "2027-10-29".
- bookingReference: found near "Vorgang-Nr.", "Buchungsnummer", "Reservierung"; drop any "/x" suffix ("4507252/4" -> "4507252").
- cabinNumber, deck (a number), cabinType: map "Innen"/"Innenkabine" -> "inside"; "Außen"/"Meerblick" -> "oceanview"; "Balkon"/"Veranda" -> "balcony"; "Suite"/"Junior Suite" -> "suite".
- price: the total cruise price as a number. If only a per-person price is shown ("pro Person") for 2 travellers, multiply by 2.
- currency: 3-letter ISO code; "€" -> "EUR".
- stops: the itinerary IN ORDER, one object per day. Each stop is {"portName","date","isAtSea","arrivalTime","departureTime"}. A real port ("Bayonne","Halifax","Funchal","Miami") has isAtSea=false and portName set to the place name. A day labelled "Seetag" / "Auf See" / "Erholung auf See" / "Sea Day" has isAtSea=true and portName=null. date is the stop's calendar date as ISO "YYYY-MM-DD" (German "10.10.2027" -> "2027-10-10"); ALWAYS fill it from the itinerary (e.g. "08.10.2027 Bayonne - 09.10.2027 Seetag" -> first stop date "2027-10-08", second "2027-10-09"), even when no clock times are given. arrivalTime/departureTime are ISO "YYYY-MM-DDTHH:mm" or null.
- flights: bundled fly & cruise flights, otherwise []. Each flight is {"flightNumber" (no spaces, "LH 2080" -> "LH2080"),"airline","direction" ("outbound" = to the cruise before embarkation, "return" = home after disembarkation),"date","departureAirport","arrivalAirport","cabinClass" ("economy"|"premium_economy"|"business"|"first")}.

EXAMPLE OUTPUT:
{"cruises":[{"shipName":"Mein Schiff 4","cruiseLine":"TUI Cruises","routeName":"Norwegen mit Lofoten","startDate":"2025-11-19","endDate":"2025-12-03","cabinNumber":"7102","cabinType":"inside","deck":7,"bookingReference":"1234567","price":2498.00,"currency":"EUR","stops":[{"portName":"Hamburg","date":"2025-11-19","isAtSea":false,"departureTime":"2025-11-19T18:00"},{"portName":null,"date":"2025-11-20","isAtSea":true},{"portName":"Bergen","date":"2025-11-21","isAtSea":false,"arrivalTime":"2025-11-21T08:00","departureTime":"2025-11-21T17:00"}],"flights":[]}]}`;

// We tried Ollama's structured-output mode (`format: <jsonSchema>`, Ollama 0.5+)
// but with both gemma3:12b and qwen3:30b it forced the models to fill in
// required fields with placeholder strings ("Port Name", "N/A") rather than
// emitting null when a value wasn't in the source. The current loose
// `format: "json"` plus a one-shot example in the system prompt extracts real
// values reliably. The schema is kept here as a comment for future
// revisitation if we want stricter enforcement.

const OLLAMA_GENERATE_TIMEOUT_MS = 300_000;

function fetchJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search ?? ""),
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
    });
    req.setTimeout(OLLAMA_GENERATE_TIMEOUT_MS, () =>
      req.destroy(new Error(`Ollama request timeout after ${OLLAMA_GENERATE_TIMEOUT_MS}ms`)),
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function fetchGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "GET",
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.setTimeout(5_000, () => req.destroy(new Error("Ollama availability check timeout")));
    req.on("error", reject);
    req.end();
  });
}

function isCabinType(value: unknown): value is CruiseCabinType {
  return typeof value === "string" && (CRUISE_CABIN_TYPES as readonly string[]).includes(value);
}

function isCurrency(value: unknown): value is CruiseCurrency {
  return isCurrencyCode(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") return true;
    if (lower === "false" || lower === "no" || lower === "0") return false;
  }
  return fallback;
}

interface RawCruiseStop {
  portName?: unknown;
  city?: unknown;
  country?: unknown;
  dayNumber?: unknown;
  date?: unknown;
  isAtSea?: unknown;
  arrivalTime?: unknown;
  departureTime?: unknown;
  excursionNote?: unknown;
}

interface RawCruiseFlight {
  flightNumber?: unknown;
  airline?: unknown;
  direction?: unknown;
  date?: unknown;
  departureAirport?: unknown;
  arrivalAirport?: unknown;
  cabinClass?: unknown;
}

interface RawCruise {
  shipName?: unknown;
  cruiseLine?: unknown;
  routeName?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  departurePortName?: unknown;
  arrivalPortName?: unknown;
  cabinNumber?: unknown;
  cabinType?: unknown;
  deck?: unknown;
  bookingReference?: unknown;
  price?: unknown;
  currency?: unknown;
  stops?: unknown;
  flights?: unknown;
}

function isFlightCabin(v: unknown): v is FlightCabinClass {
  return typeof v === "string" && (FLIGHT_CABINS as readonly string[]).includes(v);
}

function normalizeFlight(raw: RawCruiseFlight): ParsedFlight | null {
  const flightNumber = asString(raw.flightNumber);
  const airline = asString(raw.airline);
  // Drop pure noise: a "flight" with neither a number nor an airline is unusable.
  if (!flightNumber && !airline) return null;
  const dir = asString(raw.direction);
  const direction = dir === "return" ? "return" : dir === "outbound" ? "outbound" : undefined;
  return {
    // "LH 2080" -> "LH2080" to match the flight-number lookup format.
    flightNumber: flightNumber ? flightNumber.replace(/\s+/g, "") : undefined,
    airline,
    direction,
    date: asString(raw.date),
    departureAirport: asString(raw.departureAirport),
    arrivalAirport: asString(raw.arrivalAirport),
    cabinClass: isFlightCabin(raw.cabinClass) ? raw.cabinClass : undefined,
  };
}

/**
 * Normalize a date-ish string to ISO "YYYY-MM-DD". Accepts the model's ISO
 * output as-is and converts a German "DD.MM.YYYY" fallback, so a date leaking
 * through in the source format still reaches the DB correctly.
 */
function normalizeDateString(value: unknown): string | undefined {
  const s = asString(value);
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return s;
}

function normalizeStop(raw: RawCruiseStop, index: number): ParsedCruiseStop {
  const isAtSea = asBoolean(raw.isAtSea);
  const dayNumber = asNumber(raw.dayNumber);
  return {
    portName: isAtSea ? undefined : asString(raw.portName),
    city: asString(raw.city),
    country: asString(raw.country),
    dayNumber: dayNumber !== undefined && dayNumber > 0 ? Math.floor(dayNumber) : index + 1,
    date: normalizeDateString(raw.date),
    isAtSea,
    arrivalTime: asString(raw.arrivalTime),
    departureTime: asString(raw.departureTime),
    excursionNote: asString(raw.excursionNote),
  };
}

function normalizeCruise(raw: RawCruise): ParsedCruise {
  const stopsArray = Array.isArray(raw.stops) ? (raw.stops as unknown[]) : [];
  const stops = stopsArray.map((entry, index) =>
    normalizeStop((entry ?? {}) as RawCruiseStop, index),
  );

  // Re-sequence dayNumber so it is monotonically increasing 1..N regardless of
  // what the LLM produced. Keeps the cruise stop editor invariant happy.
  stops.sort((a, b) => a.dayNumber - b.dayNumber);
  for (let i = 0; i < stops.length; i++) stops[i] = { ...stops[i], dayNumber: i + 1 };

  const flightsArray = Array.isArray(raw.flights) ? (raw.flights as unknown[]) : [];
  const flights = flightsArray
    .map((entry) => normalizeFlight((entry ?? {}) as RawCruiseFlight))
    .filter((f): f is ParsedFlight => f !== null);

  const cruise: ParsedCruise = {
    shipName: asString(raw.shipName),
    cruiseLine: asString(raw.cruiseLine),
    routeName: asString(raw.routeName),
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    departurePortName: asString(raw.departurePortName),
    arrivalPortName: asString(raw.arrivalPortName),
    cabinNumber: asString(raw.cabinNumber),
    cabinType: isCabinType(raw.cabinType) ? raw.cabinType : undefined,
    deck: (() => {
      const n = asNumber(raw.deck);
      return n !== undefined && n > 0 ? Math.floor(n) : undefined;
    })(),
    bookingReference: asString(raw.bookingReference),
    price: asNumber(raw.price),
    currency: isCurrency(raw.currency) ? raw.currency : undefined,
    stops,
    flights,
    parserTemplate: "ollama-cruise",
    parserConfidence: 80,
    missing: [],
  };

  // Populate `missing` with the critical fields a useful cruise needs.
  const critical = ["shipName", "startDate", "endDate"] as const;
  for (const field of critical) {
    if (!cruise[field]) cruise.missing.push(field);
  }
  if (cruise.stops.length === 0) cruise.missing.push("stops");

  return cruise;
}

export interface CruiseBookingParserOptions {
  url?: string;
  model?: string;
}

export class CruiseBookingParser {
  private readonly url: string;
  private readonly model: string;

  constructor(options: CruiseBookingParserOptions = {}) {
    this.url = options.url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? "gemma3:12b";
  }

  /** The resolved Ollama base URL this parser will talk to (for diagnostics). */
  get endpoint(): string {
    return this.url;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const res = await fetchGet(`${this.url}/api/tags`);
      const parsed: unknown = JSON.parse(res);
      return typeof parsed === "object" && parsed !== null && "models" in parsed;
    } catch {
      return false;
    }
  }

  async parseText(text: string): Promise<ParsedCruise[]> {
    // Cruise PDFs can be 5+ pages with full itineraries. Use a generous slice
    // but cap to keep token cost predictable on gemma3:12b.
    const snippet = text.slice(0, 12_000);
    // `format: "json"` constrains gemma3:12b to emit valid JSON. Without it,
    // the model regularly ignores the "JSON only" instruction in the system
    // prompt and falls back to a markdown breakdown of the booking. We accept
    // either a top-level array or a single object/wrapper and unwrap below.
    const body = JSON.stringify({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: `Extract every cruise from this booking confirmation text. Output JSON in the shape shown in the EXAMPLE OUTPUT block in the system prompt — a top-level object with a "cruises" array. If you cannot find a value, use null. Do NOT emit placeholder strings.\n\nDOCUMENT:\n${snippet}`,
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_ctx: 8192 },
    });

    logger.info(
      { model: this.model, url: this.url, chars: snippet.length },
      "[Cruise Parser] Sending text to Ollama",
    );

    const raw = await fetchJson(`${this.url}/api/generate`, body);
    const response: unknown = JSON.parse(raw);
    if (typeof response !== "object" || response === null || !("response" in response)) {
      throw new Error("Invalid Ollama response structure");
    }
    const responseText = (response as Record<string, unknown>).response;
    if (typeof responseText !== "string") {
      throw new Error("Ollama response.response is not a string");
    }

    const cleaned = responseText
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
      .trim();

    let parsed: unknown;
    // With `format: "json"` Ollama emits valid JSON top-level — usually an
    // array, sometimes an object that wraps the array under a key like
    // "cruises" / "data" / "result". Try a strict parse first, fall back to
    // bracket-extraction so we still cope with older Ollama versions or models
    // that ignore the format flag.
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        const preview = responseText.slice(0, 500).replace(/\s+/g, " ");
        logger.warn(
          { model: this.model, responsePreview: preview },
          "[Cruise Parser] No JSON array found in Ollama response",
        );
        throw new Error("No JSON array found in Ollama response");
      }
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch (err) {
        const preview = arrayMatch[0].slice(0, 500).replace(/\s+/g, " ");
        logger.warn(
          {
            model: this.model,
            matchPreview: preview,
            error: err instanceof Error ? err.message : String(err),
          },
          "[Cruise Parser] JSON.parse failed on matched array",
        );
        throw new Error("Ollama response JSON parse failed");
      }
    }

    const cruises = unwrapCruiseArray(parsed);
    if (!Array.isArray(cruises)) {
      const preview = JSON.stringify(parsed).slice(0, 300);
      logger.warn(
        { model: this.model, preview },
        "[Cruise Parser] Parsed JSON did not yield a cruise array",
      );
      throw new Error("Ollama response did not contain a cruise array");
    }

    const normalized = cruises.map((entry) => normalizeCruise((entry ?? {}) as RawCruise));
    logger.info({ count: normalized.length }, "[Cruise Parser] Extracted cruises");
    return normalized;
  }
}

/**
 * `format: "json"` makes gemma3 reliably emit JSON, but it can be either a
 * top-level array or a wrapper object like `{ cruises: [...] }`. Unwrap both.
 * Also tolerates a single-cruise object by lifting it into a length-1 array.
 */
function unwrapCruiseArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["cruises", "data", "result", "results", "items", "bookings"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  // Heuristic: if the object itself looks like a single cruise (has shipName
  // or stops or startDate), treat it as one entry.
  if ("shipName" in obj || "stops" in obj || "startDate" in obj) return [obj];
  return null;
}

let cachedParser: CruiseBookingParser | undefined;

export function getCruiseBookingParser(options?: CruiseBookingParserOptions): CruiseBookingParser {
  if (!cachedParser || options) cachedParser = new CruiseBookingParser(options);
  return cachedParser;
}

export async function parseCruiseBookingText(
  text: string,
  options?: CruiseBookingParserOptions,
): Promise<CruiseParseResult> {
  // Resolve the Ollama endpoint from admin settings first, mirroring the flight
  // text parser (services/parsers/config.ts). The Settings "Test" button reads
  // the same admin-configured URL, so the cruise parser MUST consult it too —
  // otherwise a correctly configured remote Ollama is silently ignored and every
  // cruise parse falls back to localhost:11434 → ECONNREFUSED. Explicit options
  // (used by tests) still win; env vars remain the final fallback.
  const resolved = await resolveCruiseParserOptions(options);
  const parser = getCruiseBookingParser(resolved);
  const ollamaAvailable = await parser.checkAvailability();
  if (!ollamaAvailable) {
    throw new Error(
      `Ollama is not reachable at ${parser.endpoint} — cannot parse cruise booking. ` +
        `Check the parser configuration in Settings (Ollama URL / model).`,
    );
  }
  const cruises = await parser.parseText(text);
  return { cruises, parserUsed: "ollama", ollamaAvailable: true };
}

/**
 * Merge explicit options over admin-configured settings over env/defaults.
 * Returns undefined when nothing is configured so the constructor applies its
 * own env/localhost fallback unchanged.
 */
async function resolveCruiseParserOptions(
  options?: CruiseBookingParserOptions,
): Promise<CruiseBookingParserOptions | undefined> {
  if (options?.url && options?.model) return options;
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  try {
    const admin = await getAdminParserSettings();
    adminUrl = admin?.ollamaUrl ?? undefined;
    adminModel = admin?.ollamaModel ?? undefined;
  } catch (err) {
    logger.warn({ err }, "[Cruise Parser] Failed to load admin parser settings");
  }
  return {
    url: options?.url ?? adminUrl ?? process.env.OLLAMA_URL ?? undefined,
    model: options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? undefined,
  };
}
