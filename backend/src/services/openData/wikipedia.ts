import { z } from "zod";

import { fetchOpenDataJsonDetailed, OpenDataUnavailableError } from "./http";

/**
 * A Wikipedia summary for a Wikidata item, in the reader's language.
 *
 * The article is reached through the item's sitelinks, never by searching a
 * name: "Hotel Post" names a hundred houses, and a confident summary of the
 * wrong one is worse than none. Text is CC BY-SA and shown with its source.
 */

export const WIKI_LANGUAGES = ["de", "en"] as const;
export type WikiLanguage = (typeof WIKI_LANGUAGES)[number];

export interface WikipediaSummary {
  title: string;
  extract: string;
  thumbnailUrl: string | null;
  pageUrl: string;
  /** The edition the text came from — the reader's, or English as fallback. */
  lang: WikiLanguage;
}

const QID = /^Q[1-9]\d*$/;

export function isWikidataId(value: unknown): value is string {
  return typeof value === "string" && QID.test(value);
}

/** The first Q-id inside a string, e.g. a curated item id "biosphere-reserves:Q16058035". */
export function wikidataIdIn(value: string | null | undefined): string | null {
  const match = value?.match(/\bQ[1-9]\d*\b/);
  return match ? match[0] : null;
}

const sitelinksSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      sitelinks: z.record(z.string(), z.object({ title: z.string() })).optional(),
    })
  ),
});

const summarySchema = z.object({
  type: z.string(),
  title: z.string(),
  extract: z.string(),
  thumbnail: z.object({ source: z.string().url() }).optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string().url() }) }),
});

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: WikipediaSummary | null }>();

function remember(key: string, value: WikipediaSummary | null): WikipediaSummary | null {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Throws `OpenDataUnavailableError` when Wikidata does not answer usefully. */
async function articleTitles(qid: string): Promise<Partial<Record<WikiLanguage, string>>> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: qid,
    props: "sitelinks",
    sitefilter: WIKI_LANGUAGES.map((l) => `${l}wiki`).join("|"),
    format: "json",
  });
  const outcome = await fetchOpenDataJsonDetailed(
    "wikidata",
    `https://www.wikidata.org/w/api.php?${params.toString()}`
  );
  if (!outcome.ok) throw new OpenDataUnavailableError("wikidata");
  const parsed = sitelinksSchema.safeParse(outcome.body);
  if (!parsed.success) throw new OpenDataUnavailableError("wikidata");
  const links = parsed.data.entities[qid]?.sitelinks ?? {};
  return Object.fromEntries(
    WIKI_LANGUAGES.flatMap((l) => (links[`${l}wiki`] ? [[l, links[`${l}wiki`].title]] : []))
  );
}

/**
 * Null when the article answers with nothing to show (404, a disambiguation
 * page, no extract); throws `OpenDataUnavailableError` when Wikipedia did not
 * answer at all — the two used to be the same null, and a network blip was
 * then cached for a day as "this item has no article".
 */
async function summaryOf(lang: WikiLanguage, title: string): Promise<WikipediaSummary | null> {
  const path = encodeURIComponent(title.replace(/ /g, "_"));
  const outcome = await fetchOpenDataJsonDetailed(
    "wikipedia",
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${path}`
  );
  if (!outcome.ok) {
    if (outcome.status === 404) return null;
    throw new OpenDataUnavailableError("wikipedia");
  }
  const parsed = summarySchema.safeParse(outcome.body);
  // A disambiguation page is a list of other articles, not a description.
  if (!parsed.success || parsed.data.type === "disambiguation" || !parsed.data.extract) {
    return null;
  }
  return {
    title: parsed.data.title,
    extract: parsed.data.extract,
    thumbnailUrl: parsed.data.thumbnail?.source ?? null,
    pageUrl: parsed.data.content_urls.desktop.page,
    lang,
  };
}

/**
 * The summary of `qid` in `lang`, falling back to English when the item has
 * no article in the reader's language. Cached for a day, misses included, so
 * an item without any article is not asked about on every page view. A
 * service that did not answer throws `OpenDataUnavailableError` and is NOT
 * cached — the next view asks again.
 */
export async function wikipediaSummary(
  qid: string,
  lang: WikiLanguage
): Promise<WikipediaSummary | null> {
  const key = `${qid}|${lang}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const titles = await articleTitles(qid);
  const order: WikiLanguage[] = lang === "en" ? ["en"] : [lang, "en"];
  for (const edition of order) {
    const title = titles[edition];
    if (!title) continue;
    const summary = await summaryOf(edition, title);
    if (summary) return remember(key, summary);
  }
  return remember(key, null);
}

/** Test seam: forget every cached summary. */
export function clearWikipediaCache(): void {
  cache.clear();
}
