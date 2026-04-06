import https from "https";
import http from "http";
import { ITextParser, ProviderAvailability, TextProvider } from "../types";
import { ParsedBooking } from "../../bookingParser";
import logger from "../../../utils/logger";

const SYSTEM_PROMPT = `You are a flight booking data extractor. Extract all flight segments from booking confirmation emails.
Return a JSON array. Each element is one flight leg with these fields:
- flightNumber: string (e.g. "LH2424", no space)
- departureCode: string (IATA, 3 letters, e.g. "MUC")
- arrivalCode: string (IATA, 3 letters)
- departureTime: string (ISO 8601, e.g. "2024-06-10T12:35")
- arrivalTime: string (ISO 8601)
- seat: string or null (e.g. "11C")
- seatClass: "economy" | "premium_economy" | "business" | "first" or null
- airline: string (marketing carrier name)
- operatingAirline: string or null (actual operator if different from marketing carrier)
- pnr: string or null (booking reference / PNR)
- ticketNumber: string or null

Rules:
- Extract ALL flight legs, including connecting flights and return legs
- Use IATA codes only (3-letter airport codes)
- Dates must be ISO 8601 with time component
- If operatingAirline is the same as airline, set it to null
- Return ONLY the JSON array, no explanation, no markdown
`;

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
    req.setTimeout(120_000, () => req.destroy(new Error("Ollama request timeout")));
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
}

export class OllamaTextParser implements ITextParser {
  readonly provider: TextProvider = "ollama";
  private readonly url: string;
  private readonly model: string;

  constructor(url?: string, model?: string) {
    this.url = url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.model = model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:14b";
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
    const emailSnippet = text.slice(0, 5000);
    const userPrompt = `Subject: ${subject}\n\n${emailSnippet}`;

    const body = JSON.stringify({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      stream: false,
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

    // Extract JSON array from response (may be wrapped in ```json ... ```)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("No JSON array found in Ollama response");
    }

    const flights: unknown = JSON.parse(jsonMatch[0]);
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
