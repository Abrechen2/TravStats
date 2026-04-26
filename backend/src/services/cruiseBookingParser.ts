import http from "http";
import https from "https";
import logger from "../utils/logger";

const CRUISE_CABIN_TYPES = ["inside", "oceanview", "balcony", "suite"] as const;
const CRUISE_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

export type CruiseCabinType = (typeof CRUISE_CABIN_TYPES)[number];
export type CruiseCurrency = (typeof CRUISE_CURRENCIES)[number];

export interface ParsedCruiseStop {
  portName?: string;
  city?: string;
  country?: string;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: string;
  departureTime?: string;
  excursionNote?: string;
}

export interface ParsedCruise {
  shipName?: string;
  cruiseLine?: string;
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
  parserTemplate: string;
  parserConfidence: number;
  missing: string[];
}

export interface CruiseParseResult {
  cruises: ParsedCruise[];
  parserUsed: "ollama";
  ollamaAvailable: boolean;
}

const SYSTEM_PROMPT = `You are a cruise booking data extractor. Extract every cruise from the provided booking confirmation text.
Return a JSON array. Each element is one cruise booking with these fields:
- shipName: string (e.g. "Mein Schiff 4")
- cruiseLine: string (e.g. "TUI Cruises", "AIDA")
- startDate: string (ISO 8601 date or datetime, e.g. "2025-12-19" or "2025-12-19T18:00")
- endDate: string (ISO 8601)
- departurePortName: string or null (port the cruise embarks from)
- arrivalPortName: string or null (port the cruise disembarks at)
- cabinNumber: string or null (e.g. "8123")
- cabinType: "inside" | "oceanview" | "balcony" | "suite" or null
- deck: integer or null
- bookingReference: string or null
- price: number or null (total in the smallest currency unit's main, e.g. 2499.00)
- currency: "EUR" | "USD" | "GBP" | "CHF" or null
- stops: array of stops in chronological order. Each stop:
  - portName: string or null (null only when isAtSea is true)
  - city: string or null
  - country: string or null
  - dayNumber: integer (1-based, day of cruise)
  - isAtSea: boolean (true for sea days, false for port calls)
  - arrivalTime: string or null (ISO 8601 with time)
  - departureTime: string or null (ISO 8601 with time)
  - excursionNote: string or null

Rules:
- Map German cabin descriptors: "Innenkabine"/"Innen" → "inside", "Aussenkabine"/"Außenkabine"/"Meerblick" → "oceanview", "Balkon"/"Balkonkabine"/"Verandakabine" → "balcony", "Suite"/"Junior Suite" → "suite".
- Include EVERY itinerary stop, including embarkation and disembarkation ports as day 1 and final day. Sea days must be listed with isAtSea=true and portName=null.
- dayNumber is consecutive starting at 1 with no gaps.
- Prefer ISO 8601 with explicit time when the text gives a time; otherwise just the date is fine.
- Currency must be normalized to a 3-letter ISO code; if you see "€" use "EUR".
- If a field is not present in the text, use null. Never invent.
- Return ONLY the JSON array, no explanation, no markdown, no <think> tags.
/no_think
`;

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
  return typeof value === "string" && (CRUISE_CURRENCIES as readonly string[]).includes(value);
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
  isAtSea?: unknown;
  arrivalTime?: unknown;
  departureTime?: unknown;
  excursionNote?: unknown;
}

interface RawCruise {
  shipName?: unknown;
  cruiseLine?: unknown;
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
}

function normalizeStop(raw: RawCruiseStop, index: number): ParsedCruiseStop {
  const isAtSea = asBoolean(raw.isAtSea);
  const dayNumber = asNumber(raw.dayNumber);
  return {
    portName: isAtSea ? undefined : asString(raw.portName),
    city: asString(raw.city),
    country: asString(raw.country),
    dayNumber: dayNumber !== undefined && dayNumber > 0 ? Math.floor(dayNumber) : index + 1,
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

  const cruise: ParsedCruise = {
    shipName: asString(raw.shipName),
    cruiseLine: asString(raw.cruiseLine),
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
    const body = JSON.stringify({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: snippet,
      stream: false,
      think: false,
      options: { temperature: 0.1 },
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

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      const preview = responseText.slice(0, 500).replace(/\s+/g, " ");
      logger.warn(
        { model: this.model, responsePreview: preview },
        "[Cruise Parser] No JSON array found in Ollama response",
      );
      throw new Error("No JSON array found in Ollama response");
    }

    let cruises: unknown;
    try {
      cruises = JSON.parse(jsonMatch[0]);
    } catch (err) {
      const preview = jsonMatch[0].slice(0, 500).replace(/\s+/g, " ");
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
    if (!Array.isArray(cruises)) {
      throw new Error("Ollama response is not a JSON array");
    }

    const normalized = cruises.map((entry) => normalizeCruise((entry ?? {}) as RawCruise));
    logger.info({ count: normalized.length }, "[Cruise Parser] Extracted cruises");
    return normalized;
  }
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
  const parser = getCruiseBookingParser(options);
  const ollamaAvailable = await parser.checkAvailability();
  if (!ollamaAvailable) {
    throw new Error("Ollama is not reachable — cannot parse cruise booking");
  }
  const cruises = await parser.parseText(text);
  return { cruises, parserUsed: "ollama", ollamaAvailable: true };
}
