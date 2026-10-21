/**
 * An operator's logo from Wikidata and Wikimedia Commons (forgejo#323).
 *
 * 1. Search Wikidata for the name the user wrote, and keep only items whose
 *    label or alias IS that name — never the first fuzzy hit, which for
 *    "Color Line" could as well be an article about colour theory. A logo
 *    from the wrong company is worse than the monogram.
 * 2. Of those, the first with a logo image (P154; P8972 small logo as the
 *    fallback), honouring statement ranks: preferred first, deprecated never.
 *    The official colour (P465) comes along where the item has one.
 * 3. Ask Commons about the file: only a FREE licence is accepted (public
 *    domain, CC0, CC BY, CC BY-SA), never a file flagged non-free; licence,
 *    author and the file page are kept, so the card can credit it.
 * 4. Take Commons' own PNG rendering of the file (`thumburl`). A logo is
 *    almost always an SVG, and an SVG from a third party is markup that could
 *    carry script — the rasterised thumbnail is a picture and nothing else.
 *
 * Every miss says why, for the log; the caller turns any miss into "no logo".
 */
import { z } from "zod";
import { getBytes, getJson, type WikimediaFailure } from "./wikimedia";
import { normalizeProviderName } from "../rentalProviders/providerCatalog";

/** `malformed`: Wikimedia answered 200 with JSON of a shape this reader does not know. */
export type OperatorMarkMiss =
  WikimediaFailure | "noItem" | "noLogo" | "licence" | "badImage" | "malformed";

export interface OperatorMarkCredit {
  /** The Wikidata item the logo was read from, e.g. "Q833903". */
  qid: string;
  /** The Commons file name, without the "File:" prefix. */
  file: string;
  /** Short licence name as Commons states it, e.g. "Public domain", "CC BY-SA 4.0". */
  licence: string;
  licenceUrl: string | null;
  /** The author as Commons names them, plain text; null when not stated. */
  artist: string | null;
  /** The file's page on Commons — where the full credit lives. */
  sourceUrl: string;
  /** The operator's official colour (P465), `#rrggbb`, or null. */
  colour: string | null;
}

export interface OperatorMarkImage {
  body: Buffer;
  contentType: string;
}

export type OperatorMarkLookup =
  | { ok: true; credit: OperatorMarkCredit; image: OperatorMarkImage }
  | { ok: false; reason: OperatorMarkMiss };

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** Commons renders the thumbnail at its nearest step; ~128 px is a card tile at 2×. */
const THUMB_WIDTH = 128;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * The free licences a logo may carry here. Matched on Commons' machine-readable
 * `License` template name (`pd`, `cc0`, `cc-by-4.0`, `cc-by-sa-3.0`, …).
 * Anything else — fair use, a non-commercial or no-derivatives licence, an
 * unknown template — is refused rather than guessed at.
 */
const FREE_LICENCE = /^(pd|cc0|cc-by-[\d.]+|cc-by-sa-[\d.]+)(-|$)/i;

/*
 * The remote answers, validated before they are read: a 200 with JSON of
 * another shape (`null`, `{"search":[null]}`) used to throw a TypeError out of
 * the lookup — and out of a background refresh with nobody to catch it.
 * Only the fields read here are declared; everything else is ignored.
 */
const snakSchema = z.object({
  rank: z.string().optional(),
  mainsnak: z
    .object({ datavalue: z.object({ value: z.unknown() }).partial().optional() })
    .optional(),
});
const claimsSchema = z.record(z.string(), z.array(snakSchema).optional());
const searchSchema = z.object({
  search: z
    .array(
      z.object({
        id: z.unknown(),
        match: z.object({ text: z.string().optional() }).optional(),
      })
    )
    .optional(),
});
const entitiesSchema = z.object({
  entities: z
    .record(z.string(), z.object({ claims: claimsSchema.optional() }).nullable())
    .optional(),
});
const commonsSchema = z.object({
  query: z
    .object({
      pages: z
        .record(
          z.string(),
          z.object({
            imageinfo: z
              .array(
                z.object({
                  thumburl: z.string().optional(),
                  descriptionurl: z.string().optional(),
                  extmetadata: z
                    .record(z.string(), z.object({ value: z.unknown() }).partial().optional())
                    .optional(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

type Snak = z.infer<typeof snakSchema>;
type Claims = Record<string, Snak[] | undefined>;

function url(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams({ format: "json", maxlag: "5", ...params }).toString()}`;
}

/** The best statement's string value: preferred, then normal; deprecated never. */
export function bestStringClaim(claims: Claims | undefined, property: string): string | null {
  const snaks = (claims?.[property] ?? []).filter((s) => s.rank !== "deprecated");
  const ordered = [
    ...snaks.filter((s) => s.rank === "preferred"),
    ...snaks.filter((s) => s.rank !== "preferred"),
  ];
  for (const snak of ordered) {
    const value = snak.mainsnak?.datavalue?.value;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Commons' HTML fields are third-party text, so they are read by a single
 * linear scan over a capped input — never by a backtracking regex: the tag
 * patterns this replaced took seconds on a crafted value (security review).
 */
const MAX_HTML_CHARS = 8_000;

const tagName = (tag: string): string | null => {
  const m = /^[a-z][a-z0-9-]*/i.exec(tag);
  return m ? m[0].toLowerCase() : null;
};

/** Commons templates print a machine-readable copy inside a hidden element
 *  ("Unknown author" came out twice on the card). */
const isHidden = (tag: string): boolean =>
  tag.toLowerCase().replace(/\s+/g, "").includes("display:none");

/**
 * Where the element named `name` that opened before `from` ends — just after
 * its closing tag, nesting of the same name counted — or -1 when it never does.
 */
function elementEnd(src: string, from: number, name: string): number {
  let depth = 1;
  let i = from;
  for (;;) {
    const lt = src.indexOf("<", i);
    if (lt === -1) return -1;
    const gt = src.indexOf(">", lt + 1);
    if (gt === -1) return -1;
    const tag = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (tag.startsWith("/")) {
      if (tagName(tag.slice(1).trim()) === name && --depth === 0) return i;
    } else if (tagName(tag) === name && !tag.endsWith("/")) {
      depth += 1;
    }
  }
}

/** The text a reader sees: tags become spaces, hidden elements vanish with
 *  their content, an unfinished tag ends the text. */
function visibleText(html: string): string {
  const src = html.slice(0, MAX_HTML_CHARS);
  const parts: string[] = [];
  // One failed search for a closing tag means malformed markup: from then on
  // nothing more is hidden, so no second search can run to the end again.
  let hiding = true;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      parts.push(src.slice(i));
      break;
    }
    parts.push(src.slice(i, lt), " ");
    const gt = src.indexOf(">", lt + 1);
    if (gt === -1) break;
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    const name = tagName(tag);
    if (!hiding || !name || tag.trimEnd().endsWith("/") || !isHidden(tag)) continue;
    const end = elementEnd(src, i, name);
    if (end === -1) hiding = false;
    else i = end;
  }
  return parts.join("");
}

/** HTML from Commons' `Artist` field, as plain text — what a reader sees. */
export function plainText(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const text = visibleText(html)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text.slice(0, 200);
}

/** Item ids whose label or alias is exactly `name` (normalised as the catalogues do). */
async function exactItems(
  name: string
): Promise<{ ok: true; ids: string[] } | { ok: false; reason: OperatorMarkMiss }> {
  const want = normalizeProviderName(name);
  const ids: string[] = [];
  for (const language of ["en", "de"]) {
    const res = await getJson(
      url(WIKIDATA_API, {
        action: "wbsearchentities",
        search: name,
        language,
        uselang: language,
        type: "item",
        limit: "7",
      })
    );
    if (!res.ok) return res;
    const parsed = searchSchema.safeParse(res.value);
    if (!parsed.success) return { ok: false, reason: "malformed" };
    const hits = parsed.data.search ?? [];
    for (const hit of hits) {
      if (typeof hit.id !== "string" || ids.includes(hit.id)) continue;
      if (normalizeProviderName(hit.match?.text ?? "") === want) ids.push(hit.id);
    }
    if (ids.length > 0) break;
  }
  return ids.length > 0 ? { ok: true, ids } : { ok: false, reason: "noItem" };
}

interface FileInfo {
  thumbUrl: string;
  credit: Omit<OperatorMarkCredit, "qid" | "colour">;
}

async function commonsFile(
  file: string
): Promise<{ ok: true; info: FileInfo } | { ok: false; reason: OperatorMarkMiss }> {
  const res = await getJson(
    url(COMMONS_API, {
      action: "query",
      titles: `File:${file}`,
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      iiurlwidth: String(THUMB_WIDTH),
    })
  );
  if (!res.ok) return res;
  const parsed = commonsSchema.safeParse(res.value);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const page = Object.values(parsed.data.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl || !info.descriptionurl) return { ok: false, reason: "noLogo" };
  const meta = info.extmetadata ?? {};
  // Capped like every Commons field; a real template name is a dozen characters.
  const licenceCode =
    typeof meta.License?.value === "string" ? meta.License.value.slice(0, 64) : "";
  const nonFree = String(meta.NonFree?.value ?? "").toLowerCase() === "true";
  if (nonFree || !FREE_LICENCE.test(licenceCode)) return { ok: false, reason: "licence" };
  const shortName = plainText(meta.LicenseShortName?.value) ?? licenceCode;
  const licenceUrl = typeof meta.LicenseUrl?.value === "string" ? meta.LicenseUrl.value : null;
  return {
    ok: true,
    info: {
      thumbUrl: info.thumburl,
      credit: {
        file,
        licence: shortName,
        licenceUrl,
        artist: plainText(meta.Artist?.value),
        sourceUrl: info.descriptionurl,
      },
    },
  };
}

/** `#rrggbb` from a P465 value ("1A2B3C"), or null. */
function colourOf(value: string | null): string | null {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}

export async function lookupOperatorMark(name: string): Promise<OperatorMarkLookup> {
  const items = await exactItems(name);
  if (!items.ok) return items;

  const entities = await getJson(
    url(WIKIDATA_API, { action: "wbgetentities", ids: items.ids.join("|"), props: "claims" })
  );
  if (!entities.ok) return entities;
  const parsedEntities = entitiesSchema.safeParse(entities.value);
  if (!parsedEntities.success) return { ok: false, reason: "malformed" };
  const byId = parsedEntities.data.entities ?? {};

  let lastMiss: OperatorMarkMiss = "noLogo";
  for (const qid of items.ids) {
    const claims = byId[qid]?.claims;
    const file = bestStringClaim(claims, "P154") ?? bestStringClaim(claims, "P8972");
    if (!file) continue;
    const found = await commonsFile(file);
    if (!found.ok) {
      lastMiss = found.reason;
      // A refused licence on one item does not end the search: a second
      // matching item may carry a free logo. An outage does.
      if (found.reason === "licence" || found.reason === "noLogo") continue;
      return found;
    }
    const image = await getBytes(found.info.thumbUrl);
    if (!image.ok) return image;
    const { body, contentType } = image.value;
    if (!RASTER_TYPES.has(contentType) || body.length === 0) {
      return { ok: false, reason: "badImage" };
    }
    return {
      ok: true,
      credit: { ...found.info.credit, qid, colour: colourOf(bestStringClaim(claims, "P465")) },
      image: { body, contentType },
    };
  }
  return { ok: false, reason: lastMiss };
}
