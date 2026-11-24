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
/** Asked of the search: more than shown, since the brand filter drops the surnames and craters. */
const SEARCH_LIMIT = 25;

/**
 * What makes an item a brand here (UAT rc.45): the search offered surnames and moon craters for
 * "McDonald", and a rule pinned to one matches nothing. An item counts when it is an instance of
 * one of these classes (each verified on Wikidata 2026-11-24) …
 */
const BRAND_CLASSES: ReadonlySet<string> = new Set([
  "Q431289", // brand
  "Q507619", // retail chain
  "Q1631129", // hotel chain
  "Q18509232", // fast food restaurant chain
  "Q4830453", // business
  "Q783794", // company
  "Q891723", // public company
  "Q6881511", // enterprise
]);
/** … or carries a property only an organisation or a brand has. */
const BRAND_PROPERTIES = ["P1454", "P3113", "P1716"] as const; // legal form, does not have part, brand
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; hits: BrandHit[] }>();

export const clearBrandSearchCache = (): void => cache.clear();

const claimsSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      claims: z
        .record(
          z.string(),
          z.array(
            z.object({
              mainsnak: z.object({
                datavalue: z.object({ value: z.unknown() }).optional(),
              }),
            })
          )
        )
        .optional(),
    })
  ),
});

type Claims = NonNullable<z.infer<typeof claimsSchema>["entities"][string]["claims"]>;

/** Whether an item's claims say it is a brand or a chain (see `BRAND_CLASSES`). */
export function isBrandItem(claims: Claims | undefined): boolean {
  if (!claims) return false;
  if (BRAND_PROPERTIES.some((p) => (claims[p]?.length ?? 0) > 0)) return true;
  return (claims.P31 ?? []).some((c) => {
    const value = c.mainsnak.datavalue?.value as { id?: unknown } | undefined;
    return typeof value?.id === "string" && BRAND_CLASSES.has(value.id);
  });
}

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
    limit: String(SEARCH_LIMIT),
    format: "json",
  });
  const outcome = await fetchOpenData(
    "wikidata",
    `https://www.wikidata.org/w/api.php?${params.toString()}`
  );
  if (!outcome.ok) return { ok: false, reason: outcome.failure };
  const parsed = searchSchema.safeParse(outcome.body);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const found = parsed.data.search.flatMap((s) =>
    s.label ? [{ id: s.id, label: s.label, description: s.description ?? null }] : []
  );
  const brands = await brandIdsOf(found.map((h) => h.id));
  if (!brands.ok) return brands;
  const hits = found.filter((h) => brands.ids.has(h.id)).slice(0, HIT_LIMIT);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), hits });
  return { ok: true, hits };
}

/**
 * The ids among `ids` that are brands, read from their claims in ONE request. A failed read is a
 * failure of the search, never "no brands" and never the unfiltered list.
 */
async function brandIdsOf(
  ids: string[]
): Promise<{ ok: true; ids: Set<string> } | { ok: false; reason: BrandSearchFailure }> {
  if (ids.length === 0) return { ok: true, ids: new Set() };
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "claims",
    format: "json",
  });
  const outcome = await fetchOpenData(
    "wikidata",
    `https://www.wikidata.org/w/api.php?${params.toString()}`
  );
  if (!outcome.ok) return { ok: false, reason: outcome.failure };
  const parsed = claimsSchema.safeParse(outcome.body);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  return {
    ok: true,
    ids: new Set(ids.filter((id) => isBrandItem(parsed.data.entities[id]?.claims))),
  };
}
