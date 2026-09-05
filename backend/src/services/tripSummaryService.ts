import http from "http";
import https from "https";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import logger from "../utils/logger";
import { getAdminParserSettings } from "./parserSettings";

/**
 * LLM-generated trip summaries.
 *
 * Builds a compact brief from everything a trip carries — flights, cruises,
 * stays, place visits, stops, journal — and asks the instance's Ollama for a
 * three-paragraph travel-diary summary in the reader's language. The text is
 * persisted onto `trip.summary`, so it survives reloads and is not regenerated
 * on every visit.
 *
 * Until 2026-09-05 this file read `OLLAMA_URL`/`OLLAMA_MODEL` from the
 * environment alone and ignored the Ollama the admin had configured for the
 * parsers, wrote German whatever the reader's language, knew nothing about
 * stays and places, and had no test. It sat behind the `tripAiSummary` beta
 * gate for "buggy summaries"; these were the bugs.
 *
 * The model call is injectable (`generate`) so the rest can be tested against
 * a fake: what the brief contains, which prompt goes out, what is persisted.
 */

export type SummaryLanguage = "de" | "en";

export interface OllamaTarget {
  url: string;
  model: string;
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "gemma3:12b";

/**
 * The Ollama the summary talks to: the admin's parser settings first, then
 * the environment, then the defaults every other Ollama caller here assumes.
 * Same precedence as `getParserConfig` — an admin who pointed the parsers at
 * the Mac mini has pointed the summary there too, without a second setting.
 */
export async function resolveOllamaTarget(): Promise<OllamaTarget> {
  const admin = await getAdminParserSettings();
  return {
    url: admin?.ollamaUrl ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    model: admin?.ollamaModel ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
  };
}

const DEFAULT_GENERATE_TIMEOUT_MS = 180_000;
/** A summary is a few paragraphs; anything near this is a misbehaving endpoint. */
const MAX_RESPONSE_BYTES = 2_000_000;
/** Same window the document parsers use in spirit; kept apart from their parity
 *  guard on purpose (different workload, runs at a different time). */
const NUM_CTX = 8192;

/**
 * Generation deadline, overridable through `TRIP_SUMMARY_TIMEOUT_MS` (a test
 * hatch; production keeps the default). Read at call time so a test can shrink
 * it without re-importing the module.
 */
function getGenerateTimeoutMs(): number {
  const raw = process.env.TRIP_SUMMARY_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GENERATE_TIMEOUT_MS;
}

const SYSTEM_PROMPTS: Record<SummaryLanguage, string> = {
  de: `Du bist ein Reisetagebuch-Autor. Aus den strukturierten Reisedaten schreibst du eine warme, persönliche Zusammenfassung.

REGELN:
1. Genau 3 Absätze, je 2-4 Sätze. KEIN Markdown, KEINE Listen, KEINE Aufzählungen.
2. Erster Absatz: Reisezeitpunkt + Hauptziel + Anlass.
3. Zweiter Absatz: konkrete Erlebnisse aus Aufenthalten, Orten, Stopps und Tagebucheinträgen — bevorzuge Eigennamen aus den Daten (Orte, Hotels, Sehenswürdigkeiten) statt generischer Floskeln.
4. Dritter Absatz: Stimmung / Bilanz / Ausblick.
5. Sprache: Deutsch, lockerer Reisetagebuch-Ton, „du" oder „ich" je nachdem was die Daten nahelegen — nicht beides mischen.
6. Erfinde NICHTS, was nicht in den Daten steht. Wenn ein Aspekt fehlt, lass ihn weg statt zu spekulieren.
7. Antworte NUR mit dem Fließtext. Keine Überschrift, keine Anführungszeichen, kein Vorwort.`,
  en: `You write travel diaries. From the structured trip data you write a warm, personal summary.

RULES:
1. Exactly 3 paragraphs of 2-4 sentences each. NO markdown, NO lists, NO bullet points.
2. First paragraph: when the trip was, the main destination, the occasion.
3. Second paragraph: concrete experiences from the stays, places, stops and journal entries — prefer proper names from the data (places, hotels, sights) over generic phrases.
4. Third paragraph: mood, verdict, outlook.
5. Language: English, relaxed travel-diary tone, "you" or "I" depending on what the data suggests — never mix the two.
6. Invent NOTHING that is not in the data. If an aspect is missing, leave it out rather than speculate.
7. Answer ONLY with the prose. No heading, no quotation marks, no preamble.`,
};

const USER_PROMPTS: Record<SummaryLanguage, (briefJson: string) => string> = {
  de: (briefJson) =>
    `Reisedaten:\n${briefJson}\n\nSchreibe die 3-Absatz-Zusammenfassung dieser Reise nach den Regeln im System-Prompt.`,
  en: (briefJson) =>
    `Trip data:\n${briefJson}\n\nWrite the 3-paragraph summary of this trip following the rules in the system prompt.`,
};

export function buildSystemPrompt(language: SummaryLanguage): string {
  return SYSTEM_PROMPTS[language];
}

export function buildUserPrompt(language: SummaryLanguage, briefJson: string): string {
  return USER_PROMPTS[language](briefJson);
}

export interface SummaryBrief {
  name: string;
  status: string;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
  origin: string | null;
  destination: string | null;
  countries: string[];
  companions: string[];
  tags: string[];
  flights: Array<{ from: string; to: string; date: string | null }>;
  cruises: Array<{ line: string | null; start: string | null; end: string | null }>;
  stays: Array<{
    lodging: string;
    city: string | null;
    country: string | null;
    checkIn: string | null;
    checkOut: string | null;
    room: string | null;
    notes: string | null;
  }>;
  places: Array<{
    name: string;
    category: string;
    city: string | null;
    country: string | null;
    date: string | null;
    notes: string | null;
  }>;
  stops: Array<{ title: string; domain: string | null; start: string | null }>;
  journal: Array<{ date: string; title: string | null; body: string }>;
  notes: string | null;
}

/** Everything the brief reads. One include, so the test and the service agree. */
export const TRIP_BRIEF_INCLUDE = {
  flights: { orderBy: { departureTime: "asc" } },
  cruises: { orderBy: { startDate: "asc" } },
  lodgingStays: { include: { lodging: true }, orderBy: { checkIn: "asc" } },
  placeVisits: { include: { place: true }, orderBy: { visitedAt: "asc" } },
  stops: { orderBy: [{ orderIdx: "asc" }, { startDate: "asc" }] },
  journalEntries: { orderBy: { date: "asc" } },
} satisfies Prisma.TripInclude;

export type TripForBrief = Prisma.TripGetPayload<{ include: typeof TRIP_BRIEF_INCLUDE }>;

/** Caps keep the brief inside the model's context on a long, well-kept trip. */
const JOURNAL_BODY_MAX = 600;
const NOTE_MAX = 300;
const TRIP_NOTES_MAX = 1000;

const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
const clip = (text: string | null | undefined, max: number): string | null =>
  text ? text.slice(0, max) : null;

/**
 * The brief, as a pure function of the loaded trip.
 *
 * Stays and places were missing until 2026-09-05: the brief knew the flights
 * and the cruise, and the model wrote around a hole where the hotel and the
 * afternoon at the cathedral should have been — then filled it with a
 * generic sentence, which is the "buggy summary" the gate named.
 */
export function briefFromTrip(trip: TripForBrief): SummaryBrief {
  return {
    name: trip.name,
    status: trip.status,
    category: trip.category ?? null,
    startDate: isoDate(trip.startDate),
    endDate: isoDate(trip.endDate),
    origin: trip.originLabel ?? null,
    destination: trip.destinationLabel ?? null,
    countries: trip.countries ?? [],
    companions: trip.companions ?? [],
    tags: trip.tags ?? [],
    flights: trip.flights.map((f) => ({
      from: f.depIata ?? f.depIcao ?? "?",
      to: f.arrIata ?? f.arrIcao ?? "?",
      date: isoDate(f.departureTime),
    })),
    cruises: trip.cruises.map((c) => ({
      line: c.cruiseLine ?? null,
      start: isoDate(c.startDate),
      end: isoDate(c.endDate),
    })),
    stays: trip.lodgingStays.map((s) => ({
      lodging: s.lodging.name,
      city: s.lodging.city ?? null,
      country: s.lodging.country ?? null,
      checkIn: isoDate(s.checkIn),
      checkOut: isoDate(s.checkOut),
      room: s.roomCategory ?? null,
      notes: clip(s.notes, NOTE_MAX),
    })),
    places: trip.placeVisits.map((v) => ({
      name: v.place.name,
      category: v.place.category,
      city: v.place.city ?? null,
      country: v.place.country ?? null,
      date: isoDate(v.visitedAt),
      notes: clip(v.notes, NOTE_MAX),
    })),
    stops: trip.stops.map((s) => ({
      title: s.title,
      domain: s.domain ?? null,
      start: isoDate(s.startDate),
    })),
    journal: trip.journalEntries.map((j) => ({
      date: j.date.toISOString().slice(0, 10),
      title: j.title ?? null,
      body: j.body.slice(0, JOURNAL_BODY_MAX),
    })),
    notes: clip(trip.notes, TRIP_NOTES_MAX),
  };
}

/**
 * The model's raw answer, made presentable: reasoning tags some models emit
 * are removed, and a quoted answer loses its quotes.
 */
export function cleanSummary(raw: string): string {
  // Trim BEFORE unquoting: a reasoning block is usually followed by a newline,
  // and the opening quote then sits behind it, where a start-anchored strip
  // never sees it. The old order left `"Ein Text.` standing (found by the test
  // that arrived with this rewrite).
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export interface GenerateRequest {
  system: string;
  prompt: string;
}

/** One call to the model. Returns the answer text; throws on any failure. */
export type GenerateFn = (target: OllamaTarget, request: GenerateRequest) => Promise<string>;

/**
 * POST with a HARD deadline. Deliberately not `req.setTimeout()` — that
 * resets on every byte of socket activity, so a server trickling tokens could
 * stall past the budget indefinitely. The body is capped and the status code
 * is checked explicitly rather than left to the JSON parse to catch.
 */
function postJson(url: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn();
    };

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
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            settle(() => reject(new Error(`Ollama response exceeded ${MAX_RESPONSE_BYTES} bytes`)));
            req.destroy();
            return;
          }
          data += chunk;
        });
        res.on("end", () => {
          if (settled) return;
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            settle(() => reject(new Error(`Ollama returned HTTP ${status}`)));
            return;
          }
          settle(() => resolve(data));
        });
      }
    );

    deadline = setTimeout(() => {
      settle(() => reject(new Error(`Trip summary timeout after ${timeoutMs}ms`)));
      req.destroy();
    }, timeoutMs);

    req.on("error", (err) => settle(() => reject(err)));
    req.write(body);
    req.end();
  });
}

/** The production `GenerateFn`: Ollama's `/api/generate`, non-streaming. */
export const ollamaGenerate: GenerateFn = async (target, { system, prompt }) => {
  const body = JSON.stringify({
    model: target.model,
    system,
    prompt,
    stream: false,
    think: false,
    options: { temperature: 0.6, num_ctx: NUM_CTX },
  });
  const raw = await postJson(`${target.url}/api/generate`, body, getGenerateTimeoutMs());
  const response: unknown = JSON.parse(raw);
  if (typeof response !== "object" || response === null || !("response" in response)) {
    throw new Error("Invalid Ollama response structure");
  }
  const text = (response as Record<string, unknown>).response;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Ollama returned empty summary");
  }
  return text;
};

/** `GET /api/tags` answers within five seconds, or the model is not there. */
export async function checkOllamaAvailable(target: OllamaTarget): Promise<boolean> {
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const parsed = new URL(`${target.url}/api/tags`);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname,
          method: "GET",
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => resolve(data));
        }
      );
      req.setTimeout(5_000, () => req.destroy(new Error("Ollama availability check timeout")));
      req.on("error", reject);
      req.end();
    });
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && "models" in parsed;
  } catch {
    return false;
  }
}

export interface SummariseOptions {
  language: SummaryLanguage;
  target: OllamaTarget;
  /** Test seam. Production leaves it unset and talks to Ollama. */
  generate?: GenerateFn;
}

export interface SummariseResult {
  summary: string;
  model: string;
  language: SummaryLanguage;
  durationMs: number;
}

/**
 * Write the summary for one trip and persist it.
 *
 * The trip is read scoped to the user — a trip id someone else owns is "not
 * found", never a summary of somebody else's holiday.
 */
export async function summariseTrip(
  tripId: string,
  userId: string,
  { language, target, generate = ollamaGenerate }: SummariseOptions
): Promise<SummariseResult> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: TRIP_BRIEF_INCLUDE,
  });
  if (!trip) throw new Error("Trip not found");

  const briefJson = JSON.stringify(briefFromTrip(trip), null, 2);
  const startedAt = Date.now();
  logger.info(
    { model: target.model, url: target.url, tripId, language, briefBytes: briefJson.length },
    "[Trip Summary] Sending brief to Ollama"
  );

  const raw = await generate(target, {
    system: buildSystemPrompt(language),
    prompt: buildUserPrompt(language, briefJson),
  });
  const summary = cleanSummary(raw);
  if (!summary) throw new Error("Ollama returned empty summary");

  const durationMs = Date.now() - startedAt;
  logger.info(
    { tripId, durationMs, chars: summary.length },
    "[Trip Summary] Generated successfully"
  );

  await prisma.trip.update({ where: { id: tripId }, data: { summary } });

  return { summary, model: target.model, language, durationMs };
}
