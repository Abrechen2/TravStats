import http from "http";
import https from "https";
import logger from "../../utils/logger";
import { getAdminParserSettings } from "../parserSettings";
import { LODGING_TYPES } from "../../schemas/lodging";
import { isCurrencyCode } from "../../shared/currencies";
import {
  isBookingComConfirmation,
  parseBookingComEmail,
  type LodgingCurrency,
  type ParsedLodgingBooking,
} from "./bookingComTemplate";

export interface LodgingBookingParserOptions {
  url?: string;
  model?: string;
}

export type LodgingParserUsed = "template" | "ollama" | "none";

export interface LodgingParseResult {
  bookings: ParsedLodgingBooking[];
  parserUsed: LodgingParserUsed;
  ollamaAvailable: boolean;
  /** Set only when parserUsed === "none" — the UI shows manual entry with whatever fields it has. */
  fallbackReason?: string;
}

const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
const AVAILABILITY_TIMEOUT_MS = 5_000;

/**
 * Generate-request timeout, overridable via `LODGING_OLLAMA_TIMEOUT_MS` (test-only
 * escape hatch — production always gets the 120s default). Read at call time, not
 * at module load, so tests can shrink it without needing to re-import the module.
 */
function getOllamaTimeoutMs(): number {
  const raw = process.env.LODGING_OLLAMA_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OLLAMA_TIMEOUT_MS;
}

const SYSTEM_PROMPT = `You extract structured data from hotel booking confirmations (German or English).

Return ONLY this JSON, with no prose before or after: {"bookings":[ BOOKING ]}.
There is almost always exactly ONE booking — return a single-element array.

Copy every value VERBATIM from the document. If a value is not in the text, use null. NEVER output placeholder strings like "Hotel Name", "City", "string".

A BOOKING object has these fields:
- hotelName: the property's name, e.g. "Novina Sleep Inn Herzogenaurach".
- checkIn, checkOut: ISO "YYYY-MM-DD". German "04.06.2026" or "4. Juni 2026" -> "2026-06-04".
- nights: number of nights as an integer.
- roomCategory: the room type as printed, e.g. "Deluxe Zimmer mit Kingsize-Bett".
- address: street and house number only.
- postcode, city, country: as printed.
- totalPrice: the total price as a number ("€ 1.234,50" -> 1234.50).
- currency: 3-letter ISO code; "€" -> "EUR", "CHF" -> "CHF".
- confirmationNumber: the booking/confirmation number as printed, digits only.

EXAMPLE OUTPUT:
{"bookings":[{"hotelName":"Novina Sleep Inn Herzogenaurach","checkIn":"2026-03-08","checkOut":"2026-03-09","nights":1,"roomCategory":"Doppelzimmer","address":"Beethovenstraße 4","postcode":"91074","city":"Herzogenaurach","country":"Deutschland","totalPrice":89.00,"currency":"EUR","confirmationNumber":"260308233983"}]}`;

function postJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    const timeoutMs = getOllamaTimeoutMs();
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Ollama request timeout after ${timeoutMs}ms`)),
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getText(url: string): Promise<string> {
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
    req.setTimeout(AVAILABILITY_TIMEOUT_MS, () =>
      req.destroy(new Error("Ollama availability check timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Merge explicit options over admin_settings over env over the localhost
 * default — the exact precedence `resolveCruiseParserOptions` in
 * `cruiseBookingParser.ts` uses. A correctly configured remote Ollama must
 * never be bypassed in favour of localhost, and a fully-specified caller
 * (tests) must never be overridden by whatever is in the database.
 */
async function resolveOptions(
  options?: LodgingBookingParserOptions,
): Promise<Required<LodgingBookingParserOptions>> {
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  if (!options?.url || !options?.model) {
    try {
      const admin = await getAdminParserSettings();
      adminUrl = admin?.ollamaUrl ?? undefined;
      adminModel = admin?.ollamaModel ?? undefined;
    } catch (err) {
      logger.warn({ err }, "[Lodging Parser] Failed to load admin parser settings");
    }
  }
  return {
    url: options?.url ?? adminUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[^\d.,-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asCurrency(value: unknown): LodgingCurrency | null {
  return isCurrencyCode(value) ? value : null;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBooking(raw: Record<string, unknown>): ParsedLodgingBooking | null {
  const hotelName = asString(raw.hotelName);
  const checkIn = asString(raw.checkIn);
  const checkOut = asString(raw.checkOut);
  // Without a name and a usable date range there is nothing to build a stay
  // from — drop the entry rather than emit a half-row the preview cannot show.
  if (!hotelName || !checkIn || !checkOut) return null;
  if (!ISO_DAY_RE.test(checkIn) || !ISO_DAY_RE.test(checkOut)) return null;

  const nightsRaw = asNumber(raw.nights);
  const nightsFromDates = Math.max(
    0,
    Math.round(
      (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const city = asString(raw.city);
  const roomCategory = asString(raw.roomCategory);
  const confirmationNumber = asString(raw.confirmationNumber);

  // A number whose unit was thrown away is not a price.
  //
  // `asCurrency` returns null for anything that is not an ISO-4217 code, and
  // the amount used to survive that on its own. Downstream, `applyFxSnapshot`
  // defaults a null currency to EUR — so the owner's Armani Hotel Dubai
  // confirmation (11,662 AED, read correctly by the LLM) would have been booked
  // as €11,662 against a real cost of roughly €2,900, and quietly inflated every
  // spend total it touched.
  //
  // Dropping the amount loses information; keeping it invents information.
  // The row still imports, with the price flagged as missing, and the user can
  // type it in. The guard was widened from four hardcoded codes to the full
  // ISO-4217 registry on 2026-08-13, so AED and its like now pass; what still
  // trips this branch is an LLM emitting something that is not a currency at
  // all ("EURO", "$", a stray word).
  const currency = asCurrency(raw.currency);
  const rawPrice = asNumber(raw.totalPrice);
  const totalPrice = currency === null ? null : rawPrice;

  const missing: string[] = [];
  if (!roomCategory) missing.push("roomCategory");
  if (!city) missing.push("city");
  if (totalPrice === null) missing.push("totalPrice");
  if (!confirmationNumber) missing.push("confirmationNumber");

  return {
    hotelName,
    checkIn,
    checkOut,
    nights: nightsRaw !== null && nightsRaw > 0 ? Math.floor(nightsRaw) : nightsFromDates,
    roomCategory,
    address: asString(raw.address),
    postcode: asString(raw.postcode),
    city,
    country: asString(raw.country),
    totalPrice,
    currency,
    confirmationNumber,
    parserTemplate: "ollama-lodging",
    parserConfidence: 70,
    missing,
  };
}

function unwrapBookings(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  for (const key of ["bookings", "data", "result", "results", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if ("hotelName" in obj || "checkIn" in obj) return [obj];
  return [];
}

async function checkAvailability(url: string): Promise<boolean> {
  try {
    const res = await getText(`${url}/api/tags`);
    const parsed: unknown = JSON.parse(res);
    return typeof parsed === "object" && parsed !== null && "models" in parsed;
  } catch {
    return false;
  }
}

async function parseWithOllama(
  text: string,
  url: string,
  model: string,
): Promise<ParsedLodgingBooking[]> {
  const snippet = text.slice(0, 12_000);
  const body = JSON.stringify({
    model,
    system: SYSTEM_PROMPT,
    prompt: `Extract every hotel booking from this confirmation. Output JSON in the shape shown in the EXAMPLE OUTPUT block. If you cannot find a value, use null.\n\nDOCUMENT:\n${snippet}`,
    stream: false,
    think: false,
    format: "json",
    options: { temperature: 0, num_ctx: 8192 },
  });

  const raw = await postJson(`${url}/api/generate`, body);
  const response: unknown = JSON.parse(raw);
  if (typeof response !== "object" || response === null || !("response" in response)) {
    throw new Error("Invalid Ollama response structure");
  }
  const responseText = (response as Record<string, unknown>).response;
  if (typeof responseText !== "string") throw new Error("Ollama response.response is not a string");

  const cleaned = responseText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  return unwrapBookings(parsed)
    .map((entry) => normalizeBooking((entry ?? {}) as Record<string, unknown>))
    .filter((b): b is ParsedLodgingBooking => b !== null);
}

/**
 * The email routes hand us `subject + "\n\n" + body`, so the template's
 * subject-based hotel-name extraction still works when we re-split here.
 */
function firstLineAsSubject(text: string): string | undefined {
  const first = text.split("\n", 1)[0];
  return first && first.trim().length > 0 ? first.trim() : undefined;
}

/**
 * Template first, LLM only as a fallback, and NEVER a dead end: every failure
 * path resolves to `{ bookings: [], parserUsed: "none" }` so the caller can
 * drop the user into manual entry with whatever it has. The owner's LLM runs
 * on weak hardware and has timed out in production — no lodging import may
 * depend on it.
 */
export async function parseLodgingBookingText(
  text: string,
  options?: LodgingBookingParserOptions,
): Promise<LodgingParseResult> {
  const templateHit = isBookingComConfirmation(undefined, text)
    ? parseBookingComEmail(firstLineAsSubject(text), text)
    : null;
  if (templateHit) {
    logger.info(
      { template: templateHit.parserTemplate, confidence: templateHit.parserConfidence },
      "[Lodging Parser] Template match",
    );
    return { bookings: [templateHit], parserUsed: "template", ollamaAvailable: false };
  }

  const { url, model } = await resolveOptions(options);
  const ollamaAvailable = await checkAvailability(url);
  if (!ollamaAvailable) {
    logger.warn({ url }, "[Lodging Parser] Ollama unavailable — falling back to manual entry");
    return {
      bookings: [],
      parserUsed: "none",
      ollamaAvailable: false,
      fallbackReason: `Ollama is not reachable at ${url}`,
    };
  }

  try {
    const bookings = await parseWithOllama(text, url, model);
    if (bookings.length === 0) {
      return {
        bookings: [],
        parserUsed: "none",
        ollamaAvailable: true,
        fallbackReason: "The parser found no booking in this document",
      };
    }
    return { bookings, parserUsed: "ollama", ollamaAvailable: true };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), model },
      "[Lodging Parser] Ollama parse failed — falling back to manual entry",
    );
    return {
      bookings: [],
      parserUsed: "none",
      ollamaAvailable: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

export const LODGING_DEFAULT_TYPE = LODGING_TYPES[0]; // "hotel"
