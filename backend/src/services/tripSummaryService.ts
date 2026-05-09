import http from "http";
import https from "https";
import { prisma } from "../db";
import logger from "../utils/logger";

/**
 * LLM-generated trip summaries (Phase-1 iteration 9).
 *
 * Builds a compact narrative brief from a trip's flights, cruises,
 * stops, and journal entries, then asks gemma3:12b (the same model used
 * by the cruise parser — see cruiseBookingParser.ts) to produce a
 * 3-paragraph travel-blog-style summary in German. Result is persisted
 * onto `trip.summary` so it survives across page loads and isn't
 * regenerated on every visit.
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:12b";
const GENERATE_TIMEOUT_MS = 180_000;

const SYSTEM_PROMPT = `Du bist ein Reisetagebuch-Autor. Aus den strukturierten Reisedaten schreibst du eine warme, persönliche Zusammenfassung.

REGELN:
1. Genau 3 Absätze, je 2-4 Sätze. KEIN Markdown, KEINE Listen, KEINE Aufzählungen.
2. Erster Absatz: Reisezeitpunkt + Hauptziel + Anlass.
3. Zweiter Absatz: konkrete Erlebnisse aus den Stopps und Tagebucheinträgen — bevorzuge Eigennamen aus den Daten (Orte, Hotels, Sehenswürdigkeiten) statt generischer Floskeln.
4. Dritter Absatz: Stimmung / Bilanz / Ausblick.
5. Sprache: Deutsch, lockerer Reisetagebuch-Ton, „du" oder „ich" je nachdem was die Daten nahelegen — nicht beides mischen.
6. Erfinde NICHTS, was nicht in den Daten steht. Wenn ein Aspekt fehlt, lass ihn weg statt zu spekulieren.
7. Antworte NUR mit dem Fließtext. Keine Überschrift, keine Anführungszeichen, kein Vorwort.`;

interface SummaryBrief {
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
  stops: Array<{ title: string; domain: string | null; start: string | null }>;
  journal: Array<{ date: string; title: string | null; body: string }>;
  notes: string | null;
}

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
    req.setTimeout(GENERATE_TIMEOUT_MS, () =>
      req.destroy(new Error(`Ollama request timeout after ${GENERATE_TIMEOUT_MS}ms`)),
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

export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetchGet(`${OLLAMA_URL}/api/tags`);
    const parsed: unknown = JSON.parse(res);
    return typeof parsed === "object" && parsed !== null && "models" in parsed;
  } catch {
    return false;
  }
}

async function buildBrief(tripId: string, userId: string): Promise<SummaryBrief | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      flights: { orderBy: { departureTime: "asc" } },
      cruises: { orderBy: { startDate: "asc" } },
      stops: { orderBy: [{ orderIdx: "asc" }, { startDate: "asc" }] },
      journalEntries: { orderBy: { date: "asc" } },
    },
  });
  if (!trip) return null;

  const isoDate = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null;

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
    stops: trip.stops.map((s) => ({
      title: s.title,
      domain: s.domain ?? null,
      start: isoDate(s.startDate),
    })),
    // Cap each journal body so the brief stays under the model's context.
    journal: trip.journalEntries.map((j) => ({
      date: j.date.toISOString().slice(0, 10),
      title: j.title ?? null,
      body: j.body.slice(0, 600),
    })),
    notes: trip.notes ? trip.notes.slice(0, 1000) : null,
  };
}

export interface SummariseResult {
  summary: string;
  model: string;
  durationMs: number;
}

export async function summariseTrip(
  tripId: string,
  userId: string,
): Promise<SummariseResult> {
  const brief = await buildBrief(tripId, userId);
  if (!brief) throw new Error("Trip not found");

  const briefJson = JSON.stringify(brief, null, 2);
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    system: SYSTEM_PROMPT,
    prompt: `Reisedaten:\n${briefJson}\n\nSchreibe die 3-Absatz-Zusammenfassung dieser Reise nach den Regeln im System-Prompt.`,
    stream: false,
    think: false,
    options: { temperature: 0.6, num_ctx: 8192 },
  });

  const startedAt = Date.now();
  logger.info(
    { model: OLLAMA_MODEL, url: OLLAMA_URL, tripId, briefBytes: briefJson.length },
    "[Trip Summary] Sending brief to Ollama",
  );

  const raw = await fetchJson(`${OLLAMA_URL}/api/generate`, body);
  const response: unknown = JSON.parse(raw);
  if (typeof response !== "object" || response === null || !("response" in response)) {
    throw new Error("Invalid Ollama response structure");
  }
  const responseText = (response as Record<string, unknown>).response;
  if (typeof responseText !== "string" || !responseText.trim()) {
    throw new Error("Ollama returned empty summary");
  }

  const cleaned = responseText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  const durationMs = Date.now() - startedAt;
  logger.info(
    { tripId, durationMs, chars: cleaned.length },
    "[Trip Summary] Generated successfully",
  );

  await prisma.trip.update({
    where: { id: tripId },
    data: { summary: cleaned },
  });

  return { summary: cleaned, model: OLLAMA_MODEL, durationMs };
}
