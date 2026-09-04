import http from "http";
import https from "https";
import logger from "../../utils/logger";
import {
  splitPostcodeFromCity,
  cleanText,
  normalizeBoard,
  normalizeGuestCount,
} from "./lodgingFieldNormalization";
import { cleanEmailBody } from "../parsers/shared/utils";
import { reconcileTotalPrice } from "./documentTotal";
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
  /**
   * Set only when parserUsed === "none" — the UI shows manual entry with
   * whatever fields it has.
   *
   * `"none"` means NO PARSER PRODUCED A RESULT, not that none was consulted.
   * Ollama returning zero bookings lands here too, and the old wording ("the
   * parser found no booking") read as though nothing had looked — which is how
   * a working instance came to be reported as having no parser (Forgejo #34).
   * The reason string now names who looked.
   */
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

// Exported for the prompt-contract tests — date-anchoring and
// booking-number rules are pinned there (HX booking, 2026-08-21).
export const LODGING_SYSTEM_PROMPT = `You extract structured data from hotel booking confirmations (German or English).

Return ONLY this JSON, with no prose before or after: {"bookings":[ BOOKING ]}.
There is almost always exactly ONE booking — return a single-element array.

Copy every value VERBATIM from the document. If a value is not in the text, use null. NEVER output placeholder strings like "Hotel Name", "City", "string".

A BOOKING object has these fields:
- hotelName: the property's name, e.g. "Novina Sleep Inn Herzogenaurach".
- checkIn, checkOut: ISO "YYYY-MM-DD". German "04.06.2026" or "4. Juni 2026" -> "2026-06-04". A two-digit year is the STAY's century year: "18. Februar 27" -> "2027-02-18". Resolve every date against the stay/travel period stated in the document, never against the letter, print or booking date — a confirmation written in January 26 routinely describes a stay in 2027.
- nights: number of nights as an integer.
- roomCategory: the room type as printed, e.g. "Deluxe Zimmer mit Kingsize-Bett".
- address: street and house number only.
- postcode, city: as printed.
- country: the COUNTRY, never a city, region or state. If the document names only
  a city ("Dubai", "Canton, TX"), give the country that city is in ("United Arab
  Emirates", "United States"). If you cannot tell, use null.
- totalPrice: the total price as a number ("€ 1.234,50" -> 1234.50). Use the amount that includes taxes and fees.
- pricePerNight: the printed per-night rate, else null.
- currency: 3-letter ISO code; "€" -> "EUR", "CHF" -> "CHF".
- board: meal plan as printed, else null.
- adults, children: integers if stated, else null.
- confirmationNumber: the number explicitly labelled as the booking/confirmation number ("Buchungsnummer", "Booking number", "Reservierung", "Confirmation"), digits only. NEVER a document, print or customer number that merely appears in headers, footers or page margins.
- type: what KIND of place this is — "hotel", "campsite", "guesthouse",
  "apartment" or "hostel". Judge it from the name and the text (a KOA or
  "Campingplatz" is a campsite, a "Ferienwohnung" an apartment). Default "hotel".
- chainName: the hotel GROUP behind the brand, if any — "Courtyard by Marriott"
  -> "Marriott", "Hampton by Hilton" -> "Hilton", "Novotel"/"ibis"/"Mercure" ->
  "Accor", "Holiday Inn"/"Garner" -> "IHG", "Park Inn" -> "Radisson". null for an
  independent house.

EXAMPLE OUTPUT:
{"bookings":[{"hotelName":"Novina Sleep Inn Herzogenaurach","checkIn":"2026-03-08","checkOut":"2026-03-09","nights":1,"roomCategory":"Doppelzimmer","address":"Beethovenstraße 4","postcode":"91074","city":"Herzogenaurach","country":"Deutschland","totalPrice":89.00,"pricePerNight":89.00,"currency":"EUR","board":"Breakfast","adults":2,"children":0,"confirmationNumber":"260308233983","type":"hotel","chainName":null}]}`;

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

function normalizeBooking(
  raw: Record<string, unknown>,
  documentText: string,
): ParsedLodgingBooking | null {
  const hotelName = asString(raw.hotelName);
  const checkIn = asString(raw.checkIn);
  const checkOut = asString(raw.checkOut);
  // Without a name and a usable date range there is nothing to build a stay
  // from — drop the entry rather than emit a half-row the preview cannot show.
  //
  // The DROP IS LOGGED, and that is the point of this block existing as more
  // than one line. A discarded entry is indistinguishable from a document the
  // model found nothing in, so "the parser found no booking" was reported for
  // confirmations where the model HAD read something and lost one field
  // (Forgejo #34). Naming which field was missing turns an unfalsifiable
  // complaint into something that can be reproduced.
  if (!hotelName || !checkIn || !checkOut) {
    logger.info(
      {
        operation: "lodging_candidate_discarded",
        missing: [
          !hotelName ? "hotelName" : null,
          !checkIn ? "checkIn" : null,
          !checkOut ? "checkOut" : null,
        ].filter(Boolean),
      },
      "[Lodging Parser] Discarded a model answer that was missing a required field",
    );
    return null;
  }
  if (!ISO_DAY_RE.test(checkIn) || !ISO_DAY_RE.test(checkOut)) {
    logger.info(
      { operation: "lodging_candidate_discarded", checkIn, checkOut },
      "[Lodging Parser] Discarded a model answer whose dates were not ISO days",
    );
    return null;
  }

  const nightsRaw = asNumber(raw.nights);
  const nightsFromDates = Math.max(
    0,
    Math.round(
      (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );
  // The model copies the city "as printed", and confirmations print the
  // postcode in front of it (forgejo#85). Take the code off; keep it as the
  // postcode when the model gave none.
  const citySplit = splitPostcodeFromCity(cleanText(raw.city));
  const city = citySplit.city;
  const roomCategory = cleanText(raw.roomCategory);
  const confirmationNumber = cleanText(raw.confirmationNumber);

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
  const modelPrice = currency === null ? null : rawPrice;

  // The document outranks the model on this one field. Asking for "the total
  // price" is not reliable and cannot be made reliable — two identical runs of
  // the owner's Armani confirmation returned the tax-inclusive total and the
  // bare room rate. A labelled total in the source is provable, so it wins.
  // Only when a currency survived the guard above: an amount without a unit is
  // not a price, whoever proposed it.
  const reconciled =
    currency === null ? { value: null, source: "none" as const } : reconcileTotalPrice(modelPrice, documentText);
  const totalPrice = reconciled.value;
  if (reconciled.source === "document" && modelPrice !== null) {
    logger.info(
      { operation: "lodging_total_from_document" },
      "[Lodging Parser] The document's labelled total overruled the model's figure",
    );
  }

  const missing: string[] = [];
  if (!roomCategory) missing.push("roomCategory");
  if (!city) missing.push("city");
  if (totalPrice === null) missing.push("totalPrice");
  if (!confirmationNumber) missing.push("confirmationNumber");

  // A per-night rate is priced in the same currency as the total, so it falls
  // to the same guard: an amount without a usable currency is not a price.
  const pricePerNight = currency === null ? null : asNumber(raw.pricePerNight);

  return {
    hotelName,
    checkIn,
    checkOut,
    nights: nightsRaw !== null && nightsRaw > 0 ? Math.floor(nightsRaw) : nightsFromDates,
    roomCategory,
    address: cleanText(raw.address),
    postcode: cleanText(raw.postcode) ?? citySplit.postcode,
    city,
    // `cleanText`, not `asString`: the model emits the four characters "null"
    // for an absent country often enough that it was being stored that way.
    country: cleanText(raw.country),
    totalPrice,
    pricePerNight,
    currency,
    board: normalizeBoard(raw.board),
    guests: normalizeGuestCount(raw.adults, raw.children),
    // Validated against the vocabulary, never trusted as free text: a model
    // that invents "resort" must not reach a Zod enum and fail the whole row.
    type: LODGING_TYPES.find((v) => v === cleanText(raw.type)?.toLowerCase()) ?? null,
    chainName: cleanText(raw.chainName),
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

/**
 * How much of a document the model is shown. Mirrors EMAIL_SNIPPET_MAX_CHARS on
 * the flight side; kept as a named constant so the two can be compared at a
 * glance rather than by grepping for a literal.
 */
const LODGING_SNIPPET_MAX_CHARS = 12_000;

async function parseWithOllama(
  text: string,
  url: string,
  model: string,
): Promise<ParsedLodgingBooking[]> {
  // Same window as the flight parser, and — like it since 2.5.2 — a truncation
  // is LOGGED. The lodging side cut silently, so a confirmation whose booking
  // table sat past the window came back as "no booking found" with nothing to
  // distinguish it from a document that genuinely holds none (Forgejo #34).
  const snippet = text.slice(0, LODGING_SNIPPET_MAX_CHARS);
  if (text.length > LODGING_SNIPPET_MAX_CHARS) {
    logger.warn(
      { totalChars: text.length, keptChars: LODGING_SNIPPET_MAX_CHARS },
      "[Lodging Parser] Document truncated before the model saw it",
    );
  }
  const body = JSON.stringify({
    model,
    system: LODGING_SYSTEM_PROMPT,
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
    .map((entry) => normalizeBooking((entry ?? {}) as Record<string, unknown>, snippet))
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
    // Cleaned only for the model, never for the template branch above: a
    // template may key on layout or on a link, and stripping either would take
    // a working parse away to help a failing one.
    //
    // Forgejo #34, and the reason is not the one the report guessed. An archived
    // hotels.com confirmation came back "no booking found" while the model was
    // reachable. Measured against it: the check-in and check-out lines sit at
    // character ~1073, far inside the window, and rewriting their mixed German/
    // English form ("Mo, Apr 6, 2009") to ISO changed NOTHING — the document was
    // still lost. What did change it was removing the links: 12360 characters
    // fall to 3995, roughly two thirds of that mail being tracking and booking
    // URLs, and the whole document then parses correctly. Truncation was a
    // symptom of the same bloat, not the cause.
    //
    // `cleanEmailBody` is what the flight parser has always applied to its body;
    // this side only ever used `cleanText` on individual field VALUES. So this
    // is the flight parser's own treatment, not a new idea.
    const bookings = await parseWithOllama(cleanEmailBody(text), url, model);
    if (bookings.length === 0) {
      return {
        bookings: [],
        parserUsed: "none",
        ollamaAvailable: true,
        fallbackReason: "The AI parser read this document and found no booking in it",
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
