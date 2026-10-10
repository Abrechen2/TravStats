import { type CurrencyCode, isCurrencyCode } from "../shared/currencies";
import { parseLocal } from "../shared/time/instant";
import { llmParseTimeoutMs } from "./http/llmTimeout";
import logger from "../utils/logger";
import { getParserOrder } from "./parserSettings";
import { llmRefusalFor } from "./llm/llmGate";
import {
  describeLlmTarget,
  llmGenerate,
  llmProbe,
  llmProviderLabel,
  ollamaTarget,
  type LlmTarget,
} from "./llm/llmProvider";
import { readWithV2CruiseTemplates } from "./cruise/v2Cruise";
import { templateRegistry } from "./parsers/templates/registry";
import type { TemplateEnvelope } from "./parsers/templates/v2/envelope";
import { loadActiveWorkshopTemplates } from "./parsers/userTemplates/v2UserTemplates";
import { isLlmAvailable, recordLlmProbe } from "./parsers/llmAvailability";
import { resolveReachableLlmTarget } from "./llm/reachableTarget";

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
  /**
   * Which path produced the cruises. `template` means a deterministic reader
   * recognised the issuer and no model was consulted at all — that path is
   * tried first, so an instance without Ollama can still import the formats it
   * covers.
   */
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  /**
   * Why nothing was read, when `parserUsed` is "none". Same shape the lodging
   * parser answers with, and for the same reason: an unreadable document is
   * not a server fault. Until 2026-09-17 this path THREW, and the route turned
   * that into a 503 — so a cruise line no template covers, on an instance with
   * no model, met an error page where a hotel in the same position offered
   * manual entry.
   */
  fallbackReason?: string;
}

// Exported for the prompt-contract tests — extraction truthfulness rules
// (verbatim flight numbers, booking grand total) are pinned there.
export const CRUISE_SYSTEM_PROMPT = `You extract structured data from German cruise booking confirmations (TUI "Mein Schiff", AIDA, and similar).

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
- price: the grand total actually charged for the WHOLE booking, all guests together, after discounts — prefer an explicit total line ("Insgesamt", "Gesamtpreis", "Total", a payment-plan total). NEVER a per-person or per-guest amount and never a pre-discount subtotal. Only if the document shows nothing but a per-person price ("pro Person") for N travellers, multiply by N.
- currency: 3-letter ISO code; "€" -> "EUR".
- stops: the itinerary IN ORDER, one object per day. Each stop is {"portName","date","isAtSea","arrivalTime","departureTime"}. A real port ("Bayonne","Halifax","Funchal","Miami") has isAtSea=false and portName set to the place name. A day labelled "Seetag" / "Auf See" / "Erholung auf See" / "Sea Day" has isAtSea=true and portName=null. date is the stop's calendar date as ISO "YYYY-MM-DD" (German "10.10.2027" -> "2027-10-10"); ALWAYS fill it from the itinerary (e.g. "08.10.2027 Bayonne - 09.10.2027 Seetag" -> first stop date "2027-10-08", second "2027-10-09"), even when no clock times are given. arrivalTime/departureTime are ISO "YYYY-MM-DDTHH:mm" or null.
- flights: bundled fly & cruise flights, otherwise []. Each flight is {"flightNumber","airline","direction" ("outbound" = to the cruise before embarkation, "return" = home after disembarkation),"date","departureAirport","arrivalAirport","cabinClass" ("economy"|"premium_economy"|"business"|"first")}. flightNumber only when it appears verbatim in the document (write it without spaces); many confirmations list flights WITHOUT numbers — then use null, NEVER invent one.

EXAMPLE OUTPUT:
{"cruises":[{"shipName":"Mein Schiff 4","cruiseLine":"TUI Cruises","routeName":"Norwegen mit Lofoten","startDate":"2025-11-19","endDate":"2025-12-03","cabinNumber":"7102","cabinType":"inside","deck":7,"bookingReference":"1234567","price":2498.00,"currency":"EUR","stops":[{"portName":"Hamburg","date":"2025-11-19","isAtSea":false,"departureTime":"2025-11-19T18:00"},{"portName":null,"date":"2025-11-20","isAtSea":true},{"portName":"Bergen","date":"2025-11-21","isAtSea":false,"arrivalTime":"2025-11-21T08:00","departureTime":"2025-11-21T17:00"}],"flights":[]}]}`;

// We tried Ollama's structured-output mode (`format: <jsonSchema>`, Ollama 0.5+)
// but with both gemma3:12b and qwen3:30b it forced the models to fill in
// required fields with placeholder strings ("Port Name", "N/A") rather than
// emitting null when a value wasn't in the source. The current loose
// `format: "json"` plus a one-shot example in the system prompt extracts real
// values reliably. The schema is kept here as a comment for future
// revisitation if we want stricter enforcement.

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
    const cleaned = value
      .replace(/[^\d.,-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
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

function normalizeFlight(raw: RawCruiseFlight, sourceText: string): ParsedFlight | null {
  let flightNumber = asString(raw.flightNumber);
  // A flight number the DOCUMENT never states is an invention, however
  // plausible it looks — the HX Antarctica booking (2026-08-21) came back
  // with "LH2080" bled through from this prompt's own former format example.
  // Verbatim-check against the whitespace-stripped source; the flight itself
  // (airports, date, direction) may still be real and is kept.
  if (flightNumber) {
    const needle = flightNumber.replace(/\s+/g, "").toUpperCase();
    const haystack = sourceText.replace(/\s+/g, "").toUpperCase();
    if (!haystack.includes(needle)) flightNumber = undefined;
  }
  const airline = asString(raw.airline);
  const departureAirport = asString(raw.departureAirport);
  const arrivalAirport = asString(raw.arrivalAirport);
  // Drop pure noise: with neither a (verified) number nor an airline nor any
  // airport, nothing about this "flight" is verifiable.
  if (!flightNumber && !airline && !departureAirport && !arrivalAirport) return null;
  const dir = asString(raw.direction);
  const direction = dir === "return" ? "return" : dir === "outbound" ? "outbound" : undefined;
  return {
    // "LH 2080" -> "LH2080" to match the flight-number lookup format.
    flightNumber: flightNumber ? flightNumber.replace(/\s+/g, "") : undefined,
    airline,
    direction,
    date: asString(raw.date),
    departureAirport,
    arrivalAirport,
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

const PORT_CLOCK = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/;

/**
 * A port call's clock as the booking shows it, converted at the parser
 * boundary (ADR 0002 D6): `YYYY-MM-DDTHH:mm`, the PORT's wall clock — the one
 * shape the cruise write path reads on the port's zone. The model is asked for
 * exactly that, and sometimes answers with a space, a one-digit hour, seconds
 * or a `Z`/offset tacked on; the digits are what the confirmation printed, so
 * they are kept and the rest dropped — an appended `Z` read as an instant
 * would move every call by the port's offset. Anything that is not a real
 * wall clock (`25:00`, `2027-02-30`, prose) is left out rather than stored.
 */
function portWallClock(value: unknown): string | undefined {
  const match = PORT_CLOCK.exec(asString(value) ?? "");
  if (!match) return undefined;
  const local = `${match[1]}T${match[2].padStart(2, "0")}:${match[3]}`;
  try {
    parseLocal(local);
    return local;
  } catch {
    // Not a real wall clock: no value, never an Invalid Date downstream.
    return undefined;
  }
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
    arrivalTime: portWallClock(raw.arrivalTime),
    departureTime: portWallClock(raw.departureTime),
    excursionNote: asString(raw.excursionNote),
  };
}

function normalizeCruise(raw: RawCruise, sourceText: string): ParsedCruise {
  const stopsArray = Array.isArray(raw.stops) ? (raw.stops as unknown[]) : [];
  const stops = stopsArray.map((entry, index) =>
    normalizeStop((entry ?? {}) as RawCruiseStop, index)
  );

  // Re-sequence dayNumber so it is monotonically increasing 1..N regardless of
  // what the LLM produced. Keeps the cruise stop editor invariant happy.
  stops.sort((a, b) => a.dayNumber - b.dayNumber);
  for (let i = 0; i < stops.length; i++) stops[i] = { ...stops[i], dayNumber: i + 1 };

  const flightsArray = Array.isArray(raw.flights) ? (raw.flights as unknown[]) : [];
  const flights = flightsArray
    .map((entry) => normalizeFlight((entry ?? {}) as RawCruiseFlight, sourceText))
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
  /** An explicit Ollama endpoint (tests); wins over the admin's provider. */
  url?: string;
  model?: string;
  /** A resolved provider target (`llm/llmProvider.ts`); wins over url/model. */
  target?: LlmTarget;
}

export class CruiseBookingParser {
  readonly target: LlmTarget;

  constructor(options: CruiseBookingParserOptions = {}) {
    this.target = options.target ?? ollamaTarget(options.url, options.model);
  }

  /** The resolved base URL this parser will talk to (for diagnostics). */
  get endpoint(): string {
    return this.target.url;
  }

  /** The provider, as a parse result may name it. */
  get provider(): ReturnType<typeof describeLlmTarget> {
    return describeLlmTarget(this.target);
  }

  /** Why the last probe failed — protocol and status, never a body. */
  lastProbeError: string | undefined;

  async checkAvailability(): Promise<boolean> {
    const probe = await llmProbe(this.target);
    this.lastProbeError = probe.error;
    return probe.reachable;
  }

  async parseText(text: string): Promise<ParsedCruise[]> {
    // Cruise PDFs can be 5+ pages with full itineraries. Use a generous slice
    // but cap to keep token cost predictable on gemma3:12b.
    const snippet = text.slice(0, 12_000);
    // A JSON-object answer (Ollama `format: "json"`, OpenAI `json_object`):
    // without it gemma3:12b regularly ignores the "JSON only" instruction and
    // answers with a markdown breakdown. A top-level array or a wrapper object
    // are both unwrapped below.
    logger.info(
      { provider: this.provider.kind, model: this.target.model, chars: snippet.length },
      "[Cruise Parser] Sending text to the model"
    );

    const responseText = await llmGenerate(this.target, {
      system: CRUISE_SYSTEM_PROMPT,
      prompt: `Extract every cruise from this booking confirmation text. Output JSON in the shape shown in the EXAMPLE OUTPUT block in the system prompt — a top-level object with a "cruises" array. If you cannot find a value, use null. Do NOT emit placeholder strings.

DOCUMENT:
${snippet}`,
      temperature: 0,
      json: true,
      timeoutMs: llmParseTimeoutMs(),
    });

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
          { model: this.target.model, responseLength: responseText.length },
          "[Cruise Parser] No JSON array found in Ollama response"
        );
        logger.debug({ model: this.target.model, responsePreview: preview });
        throw new Error("No JSON array found in Ollama response");
      }
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch (err) {
        const preview = arrayMatch[0].slice(0, 500).replace(/\s+/g, " ");
        logger.warn(
          { model: this.target.model, error: err instanceof Error ? err.message : String(err) },
          "[Cruise Parser] JSON.parse failed on matched array"
        );
        logger.debug({ model: this.target.model, matchPreview: preview });
        throw new Error("Ollama response JSON parse failed");
      }
    }

    const cruises = unwrapCruiseArray(parsed);
    if (!Array.isArray(cruises)) {
      const preview = JSON.stringify(parsed).slice(0, 300);
      logger.warn(
        { model: this.target.model },
        "[Cruise Parser] Parsed JSON did not yield a cruise array"
      );
      logger.debug({ model: this.target.model, preview });
      throw new Error("Ollama response did not contain a cruise array");
    }

    const normalized = cruises.map((entry) => normalizeCruise((entry ?? {}) as RawCruise, snippet));
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

/**
 * The deterministic readers: every active v2 `cruise` template (plan
 * 2026-10-09 P4b — the TUI Cruises reader that used to be compiled in is one
 * of them), then the caller's own workshop templates (forgejo#124), the first
 * that reads a voyage wins. Empty when none does.
 *
 * Personal templates come LAST, as in the lodging chain: a repository template
 * is measured against a corpus, a workshop one by a single preview.
 */
function readCruiseTemplates(
  text: string,
  userTemplates: readonly TemplateEnvelope[]
): ParsedCruise[] {
  return readWithV2CruiseTemplates(
    [...templateRegistry.getActiveV2({ domain: "cruise" }), ...userTemplates],
    text
  );
}

let cachedParser: CruiseBookingParser | undefined;

export function getCruiseBookingParser(options?: CruiseBookingParserOptions): CruiseBookingParser {
  if (!cachedParser || options) cachedParser = new CruiseBookingParser(options);
  return cachedParser;
}

export async function parseCruiseBookingText(
  text: string,
  options?: CruiseBookingParserOptions,
  /** Who is asking. Only the shared demo account is treated differently
   *  (`llmRefusalFor` below); every other value, including `undefined`, is
   *  subject to the admin switch alone. */
  userId?: string
): Promise<CruiseParseResult> {
  // The caller's own workshop templates, read once before the chain runs —
  // only theirs, only `cruise`, only `active` (forgejo#124).
  const userTemplates =
    userId === undefined ? [] : await loadActiveWorkshopTemplates(userId, "cruise");
  // Resolve the Ollama endpoint from admin settings first, mirroring the flight
  // text parser (services/parsers/config.ts). The Settings "Test" button reads
  // the same admin-configured URL, so the cruise parser MUST consult it too —
  // otherwise a correctly configured remote Ollama is silently ignored and every
  // cruise parse falls back to localhost:11434 → ECONNREFUSED. Explicit options
  // (used by tests) still win; env vars remain the final fallback.
  // A deterministic reader first, exactly as the flight and lodging pipelines
  // do it. Before this, cruise parsing asked whether Ollama answered and threw
  // if it did not, so an instance without a local model could not import a
  // cruise booking at all — measured on the sample set, every TUI confirmation
  // failed for that reason alone.
  // Which reader looks first is one admin setting for all four domains
  // (`getParserOrder`), default template-first — which is what this domain
  // has always done.
  const order = await getParserOrder();
  // What this function owes its caller about the model does not depend on which
  // reader won: a template hit used to report `ollamaAvailable: false` on an
  // instance whose model was up and configured, which is the opposite of what
  // the flight parser said about the same instance.
  // `services/parsers/llmAvailability.ts` is the one definition now. Explicit
  // options are forwarded because they win over the admin endpoint below, and
  // reporting on a host this parse never touched is the same class of untruth.
  const llmQuery = {
    ...(userId !== undefined ? { userId } : {}),
    ...(options?.url !== undefined ? { url: options.url } : {}),
    ...(options?.model !== undefined ? { model: options.model } : {}),
  };
  if (order === "template_first") {
    const templated = readCruiseTemplates(text, userTemplates);
    if (templated.length > 0) {
      return {
        cruises: templated,
        parserUsed: "template",
        ollamaAvailable: await isLlmAvailable(llmQuery),
      };
    }
  }

  /**
   * A refused caller never reaches the model — the admin switch (owner
   * decision 2026-09-25) or the SHARED demo account (security audit of
   * 2026-09-19, finding 3), both answered by `llmRefusalFor`.
   * `resolveCruiseParserOptions` below hands back the ADMIN's Ollama, or
   * `OLLAMA_URL`, for whoever asks, so this has to come before it.
   *
   * The cruise templates are free and run untouched; this is the step
   * after them. The answer is the one an instance with no model configured
   * already gives, so the routes take their existing "template only / not
   * recognised" path, and `fallbackReason` says which refusal it was.
   */
  const refusal = await llmRefusalFor(userId);
  if (refusal) {
    // Under `llm_first` the template has not been tried yet.
    const templated = order === "llm_first" ? readCruiseTemplates(text, userTemplates) : [];
    if (templated.length > 0) {
      return { cruises: templated, parserUsed: "template", ollamaAvailable: false };
    }
    return {
      cruises: [],
      parserUsed: "none",
      ollamaAvailable: false,
      fallbackReason: refusal.reason,
    };
  }

  const parser = getCruiseBookingParser(await resolveCruiseParserOptions(options));
  // This probe IS the health probe `ollamaAvailable` reports on, so it is fed
  // back into the shared cache rather than measured twice per parse.
  const ollamaAvailable = await parser.checkAvailability();
  recordLlmProbe(parser.endpoint, ollamaAvailable);
  if (!ollamaAvailable) {
    // Under `llm_first` the template has not been tried yet, and an
    // unreachable model must not cost a booking the template can read.
    const templated = order === "llm_first" ? readCruiseTemplates(text, userTemplates) : [];
    if (templated.length > 0) {
      return { cruises: templated, parserUsed: "template", ollamaAvailable: false };
    }
    return {
      cruises: [],
      parserUsed: "none",
      ollamaAvailable: false,
      fallbackReason:
        `${llmProviderLabel(parser.target)} is not reachable at ${parser.endpoint} — ` +
        `check the parser configuration in Settings (${parser.lastProbeError ?? "no answer"}).`,
    };
  }
  let cruises: ParsedCruise[];
  try {
    cruises = await parser.parseText(text);
  } catch (err) {
    // A provider that answered the probe and then failed (timeout, HTTP 4xx/5xx,
    // an answer that is not a cruise) is a failure the user is told about, not
    // an empty success — and it must not cost a booking the template can read.
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: reason, provider: parser.provider.kind },
      "[Cruise Parser] Model parse failed"
    );
    const templated = order === "llm_first" ? readCruiseTemplates(text, userTemplates) : [];
    if (templated.length > 0) {
      return { cruises: templated, parserUsed: "template", ollamaAvailable: true };
    }
    return {
      cruises: [],
      parserUsed: "none",
      ollamaAvailable: true,
      fallbackReason: `The AI parser failed: ${reason}`,
    };
  }
  if (cruises.length === 0 && order === "llm_first") {
    // Same rule as lodging: the model finding nothing is not a reason to
    // leave a template hit on the table.
    const templated = readCruiseTemplates(text, userTemplates);
    if (templated.length > 0) {
      return { cruises: templated, parserUsed: "template", ollamaAvailable: true };
    }
  }
  return { cruises, parserUsed: "ollama", ollamaAvailable: true };
}

/**
 * Explicit options (tests) over the admin's provider over env/defaults — the
 * one resolution every model caller shares (`llm/llmProvider.ts`).
 */
async function resolveCruiseParserOptions(
  options?: CruiseBookingParserOptions
): Promise<CruiseBookingParserOptions> {
  if (options?.target) return options;
  // The first slot of the chain that answers (`llm/reachableTarget.ts`).
  const target = await resolveReachableLlmTarget({
    ...(options?.url !== undefined ? { url: options.url } : {}),
    ...(options?.model !== undefined ? { model: options.model } : {}),
    withDefaults: true,
    wait: true,
  });
  return target ? { target } : {};
}
