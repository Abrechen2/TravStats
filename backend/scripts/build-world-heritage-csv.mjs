#!/usr/bin/env node
/**
 * Regenerate the UNESCO World Heritage rows of `seedData/curated_places.csv`.
 *
 * Run it, don't hand-edit the rows it writes:
 *   node scripts/build-world-heritage-csv.mjs > src/seedData/curated_places.world-heritage.csv
 *
 * ## Why Wikidata and not UNESCO
 *
 * whc.unesco.org answers 403 to anything that is not a browser, and its terms
 * are not a licence a public repository can vendor bytes under without asking.
 * Wikidata is CC0 — no attribution obligation at all — which is the cleanest
 * answer to the licensing note in the POI design spec (§5). Provenance is
 * recorded anyway, in `curated_places.SOURCES.md`, because "we may" is not the
 * same as "nobody should have to ask where this came from".
 *
 * ## The three filters, and why the raw query is wrong without them
 *
 * A bare "designated as World Heritage Site" query returns ~1500 rows against
 * an official list of ~1250. The difference is not noise, it is two specific
 * things:
 *
 *  1. **Serial components.** An id containing a dash (`378-001`) is one piece
 *     of a serial site, not a site. Seventy-four of those.
 *  2. **Extension numbers.** A site extended after inscription gains a second
 *     id (`250` AND `250bis`; `1305` AND `1305rev`). Same site, twice. They
 *     collapse by BASE number, keeping the most specific id — which is also
 *     usually the row carrying the better data.
 *
 * A third filter drops designations with an end date (`pq:P582`): a delisted
 * site is not on the list any more.
 *
 * With all three the count lands at ~1250, which is the check that the filters
 * are right. If a future run comes back far off that, do NOT ship it — the
 * shape of the source changed and this file needs re-reading, not overriding.
 */

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA =
  "TravStats-catalog-seed/1.0 (self-hosted travel logbook; https://github.com/Abrechen2/TravStats)";

const QUERY = `
SELECT ?item ?whsId ?coord ?nameDe ?nameEn ?descDe ?descEn ?iso ?isoVia WHERE {
  ?item p:P1435 ?st .
  ?st ps:P1435 wd:Q9259 .
  FILTER NOT EXISTS { ?st pq:P582 ?ended }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  ?item wdt:P757 ?whsId ;
        wdt:P625 ?coord .
  OPTIONAL { ?item rdfs:label ?nameDe . FILTER(LANG(?nameDe) = "de") }
  OPTIONAL { ?item rdfs:label ?nameEn . FILTER(LANG(?nameEn) = "en") }
  OPTIONAL { ?item schema:description ?descDe . FILTER(LANG(?descDe) = "de") }
  OPTIONAL { ?item schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  # Country code, with a fallback. A few sites carry no P17 at all — Dutch
  # monuments in particular are filed by administrative area only — so the
  # containment chain is walked as a second chance before giving up.
  OPTIONAL { ?item wdt:P17/wdt:P297 ?iso . }
  OPTIONAL { ?item wdt:P131*/wdt:P17/wdt:P297 ?isoVia . }
}`;

/** Sanity band around the official site count. Far outside it → do not ship. */
const EXPECTED_MIN = 1100;
const EXPECTED_MAX = 1400;

const val = (row, key) => row[key]?.value ?? null;

/** `Point(12.4922 41.8902)` → `{ lat, lon }`, or null when unparseable. */
function parsePoint(wkt) {
  const m = /^Point\(([-0-9.eE]+) ([-0-9.eE]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number.parseFloat(m[1]);
  const lat = Number.parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** `250bis` → `250`; `1305rev` → `1305`. The base number IS the site. */
const baseNumber = (id) => /^(\d+)/.exec(id)?.[1] ?? id;

/**
 * Wikidata descriptions are one short phrase and often say nothing the name
 * has not already said ("Nationalpark" under "Simien-Nationalpark"). Those are
 * dropped rather than rendered as a blurb that reads like a bug.
 */
function usefulBlurb(desc, name) {
  if (!desc) return "";
  const d = desc.trim();
  if (d.length < 15) return "";
  if (name.toLowerCase().includes(d.toLowerCase())) return "";
  return d;
}

/** Minimal RFC4180 quoting — every field, so the file is diff-stable. */
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(QUERY)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
  const body = await res.json();
  const rows = body.results.bindings;

  // One entry per SITE. Rows arrive one per (item × country × label), so the
  // reducer has to survive seeing the same site several times.
  const sites = new Map();
  for (const row of rows) {
    const whsId = val(row, "whsId");
    if (!whsId || whsId.includes("-")) continue; // serial component
    const point = parsePoint(val(row, "coord"));
    if (!point) continue;

    const key = baseNumber(whsId);
    const nameDe = val(row, "nameDe");
    const nameEn = val(row, "nameEn");
    const name = nameDe ?? nameEn;
    if (!name) continue;

    const prev = sites.get(key);
    // Prefer the row that actually has German copy, then the more specific id
    // (`250bis` over `250`) — the extension row is the current one.
    const better =
      !prev ||
      (!prev.nameDe && nameDe) ||
      (prev.whsId === key && whsId !== key && Boolean(nameDe) === Boolean(prev.nameDe));
    if (better) {
      sites.set(key, {
        key,
        whsId,
        nameDe,
        nameEn,
        name,
        descDe: val(row, "descDe"),
        descEn: val(row, "descEn"),
        lat: point.lat,
        lon: point.lon,
        iso: val(row, "iso") ?? val(row, "isoVia"),
      });
    } else if (prev && !prev.iso) {
      prev.iso = val(row, "iso") ?? val(row, "isoVia");
    }
  }

  const out = [...sites.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  if (out.length < EXPECTED_MIN || out.length > EXPECTED_MAX) {
    throw new Error(
      `Got ${out.length} sites, expected ${EXPECTED_MIN}-${EXPECTED_MAX}. ` +
        "The source shape changed — read the header of this file before shipping."
    );
  }

  for (const s of out) {
    const name = s.name;
    // `nameEn` stays empty where it is identical — the client falls back, and a
    // duplicated string is noise it would have to compare.
    const en = s.nameEn && s.nameEn !== name ? s.nameEn : "";
    const blurb = usefulBlurb(s.descDe, name);
    const blurbEn = usefulBlurb(s.descEn, en || name);
    console.log(
      [
        csv(`world-heritage:${s.key}`),
        csv("world-heritage"),
        csv(name),
        csv(en),
        csv(blurb),
        csv(blurbEn),
        csv(s.lat.toFixed(5)),
        csv(s.lon.toFixed(5)),
        // Country TEXT is deliberately empty: the source wrote no country name,
        // only a code, and `Place.country` is "whatever the source wrote".
        // Everything that groups or counts joins on the code anyway, and the UI
        // localises it — an English name baked in here would be worse.
        csv(""),
        csv(s.iso ?? ""),
        csv(0),
      ].join(",")
    );
  }
  console.error(`${out.length} Stätten geschrieben.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
