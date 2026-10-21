/**
 * A photo and the opening sentences of the Wikipedia article about a station,
 * terminal, port or rental branch — for the map's point card (2026-10-21).
 *
 * A station row carries no Wikidata item, so the article is found by PLACE
 * and confirmed by NAME, never by name alone (`wikipedia.ts`: "Hotel Post"
 * names a hundred houses):
 *
 * 1. Wikipedia's geosearch around the point — at most 10 articles within
 *    500 m, nearest first.
 * 2. Keep an article only when its title carries every distinctive word of the
 *    stop's name ("Hamburg" in "Hamburg Hbf" / "Hamburg Hauptbahnhof") AND
 *    names a transport place (Bahnhof, station, Hafen, terminal, …) or equals
 *    the name. The Kunsthalle next door shares the city's name, not the kind.
 * 3. Its REST summary (text CC BY-SA, credited and linked by the client),
 *    trimmed to its first two sentences.
 *
 * The reader's edition first, English as the fallback. A miss is remembered
 * for a day; an outage throws `OpenDataUnavailableError` and is not cached.
 */
import { z } from "zod";
import { fetchOpenData, OpenDataUnavailableError } from "../openData/http";
import { summaryOf, type WikiLanguage, type WikipediaSummary } from "../openData/wikipedia";
import type { StopDomain } from "./ownership";

export const GEOSEARCH_RADIUS_M = 500;
const GEOSEARCH_LIMIT = 10;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1_000;
const MAX_EXTRACT_CHARS = 360;

/** Words that name the kind of place, not WHICH one — never a distinctive match. */
const GENERIC = new Set([
  "hbf",
  "hauptbahnhof",
  "bahnhof",
  "bf",
  "station",
  "railway",
  "train",
  "central",
  "centraal",
  "gare",
  "estacion",
  "estação",
  "stazione",
  "zob",
  "busbahnhof",
  "bus",
  "terminal",
  "terminus",
  "coach",
  "port",
  "porto",
  "puerto",
  "hafen",
  "fährhafen",
  "fähranleger",
  "ferry",
  "ferries",
  "harbour",
  "harbor",
  "pier",
  "quay",
  "airport",
  "flughafen",
  "aeropuerto",
  "aeroporto",
  "the",
  "of",
  "de",
  "del",
  "la",
  "le",
  "am",
  "an",
  "der",
  "die",
  "das",
  "und",
  "and",
  "st",
  "sankt",
  "intl",
  "international",
  "sixt",
  "hertz",
  "avis",
  "europcar",
  "enterprise",
  "rental",
  "car",
]);

/** Title words that make an article a transport place, per domain. */
const KIND_WORDS: Record<StopDomain, RegExp> = {
  rail: /(bahnhof|hbf|station|gare|estaci|stazione|haltepunkt|bahnstation|railway)/i,
  bus: /(busbahnhof|zob|bus|station|terminal|coach)/i,
  ferry: /(hafen|port|porto|puerto|harbou?r|ferry|fähr|terminal|pier|quay|kai|anleger)/i,
  rental: /(airport|flughafen|aeroporto|aeropuerto|aéroport|bahnhof|hbf|station|gare)/i,
};

const geoSchema = z.object({
  query: z
    .object({
      geosearch: z
        .array(z.object({ title: z.string(), dist: z.number().optional() }))
        .max(50)
        .optional(),
    })
    .optional(),
});

/** Lower-case words of a name, accents folded, generic words dropped. */
export function distinctiveWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ß]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
}

const fold = (s: string): string => distinctiveWords(s).join(" ");

/** The candidate title that is the stop, or null. Candidates nearest first. */
export function matchStopTitle(
  domain: StopDomain,
  name: string,
  candidates: readonly string[]
): string | null {
  const words = distinctiveWords(name);
  if (words.length === 0) return null;
  for (const title of candidates) {
    const titleWords = distinctiveWords(title);
    // Every distinctive word of the stop's name is in the title — "Kiel" in
    // "Kieler Hafen" counts, a shared city name next to another one does not.
    const covers = words.every((w) => titleWords.some((tw) => tw.startsWith(w)));
    if (!covers) continue;
    if (fold(title) === fold(name) || KIND_WORDS[domain].test(title)) return title;
  }
  return null;
}

/** The first two sentences, at most MAX_EXTRACT_CHARS — "1–2 sentences" (owner). */
export function firstSentences(extract: string, count = 2): string {
  const text = extract.replace(/\s+/g, " ").trim();
  const parts = text.match(/[^.!?]+[.!?]+(?=\s+[A-ZÄÖÜÀ-Ý]|\s*$)|[^.!?]+$/g) ?? [text];
  const joined = parts.slice(0, count).join("").trim();
  return joined.length > MAX_EXTRACT_CHARS
    ? `${joined.slice(0, MAX_EXTRACT_CHARS - 1).trimEnd()}…`
    : joined;
}

const cache = new Map<string, { at: number; value: WikipediaSummary | null }>();

function remember(key: string, value: WikipediaSummary | null): WikipediaSummary | null {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

export function __clearStopWikipediaCache(): void {
  cache.clear();
}

async function nearbyTitles(lang: WikiLanguage, lat: number, lon: number): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${lat.toFixed(5)}|${lon.toFixed(5)}`,
    gsradius: String(GEOSEARCH_RADIUS_M),
    gslimit: String(GEOSEARCH_LIMIT),
    format: "json",
  });
  const outcome = await fetchOpenData(
    "wikipedia",
    `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`
  );
  if (!outcome.ok) throw new OpenDataUnavailableError("wikipedia");
  const parsed = geoSchema.safeParse(outcome.body);
  if (!parsed.success) throw new OpenDataUnavailableError("wikipedia");
  return (parsed.data.query?.geosearch ?? []).slice(0, GEOSEARCH_LIMIT).map((g) => g.title);
}

/** The summary of the article about the stop, or null when none is confidently it. */
export async function stopWikipediaSummary(
  domain: StopDomain,
  name: string,
  lat: number,
  lon: number,
  lang: WikiLanguage
): Promise<WikipediaSummary | null> {
  const key = `${domain}|${lat.toFixed(4)}|${lon.toFixed(4)}|${fold(name)}|${lang}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const editions: WikiLanguage[] = lang === "en" ? ["en"] : [lang, "en"];
  for (const edition of editions) {
    const title = matchStopTitle(domain, name, await nearbyTitles(edition, lat, lon));
    if (!title) continue;
    const summary = await summaryOf(edition, title);
    if (summary) return remember(key, { ...summary, extract: firstSentences(summary.extract) });
  }
  return remember(key, null);
}
