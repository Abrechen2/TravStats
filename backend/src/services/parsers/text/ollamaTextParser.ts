import { ITextParser, ProviderAvailability, TextProvider, TextParseOptions } from "../types";
import { ParsedBooking } from "../../bookingParser";
import { isPlausibleLegArrival } from "../shared/legTiming";
import { llmParseTimeoutMs } from "../../http/llmTimeout";
import logger from "../../../utils/logger";
import {
  describeLlmTarget,
  llmGenerate,
  llmProbe,
  llmProviderLabel,
  ollamaTarget,
  type LlmTarget,
} from "../../llm/llmProvider";

/**
 * @param referenceDate The point a year-less date should be read against —
 *   normally when the email was SENT. Omitted means today, which is right for
 *   a confirmation that just arrived and wrong for a mailbox export: an email
 *   from 2005 saying "16 JUL" was coming back as a 2026 flight (#285).
 */
export function buildSystemPrompt(referenceDate?: Date): string {
  const anchor = referenceDate ?? new Date();
  const today = anchor.toISOString().slice(0, 10); // YYYY-MM-DD
  const exampleYear = anchor.getUTCFullYear();
  return `You are a flight booking data extractor. Extract all flight segments from booking confirmation emails.

Today's date is ${today}. Use this as the reference point for any date that does not carry an explicit year in the source.

Return a JSON array. Each element is one flight leg with these fields:
- flightNumber: string (e.g. "LH2424", no space)
- departureCode: string (IATA, 3 letters, e.g. "MUC")
- arrivalCode: string (IATA, 3 letters)
- departureTime: string (ISO 8601, e.g. "${exampleYear}-06-10T12:35")
- arrivalTime: string (ISO 8601)
- seat: string or null (e.g. "11C")
- seatClass: "economy" | "premium_economy" | "business" | "first" or null
- airline: string (marketing carrier name)
- operatingAirline: string or null (actual operator if different from marketing carrier)
- pnr: string or null (booking reference / PNR)
- ticketNumber: string or null
- totalPrice: number or null (the TOTAL price of the whole booking — the final amount actually charged, including taxes and fees, e.g. "Endpreis" / "Total"; NOT the per-leg fare. Repeat the same value on every leg that belongs to the same booking. Output a plain JSON number with a dot as decimal separator — "EUR 4,359.14" means 4359.14, "1.234,56 €" means 1234.56. If no total is stated, use null — never compute or guess one)
- currency: string or null (ISO 4217 code of totalPrice, e.g. "EUR", "USD"; map symbols: € → EUR, $ → USD, £ → GBP)
- inferredFields: array of field names that you HAD TO GUESS or DEFAULT because the source text did not state them explicitly (see "Inference reporting" below)

Rules:
- Extract ALL flight legs, including connecting flights and return legs
- Use IATA codes only (3-letter airport codes)
- Dates must be ISO 8601 with time component
- If operatingAirline is the same as airline, set it to null
- If a date in the source does not carry a year, choose the next future occurrence of that month/day relative to today's date (${today}), and add "departureTime" and/or "arrivalTime" to inferredFields
- If a field is not present in the source AND cannot be reasonably inferred, set it to null — do NOT add it to inferredFields (null means "no value", inferred means "I assigned a value the source did not state")
- Return ONLY the JSON array, no explanation, no markdown, no <think> tags

Inference reporting:
- inferredFields lists every field whose value you ASSIGNED but is NOT explicitly stated in the source text. Examples:
  * Source has "Mo 18 Mai 22:05" with no year → year inferred → include "departureTime"
  * Source has booking class "Q" but no cabin label → seatClass inferred from booking class → include "seatClass"
  * Source has flight number "ET853" but no airline name → airline inferred from carrier code → include "airline"
- Fields you extracted directly from the source text MUST NOT appear in inferredFields
- Fields you left null MUST NOT appear in inferredFields
- inferredFields may be an empty array if nothing was inferred
/no_think
`;
}

const EMAIL_SNIPPET_MAX_CHARS = 12_000;

function mapSeatClass(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === "premium_economy" || lower.includes("premium")) return "premium_economy";
  if (lower === "business") return "business";
  if (lower === "first") return "first";
  if (lower === "economy") return "economy";
  return undefined;
}

interface RawFlight {
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  seat?: string | null;
  seatClass?: string | null;
  airline?: string;
  operatingAirline?: string | null;
  pnr?: string | null;
  ticketNumber?: string | null;
  totalPrice?: unknown;
  currency?: unknown;
  inferredFields?: string[];
}

const KNOWN_INFERRED_FIELDS: ReadonlySet<string> = new Set([
  "flightNumber",
  "departureCode",
  "arrivalCode",
  "departureTime",
  "arrivalTime",
  "seat",
  "seatClass",
  "airline",
  "operatingAirline",
  "pnr",
  "ticketNumber",
  "bookingReference",
]);

function sanitizeInferredFields(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    if (KNOWN_INFERRED_FIELDS.has(entry)) seen.add(entry);
  }
  return seen.size > 0 ? [...seen] : undefined;
}

/**
 * The flight text parser's model step. The class keeps its historical name —
 * `parserUsed: "ollama"` means "the language model read it" in every domain's
 * API, whichever provider that model sits behind (`llm/llmProvider.ts`); the
 * provider itself is reported separately as `llmProvider`.
 */
export class OllamaTextParser implements ITextParser {
  readonly provider: TextProvider = "ollama";
  private readonly target: LlmTarget;

  constructor(urlOrTarget?: string | LlmTarget, model?: string) {
    this.target = typeof urlOrTarget === "object" ? urlOrTarget : ollamaTarget(urlOrTarget, model);
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    const probe = await llmProbe(this.target);
    if (probe.reachable) {
      return { available: true, metadata: { ...describeLlmTarget(this.target) } };
    }
    return {
      available: false,
      reason: `${llmProviderLabel(this.target)} not reachable: ${probe.error ?? "no answer"}`,
    };
  }

  async parseEmail(
    subject: string,
    text: string,
    _html?: string,
    _apiKey?: string,
    options?: TextParseOptions
  ): Promise<ParsedBooking[]> {
    // 12k chars ≈ 3k tokens — comfortably within every deployed model's
    // context alongside the system prompt. The old 5000 cap sat 300 chars
    // above a real Emirates booking PDF; anything longer silently lost its
    // later legs (return flights live at the END of itinerary emails).
    const emailSnippet = text.slice(0, EMAIL_SNIPPET_MAX_CHARS);
    if (text.length > EMAIL_SNIPPET_MAX_CHARS) {
      logger.warn(
        { totalChars: text.length, keptChars: EMAIL_SNIPPET_MAX_CHARS },
        "[Ollama Text Parser] Email text truncated — legs beyond the cap are invisible to the LLM"
      );
    }
    const userPrompt = `Subject: ${subject}\n\n${emailSnippet}`;

    logger.info(
      { provider: describeLlmTarget(this.target).kind, model: this.target.model },
      "[LLM Text Parser] Sending email to the model"
    );

    const responseText = await llmGenerate(this.target, {
      system: buildSystemPrompt(options?.referenceDate),
      prompt: userPrompt,
      temperature: 0.1,
      // The answer is a top-level ARRAY — a JSON-object mode would forbid it.
      json: false,
      timeoutMs: llmParseTimeoutMs(),
    });

    // Strip reasoning / thinking blocks that qwen3-class models sometimes
    // emit even with `think: false` and `/no_think`. Without this, greedy
    // JSON extraction can accidentally match text inside a think block that
    // mentions `[brackets]` and fail to parse.
    const cleaned = responseText
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
      .trim();

    // Extract JSON array from the cleaned response
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      const preview = responseText.slice(0, 500).replace(/\s+/g, " ");
      logger.warn(
        { model: this.target.model, responseLength: responseText.length },
        "[Ollama Text Parser] No JSON array found — response did not contain a top-level array"
      );
      logger.debug({ model: this.target.model, responsePreview: preview });
      throw new Error("No JSON array found in Ollama response");
    }

    let flights: unknown;
    try {
      flights = JSON.parse(jsonMatch[0]);
    } catch (err) {
      const preview = jsonMatch[0].slice(0, 500).replace(/\s+/g, " ");
      logger.warn(
        { model: this.target.model, error: err instanceof Error ? err.message : String(err) },
        "[Ollama Text Parser] JSON.parse failed on matched array"
      );
      logger.debug({ model: this.target.model, matchPreview: preview });
      throw new Error("Ollama response JSON parse failed");
    }
    if (!Array.isArray(flights)) {
      throw new Error("Ollama response is not a JSON array");
    }

    logger.info({ count: flights.length }, "[Ollama Text Parser] Extracted flights");

    return flights.map((raw: unknown): ParsedBooking => {
      const f = (raw ?? {}) as RawFlight;
      const booking: ParsedBooking = {
        missing: [],
        parserTemplate: "ollama",
        parserConfidence: 85,
      };

      if (f.flightNumber) booking.flightNumber = f.flightNumber.replace(/\s+/g, "");
      if (f.departureCode) booking.departureCode = f.departureCode.toUpperCase();
      if (f.arrivalCode) booking.arrivalCode = f.arrivalCode.toUpperCase();
      if (f.departureTime) booking.departureTime = f.departureTime;
      // Same gate the regex and OCR paths pass through in
      // `normalizeParsedBooking`, which this mapper does not use: a model that
      // reads two documents as one leg produces the same impossible pair a
      // positional regex does. The `critical` loop below then reports the
      // arrival as missing, which is the honest answer.
      if (f.arrivalTime && isPlausibleLegArrival(f.departureTime, f.arrivalTime)) {
        booking.arrivalTime = f.arrivalTime;
      }
      if (f.seat) booking.seat = f.seat;
      if (f.seatClass) booking.seatClass = mapSeatClass(f.seatClass);
      if (f.airline) booking.airline = f.airline;
      if (f.operatingAirline) booking.operatingAirline = f.operatingAirline;
      if (f.pnr) {
        booking.pnr = f.pnr;
        booking.bookingReference = f.pnr;
      }
      if (f.ticketNumber) booking.ticketNumber = f.ticketNumber;
      // The prompt demands a JSON number (dot-decimal), so a string here means
      // the model ignored the format rule — drop it rather than risk the
      // "4,359.14"-as-4 misread downstream (parseFloat stops at the comma).
      if (typeof f.totalPrice === "number" && Number.isFinite(f.totalPrice) && f.totalPrice > 0) {
        booking.price = String(f.totalPrice);
      }
      if (typeof f.currency === "string" && /^[A-Za-z]{3}$/.test(f.currency)) {
        booking.currency = f.currency.toUpperCase();
      }

      const inferred = sanitizeInferredFields(f.inferredFields);
      if (inferred) booking.inferredFields = inferred;

      const critical = [
        "flightNumber",
        "departureCode",
        "arrivalCode",
        "departureTime",
        "arrivalTime",
      ] as const;
      for (const field of critical) {
        if (!booking[field]) booking.missing.push(field);
      }

      return booking;
    });
  }
}

const instanceCache = new Map<string, OllamaTextParser>();

/** One parser per endpoint + model + protocol. */
export function getLlmTextParser(target: LlmTarget): OllamaTextParser {
  const key = `${target.kind ?? "ollama"}::${target.url}::${target.model}::${target.apiKey ? "key" : "nokey"}`;
  const cached = instanceCache.get(key);
  if (cached) return cached;
  const parser = new OllamaTextParser(target);
  instanceCache.set(key, parser);
  return parser;
}

export function getOllamaTextParser(url?: string, model?: string): OllamaTextParser {
  const key = `${url ?? "default"}::${model ?? "default"}`;
  if (!instanceCache.has(key)) {
    instanceCache.set(key, new OllamaTextParser(url, model));
  }
  return instanceCache.get(key)!;
}
