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
 *
 * Up to four requests run one after another, each allowed 8 s — 32 s, while
 * the web client gives up after 10 s and would call a lookup that later
 * succeeded "unavailable". So the whole lookup has ONE deadline that fits
 * inside the client's timeout, every request gets only what is left of it, and
 * overrunning it throws `StopLookupDeadlineError` — its own reason.
 */
import { z } from "zod";
import { fetchOpenData, OPEN_DATA_TIMEOUT_MS, OpenDataUnavailableError } from "../openData/http";
import { summaryOf, type WikiLanguage, type WikipediaSummary } from "../openData/wikipedia";
import type { StopDomain } from "./ownership";
import { stopImageCredit, type StopImageCredit } from "./stopImageCredit";

/** A station's summary, and whom to credit for its photo (`thumbnailUrl`). */
export type StopSummary = WikipediaSummary & { imageCredit: StopImageCredit | null };

export const GEOSEARCH_RADIUS_M = 500;
const GEOSEARCH_LIMIT = 10;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1_000;
const MAX_EXTRACT_CHARS = 360;
/** Words a station article's title may carry beyond the station's own name ("Bahnhof X Süd"). */
const MAX_EXTRA_WORDS = 1;
/**
 * The whole lookup, all requests together. The web client's request timeout
 * is 10 s (`frontend/src/lib/api/client.ts`); the route's own reads and the
 * network need the rest.
 */
export const STOP_LOOKUP_DEADLINE_MS = 8_000;
/** A request that failed this close to the deadline was cut off by it. */
const DEADLINE_SLACK_MS = 50;

/** The lookup ran out of its overall time — Wikipedia was slow, not absent. */
export class StopLookupDeadlineError extends OpenDataUnavailableError {
  constructor() {
    super("wikipedia");
    this.name = "StopLookupDeadlineError";
  }
}

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

/*
 * Required, not optional: Wikipedia answers "nothing near" as an empty list,
 * and an API error as a 200 with an `error` object and no `query` — which,
 * read leniently, was a miss cached for a day instead of an outage.
 */
const geoSchema = z.object({
  query: z.object({
    geosearch: z.array(z.object({ title: z.string(), dist: z.number().optional() })).max(50),
  }),
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

/** Every word, generic ones kept — "Kiel Hafen" is not "Kiel". */
const fullName = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9ß]+/)
    .filter(Boolean)
    .join(" ");

/** The candidate title that is the stop, or null. Candidates nearest first. */
export function matchStopTitle(
  domain: StopDomain,
  name: string,
  candidates: readonly string[]
): string | null {
  const words = distinctiveWords(name);
  if (words.length === 0) return null;
  let best: { title: string; extra: number } | null = null;
  for (const title of candidates) {
    const titleWords = distinctiveWords(title);
    // Every distinctive word of the stop's name is in the title — "Kiel" in
    // "Kieler Hafen" counts, a shared city name next to another one does not.
    const covers = words.every((w) => titleWords.some((tw) => tw.startsWith(w)));
    if (!covers) continue;
    if (fullName(title) !== fullName(name) && !KIND_WORDS[domain].test(title)) continue;
    // An article ABOUT something at the station ("Messerangriff am Hamburger
    // Hauptbahnhof 2025", found 100 m from the station) carries words the
    // station's own article does not. The fewest extra words wins; more than
    // MAX_EXTRA_WORDS is not the station.
    const extra = titleWords.filter((tw) => !words.some((w) => tw.startsWith(w))).length;
    if (extra > MAX_EXTRA_WORDS) continue;
    if (!best || extra < best.extra) best = { title, extra };
  }
  return best?.title ?? null;
}

/**
 * A period after a short word ("ca.", "lt.", "St.", "bzw.") abbreviates; it
 * does not end the sentence, even before a capital ("lt. Deutscher Bahn").
 */
const ABBREVIATION = /(?:^|[\s(])[\p{L}]{1,3}$/u;

/** The first two sentences, at most MAX_EXTRACT_CHARS — "1–2 sentences" (owner). */
export function firstSentences(extract: string, count = 2): string {
  const text = extract.replace(/\s+/g, " ").trim();
  const boundary = /[.!?]+(?=\s+[\p{Lu}])/gu;
  let end = text.length;
  let found = 0;
  for (let m = boundary.exec(text); m !== null; m = boundary.exec(text)) {
    if (ABBREVIATION.test(text.slice(0, m.index))) continue;
    found += 1;
    if (found === count) {
      end = m.index + m[0].length;
      break;
    }
  }
  const joined = text.slice(0, end).trim();
  return joined.length > MAX_EXTRACT_CHARS
    ? `${joined.slice(0, MAX_EXTRACT_CHARS - 1).trimEnd()}…`
    : joined;
}

const cache = new Map<string, { at: number; value: StopSummary | null }>();

function remember(key: string, value: StopSummary | null): StopSummary | null {
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

async function nearbyTitles(
  lang: WikiLanguage,
  lat: number,
  lon: number,
  timeoutMs: number
): Promise<string[]> {
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
    `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`,
    { timeoutMs }
  );
  if (!outcome.ok) throw new OpenDataUnavailableError("wikipedia");
  const parsed = geoSchema.safeParse(outcome.body);
  if (!parsed.success) throw new OpenDataUnavailableError("wikipedia");
  return parsed.data.query.geosearch.slice(0, GEOSEARCH_LIMIT).map((g) => g.title);
}

/** The summary of the article about the stop, or null when none is confidently it. */
export async function stopWikipediaSummary(
  domain: StopDomain,
  name: string,
  lat: number,
  lon: number,
  lang: WikiLanguage,
  opts: { deadlineMs?: number } = {}
): Promise<StopSummary | null> {
  const key = `${domain}|${lat.toFixed(4)}|${lon.toFixed(4)}|${fold(name)}|${lang}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const deadline = Date.now() + (opts.deadlineMs ?? STOP_LOOKUP_DEADLINE_MS);
  /** One request, given what is left of the deadline (never more than its own 8 s). */
  const step = async <T>(ask: (timeoutMs: number) => Promise<T>): Promise<T> => {
    const left = deadline - Date.now();
    if (left <= 0) throw new StopLookupDeadlineError();
    try {
      return await ask(Math.min(OPEN_DATA_TIMEOUT_MS, left));
    } catch (error) {
      if (error instanceof OpenDataUnavailableError && deadline - Date.now() <= DEADLINE_SLACK_MS)
        throw new StopLookupDeadlineError();
      throw error;
    }
  };

  const editions: WikiLanguage[] = lang === "en" ? ["en"] : [lang, "en"];
  for (const edition of editions) {
    const titles = await step((timeoutMs) => nearbyTitles(edition, lat, lon, timeoutMs));
    const title = matchStopTitle(domain, name, titles);
    if (!title) continue;
    const summary = await step((timeoutMs) => summaryOf(edition, title, { timeoutMs }));
    if (!summary) continue;
    const extract = firstSentences(summary.extract);
    if (!summary.thumbnailUrl) return remember(key, { ...summary, extract, imageCredit: null });
    // The photo's credit gets what is left of the deadline; out of time it is
    // the link to the file page alone, not a failed card.
    const credit = await stopImageCredit(
      edition,
      summary.thumbnailUrl,
      Math.min(OPEN_DATA_TIMEOUT_MS, deadline - Date.now())
    );
    if (credit === "nonFree" || credit === null) {
      return remember(key, { ...summary, extract, thumbnailUrl: null, imageCredit: null });
    }
    return remember(key, { ...summary, extract, imageCredit: credit });
  }
  return remember(key, null);
}
