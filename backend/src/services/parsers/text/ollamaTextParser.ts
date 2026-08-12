import https from "https";
import http from "http";
import { ITextParser, ProviderAvailability, TextProvider } from "../types";
import { ParsedBooking } from "../../bookingParser";
import logger from "../../../utils/logger";

export function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const exampleYear = new Date().getFullYear();
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

// Ollama generation timeout. qwen3-class reasoning models on large emails can
// take minutes; the previous 120s was too aggressive and caused fallback to
// single-leg regex templates for multi-flight bookings.
const OLLAMA_GENERATE_TIMEOUT_MS = 300_000;

const EMAIL_SNIPPET_MAX_CHARS = 12_000;

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
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve(data));
    });
    req.setTimeout(OLLAMA_GENERATE_TIMEOUT_MS, () =>
      req.destroy(new Error(`Ollama request timeout after ${OLLAMA_GENERATE_TIMEOUT_MS}ms`))
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
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolve(data));
      }
    );
    req.setTimeout(5_000, () => req.destroy(new Error("Ollama availability check timeout")));
    req.on("error", reject);
    req.end();
  });
}

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

export class OllamaTextParser implements ITextParser {
  readonly provider: TextProvider = "ollama";
  private readonly url: string;
  private readonly model: string;

  constructor(url?: string, model?: string) {
    this.url = url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.model = model ?? process.env.OLLAMA_MODEL ?? "gemma3:12b";
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    try {
      const res = await fetchGet(`${this.url}/api/tags`);
      const parsed: unknown = JSON.parse(res);
      if (typeof parsed === "object" && parsed !== null && "models" in parsed) {
        return {
          available: true,
          metadata: { url: this.url, model: this.model },
        };
      }
      return { available: false, reason: "Unexpected Ollama response" };
    } catch (err) {
      return {
        available: false,
        reason: `Ollama not reachable at ${this.url}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async parseEmail(subject: string, text: string): Promise<ParsedBooking[]> {
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

    // `think: false` disables chain-of-thought generation on reasoning models
    // like qwen3. Older Ollama versions ignore the field, so it is safe to
    // always send. Combined with `/no_think` in the system prompt this avoids
    // `<think>…</think>` blocks that bloat the response and occasionally break
    // JSON extraction.
    const body = JSON.stringify({
      model: this.model,
      system: buildSystemPrompt(),
      prompt: userPrompt,
      stream: false,
      think: false,
      options: { temperature: 0.1 },
    });

    logger.info({ model: this.model, url: this.url }, "[Ollama Text Parser] Sending email to Ollama");

    const raw = await fetchJson(`${this.url}/api/generate`, body);
    const response: unknown = JSON.parse(raw);

    if (typeof response !== "object" || response === null || !("response" in response)) {
      throw new Error("Invalid Ollama response structure");
    }

    const responseText = (response as Record<string, unknown>).response;
    if (typeof responseText !== "string") {
      throw new Error("Ollama response.response is not a string");
    }

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
        { model: this.model, responsePreview: preview },
        "[Ollama Text Parser] No JSON array found — response did not contain a top-level array"
      );
      throw new Error("No JSON array found in Ollama response");
    }

    let flights: unknown;
    try {
      flights = JSON.parse(jsonMatch[0]);
    } catch (err) {
      const preview = jsonMatch[0].slice(0, 500).replace(/\s+/g, " ");
      logger.warn(
        { model: this.model, matchPreview: preview, error: err instanceof Error ? err.message : String(err) },
        "[Ollama Text Parser] JSON.parse failed on matched array"
      );
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
      if (f.arrivalTime) booking.arrivalTime = f.arrivalTime;
      if (f.seat) booking.seat = f.seat;
      if (f.seatClass) booking.seatClass = mapSeatClass(f.seatClass);
      if (f.airline) booking.airline = f.airline;
      if (f.operatingAirline) booking.operatingAirline = f.operatingAirline;
      if (f.pnr) { booking.pnr = f.pnr; booking.bookingReference = f.pnr; }
      if (f.ticketNumber) booking.ticketNumber = f.ticketNumber;

      const inferred = sanitizeInferredFields(f.inferredFields);
      if (inferred) booking.inferredFields = inferred;

      const critical = ["flightNumber", "departureCode", "arrivalCode", "departureTime", "arrivalTime"] as const;
      for (const field of critical) {
        if (!booking[field]) booking.missing.push(field);
      }

      return booking;
    });
  }
}

const instanceCache = new Map<string, OllamaTextParser>();

export function getOllamaTextParser(url?: string, model?: string): OllamaTextParser {
  const key = `${url ?? "default"}::${model ?? "default"}`;
  if (!instanceCache.has(key)) {
    instanceCache.set(key, new OllamaTextParser(url, model));
  }
  return instanceCache.get(key)!;
}
