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

/**
 * The rules, and why each is worded the way it is (measured 2026-09-17 on
 * gemma3:12b with three real-shaped trips):
 *
 * - The first version asked for the trip's OCCASION in the first paragraph and
 *   for MOOD, VERDICT and OUTLOOK in the third. The data holds none of those,
 *   so the model supplied them: "a bit spontaneous", "a trip we had wanted for
 *   years", "left feeling accomplished", "already planning to come back". In a
 *   personal travel diary an invented motive reads as wrong, not as warm. Both
 *   now appear only when the notes, the journal or the tags say so.
 * - "you or I, whichever the data suggests" produced "You took a business
 *   trip" in English and "ich" and "wir" in one German text. The perspective
 *   is decided here, from the companions, and handed to the model as a fact
 *   (`perspective` in the brief).
 * - Airport codes leaked into the prose ("from MUC to HND"). Cities, never codes.
 * - Told not to invent an occasion, the second version wrote "no particular
 *   reason is known" instead — naming a rule's subject invites a sentence
 *   about it. Rule 6 now names the phrasing it forbids.
 * - It counted "five days and six nights" for 12-17 April. A language model
 *   is not a calculator: nights are computed here (`nights` on the trip and
 *   each stay) and the prompt forbids computing them.
 * - With little data it padded ("a straightforward journey", "a successful
 *   business trip"). Two paragraphs are allowed now, and verdicts are named
 *   as invention.
 * - The third version described the DATA instead of the trip: "was categorized
 *   as a road trip", "the order of the stops was Lisbon, Pastéis de Belém,
 *   Sintra" — a bakery is not a stop.
 * - Forbidding those by name made it worse, which is the lesson this file
 *   keeps: a 12B model picks up the words a prohibition uses. The fourth
 *   version, with eleven rules and six of them negative, answered "according
 *   to the data", "described in the data as" and "the data does not contain
 *   information about any other stops". The rules are positive instructions
 *   now, and short: say what to write, not what to avoid.
 * - What no wording fixed: "I embarked on this journey alone, with no
 *   companions joining me" for an empty companion list, and a miscounted
 *   route ("three nights in Lisbon and two in the Pestana Palace" — a hotel
 *   is not a city). Both are now impossible rather than discouraged:
 *   `compactBrief` DROPS every empty field before the brief is sent, so
 *   there is no absence to remark on, and the closing line with the route and
 *   the nights is written by `routeLine` in code. The model narrates; it does
 *   not count and it does not summarise.
 * - qwen3:30b-a3b was measured against the same four trips: 48-138 s per
 *   summary, one timeout at 180 s, and it emitted its reasoning. Not a
 *   candidate for a screen someone is waiting in front of.
 */
/**
 * Rules 3 and 4 in two versions, because a trip without a single note or
 * journal entry must not be told that impressions live in "notes" and
 * "journal".
 *
 * Measured 2026-09-18 on the 2.7.0-beta.1 build against gemma3:12b, on a trip
 * whose only free text was a flight note reading "UAT beta.3 test flight" — no
 * trip notes, no journal, no stays. Twice in a row the model manufactured the
 * fields it had been told to retell, and labelled them so they read as quotes:
 * `*notes: Der Flug war überraschend ruhig, Nora hat fast die ganze Zeit
 * geschlafen.*`, `"Journal: New York hat uns sofort in seinen Bann gezogen"`,
 * and a hotel on a trip with no stay. Given a REAL journal entry the same
 * build wrote a clean summary, so the trigger is the absence, not the model.
 *
 * `compactBrief` already drops the empty keys from the DATA — that is the same
 * lesson one level down. What stayed was the prompt still naming them, which
 * is an instruction to write something the brief cannot support.
 *
 * The fix is a removal, not a prohibition, and deliberately so: the file
 * header records that a 12B model picks up the words a prohibition uses, and
 * that the fourth version of these rules answered "the data does not contain
 * information about any other stops" precisely because it had been told not
 * to. So when there is no voice, the words "notes" and "journal" do not appear
 * in the prompt at all.
 */
const VOICE_RULES: Record<SummaryLanguage, Record<"withVoice" | "withoutVoice", string>> = {
  de: {
    withVoice: `3. Absatz 2: die Stationen in zeitlicher Reihenfolge, mit den Namen aus den Daten — Hotels, Orte, Stopps — und "notes" sowie "journal" frei nacherzählt.
4. Du erzählst ausschließlich, was in den Daten steht. Eindrücke und Urteile stehen in "notes" und "journal"; sonst bleibt der Text bei dem, was geschehen ist.`,
    withoutVoice: `3. Absatz 2: die Stationen in zeitlicher Reihenfolge, mit den Namen aus den Daten — Hotels, Orte, Stopps.
4. Du erzählst ausschließlich, was in den Daten steht: was geschehen ist, wann und wo.`,
  },
  en: {
    withVoice: `3. Paragraph 2: the stops in order of time, with the names from the data — hotels, places, stops — and "notes" and "journal" retold freely.
4. You retell only what the data holds. Impressions and verdicts live in "notes" and "journal"; otherwise the text stays with what happened.`,
    withoutVoice: `3. Paragraph 2: the stops in order of time, with the names from the data — hotels, places, stops.
4. You retell only what the data holds: what happened, when and where.`,
  },
};

const SYSTEM_PROMPTS: Record<SummaryLanguage, (voiceRules: string) => string> = {
  de: (
    voiceRules
  ) => `Du schreibst ein Reisetagebuch. Du erhältst die Daten einer Reise und erzählst sie nach.

SO SCHREIBST DU:
1. Zwei Absätze Fließtext, je 2-4 Sätze, ohne Markdown und ohne Listen.
2. Absatz 1: Zeitraum und Ziel der Reise, und wer mitgereist ist.
${voiceRules}
5. "perspective" bestimmt die Person: "we" → „wir", "I" → „ich", durchgehend.
6. Städtenamen statt Flughafencodes.
7. "status": "completed" → Vergangenheit, "in_progress" → Gegenwart, "planned" → Zukunft.
8. Sprache: Deutsch, lockerer Reisetagebuch-Ton.
9. Antworte nur mit den zwei Absätzen, ohne Überschrift und ohne Anführungszeichen.`,
  en: (
    voiceRules
  ) => `You write a travel diary. You are given the data of one trip and you retell it.

HOW YOU WRITE:
1. Two paragraphs of prose, 2-4 sentences each, without markdown and without lists.
2. Paragraph 1: when the trip was and where to, and who came along.
${voiceRules}
5. "perspective" sets the person: "we" → "we", "I" → "I", throughout.
6. City names instead of airport codes.
7. "status": "completed" → past tense, "in_progress" → present, "planned" → future.
8. Language: English, relaxed travel-diary tone.
9. Answer with the two paragraphs only, no heading and no quotation marks.`,
};

// The count is not repeated here. It used to say "3-Absatz"/"3-paragraph"
// while rules 1 and 9 asked for two, and the model was left to settle the
// contradiction — measured on 2026-09-18, it answered with three paragraphs
// twice and two once. One statement of the shape, in the rules.
const USER_PROMPTS: Record<SummaryLanguage, (briefJson: string) => string> = {
  de: (briefJson) =>
    `Reisedaten:\n${briefJson}\n\nSchreibe die Zusammenfassung dieser Reise nach den Regeln im System-Prompt.`,
  en: (briefJson) =>
    `Trip data:\n${briefJson}\n\nWrite the summary of this trip following the rules in the system prompt.`,
};

/**
 * Does this trip say anything in its own words?
 *
 * True when the traveller wrote something anywhere the brief carries: the trip
 * notes, a stay's notes, a place visit's notes, or a journal entry. It is the
 * one question the prompt needs, so it is asked once and here.
 */
export function briefHasVoice(brief: SummaryBrief): boolean {
  if (brief.notes) return true;
  if (brief.journal.length > 0) return true;
  if (brief.stays.some((s) => s.notes)) return true;
  return brief.places.some((p) => p.notes);
}

export function buildSystemPrompt(language: SummaryLanguage, hasVoice = true): string {
  const rules = VOICE_RULES[language][hasVoice ? "withVoice" : "withoutVoice"];
  return SYSTEM_PROMPTS[language](rules);
}

export function buildUserPrompt(language: SummaryLanguage, briefJson: string): string {
  return USER_PROMPTS[language](briefJson);
}

export interface SummaryBrief {
  name: string;
  /** Nights from start to end, computed here — the model must never count. */
  nights: number | null;
  /** Whose diary this is: "we" when companions travelled along, otherwise "I". */
  perspective: "we" | "I";
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
    nights: number | null;
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

const DAY_MS = 86_400_000;
/** Whole nights between two calendar days, or null when either is unknown. */
const nightsBetween = (
  from: Date | null | undefined,
  to: Date | null | undefined
): number | null =>
  from && to
    ? Math.max(0, Math.round((Date.parse(isoDate(to)!) - Date.parse(isoDate(from)!)) / DAY_MS))
    : null;

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
    nights: nightsBetween(trip.startDate, trip.endDate),
    category: trip.category ?? null,
    startDate: isoDate(trip.startDate),
    endDate: isoDate(trip.endDate),
    origin: trip.originLabel ?? null,
    destination: trip.destinationLabel ?? null,
    countries: trip.countries ?? [],
    companions: trip.companions ?? [],
    perspective: (trip.companions ?? []).length > 0 ? "we" : "I",
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
      nights: nightsBetween(s.checkIn, s.checkOut),
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
 * The brief with every empty field removed.
 *
 * A field that is not there cannot be talked about. With `companions: []` in
 * the JSON, gemma3 wrote "I embarked on this journey alone, with no companions
 * joining me" — an absence stated as a fact about the trip. No wording of the
 * rules stopped that; dropping the key did.
 */
export function compactBrief(brief: SummaryBrief): Record<string, unknown> {
  const keep = (value: unknown): boolean =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    !(Array.isArray(value) && value.length === 0);
  const clean = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(clean)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([, v]) => keep(v))
              .map(([k, v]) => [k, clean(v)])
          )
        : value;
  return clean(brief) as Record<string, unknown>;
}

/**
 * The closing line: the cities in the order they were visited, and the nights.
 *
 * Written here rather than asked for, because the model got it wrong in every
 * shape the prompt took — counting nights itself ("five days and six nights"
 * for five) and listing a bakery and a hotel as stops on the route. Code has
 * the dates and the city names; it cannot miscount them.
 */
export function routeLine(brief: SummaryBrief, language: SummaryLanguage): string {
  const cities: string[] = [];
  for (const city of [
    ...brief.stays.map((s) => s.city),
    ...brief.places.map((p) => p.city),
    brief.destination,
  ]) {
    if (city && !cities.includes(city)) cities.push(city);
  }
  if (cities.length === 0 || brief.nights === null) return "";
  const route = cities.join(" – ");
  return language === "de"
    ? `Route: ${route}. ${brief.nights} ${brief.nights === 1 ? "Nacht" : "Nächte"}.`
    : `Route: ${route}. ${brief.nights} ${brief.nights === 1 ? "night" : "nights"}.`;
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

  const brief = briefFromTrip(trip);
  const briefJson = JSON.stringify(compactBrief(brief), null, 2);
  const startedAt = Date.now();
  logger.info(
    { model: target.model, url: target.url, tripId, language, briefBytes: briefJson.length },
    "[Trip Summary] Sending brief to Ollama"
  );

  const raw = await generate(target, {
    system: buildSystemPrompt(language, briefHasVoice(brief)),
    prompt: buildUserPrompt(language, briefJson),
  });
  const narrated = cleanSummary(raw);
  if (!narrated) throw new Error("Ollama returned empty summary");
  // The route and the nights are ours, not the model's — see `routeLine`.
  const closing = routeLine(brief, language);
  const summary = closing
    ? `${narrated}

${closing}`
    : narrated;

  const durationMs = Date.now() - startedAt;
  logger.info(
    { tripId, durationMs, chars: summary.length },
    "[Trip Summary] Generated successfully"
  );

  await prisma.trip.update({ where: { id: tripId }, data: { summary } });

  return { summary, model: target.model, language, durationMs };
}
