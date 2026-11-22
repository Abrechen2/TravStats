/**
 * Brand search for smart lists: the owner types a chain's name and picks it from Wikidata's items,
 * so the rule holds a real `brand:wikidata` id and never a hand-typed Q-number or a name guess.
 *
 * Goes through the open-data service of the external-services catalogue (`openData`: its instance
 * switch and the internet master switch) and its shared HTTP client. A service that did not answer
 * is reported by its reason (`timeout | rateLimited | unavailable | malformed | disabled`) and is
 * NEVER cached or turned into "no hits": an empty list means Wikidata answered with nothing.
 */
import { z } from "zod";
import { fetchOpenData, isOpenDataEnabled, type OpenDataFailure } from "../openData/http";

export type BrandHit = { id: string; label: string; description: string | null };
export type BrandSearchFailure = OpenDataFailure | "malformed" | "disabled";
export type BrandSearchResult =
  { ok: true; hits: BrandHit[] } | { ok: false; reason: BrandSearchFailure };

const HIT_LIMIT = 8;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; hits: BrandHit[] }>();

export const clearBrandSearchCache = (): void => cache.clear();

const searchSchema = z.object({
  search: z.array(
    z.object({
      id: z.string().regex(/^Q[1-9]\d*$/),
      label: z.string().optional(),
      description: z.string().optional(),
    })
  ),
});

export async function searchBrands(query: string, lang: "de" | "en"): Promise<BrandSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: true, hits: [] };
  if (!(await isOpenDataEnabled())) return { ok: false, reason: "disabled" };
  const key = `${lang}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, hits: hit.hits };
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: q,
    language: lang,
    uselang: lang,
    type: "item",
    limit: String(HIT_LIMIT),
    format: "json",
  });
  const outcome = await fetchOpenData(
    "wikidata",
    `https://www.wikidata.org/w/api.php?${params.toString()}`
  );
  if (!outcome.ok) return { ok: false, reason: outcome.failure };
  const parsed = searchSchema.safeParse(outcome.body);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const hits = parsed.data.search.flatMap((s) =>
    s.label ? [{ id: s.id, label: s.label, description: s.description ?? null }] : []
  );
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), hits });
  return { ok: true, hits };
}
