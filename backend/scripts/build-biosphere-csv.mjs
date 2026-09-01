#!/usr/bin/env node
/**
 * Regenerate `seedData/curated_places.biosphere.csv` — the UNESCO Man-and-the-
 * Biosphere reserves (the World Network of Biosphere Reserves).
 *
 * Run it, don't hand-edit the rows it writes:
 *   node scripts/build-biosphere-csv.mjs > src/seedData/curated_places.biosphere.csv
 *
 * The generator writes DATA ROWS ONLY. Keep the header line the same way the
 * world-heritage catalog does — see `curated_places.SOURCES.md`.
 *
 * ## Why Wikidata, again
 *
 * Same answer as `build-world-heritage-csv.mjs`: Wikidata is CC0, so a public
 * repository can vendor the bytes without asking anyone. UNESCO's own MAB
 * directory is a JS-driven site whose terms are not a licence. Provenance is
 * recorded in `curated_places.SOURCES.md` anyway.
 *
 * ## The class, established by measuring rather than by guessing
 *
 * `wd:Q158454` — "biosphere reserve (UNESCO protected area)". It is the class,
 * NOT a superclass to traverse: `wdt:P31/wdt:P279*` over a broader node walks
 * into "protected area" and returns six figures of rows. A bare
 * `?i wdt:P31 wd:Q158454` returns **764** items against an official register of
 * ~759, which is the check that the class is the right one. Beware the
 * near-namesakes — Q61453609 (German designation), Q28055306 (Latvian),
 * Q107990793 (Spanish) and friends are NATIONAL designations that merely share
 * the English label.
 *
 * A handful of reserves are modelled with `P1435` (heritage designation)
 * instead of `P31`; the query unions both, which recovers ~11 real reserves
 * (El Kala, Samariá, Juan Fernández, Ichkeul …) that `P31` alone misses.
 *
 * ## What gets dropped, and why
 *
 *  1. **Withdrawn reserves.** A reserve whose designation carries an end date
 *     (`pq:P582` on the designation statement) or whose item carries
 *     `wdt:P576` is off the register — the 2017 United States withdrawal of 17
 *     reserves, the 2014 North Norfolk Coast withdrawal, and so on. Unlike
 *     `world-wonders-ancient`, where six of seven wonders are gone but the SITE
 *     is still there to stand on, a withdrawn designation leaves nothing to
 *     tick: the land is still land, but it is not a biosphere reserve, and the
 *     checklist is a list of biosphere reserves.
 *  2. **Reserves with no coordinate.** ~98 items are thin stubs from a bulk
 *     import of the register (name + country and nothing else). `CuratedPlace`
 *     requires a position — a target that cannot be drawn cannot be ticked —
 *     so they are dropped HERE rather than emitted at 0/0 for the seeder to
 *     reject. This is the single biggest reason the output lands ~100 short of
 *     the official register; the shortfall is missing data upstream, not a
 *     filter of ours. Many of those stubs also duplicate a coordinate-bearing
 *     item, so dropping them deduplicates as a side effect.
 *  3. **Reserves with no name this catalog can render.** Names go de → en →
 *     `mul` (Wikidata's language-neutral label, which is what a proper name
 *     usually is) → the local Latin-script language, in the fixed order of
 *     `NAME_FALLBACK_LANGS`. That ladder is worth its second query: ~35
 *     reserves carry no de/en label at all and would otherwise vanish, and for
 *     "Sierra del Rincón" or "Delta del Río Paraná" the Spanish label IS the
 *     name a German UI would print. A reserve left with only a Cyrillic or CJK
 *     label is dropped — a name nobody in this UI can read is not a better
 *     checklist entry than an absent one, and it would sort into nonsense.
 *  4. **Transboundary reserves the register does not disambiguate** — see below.
 *
 * What is NOT filtered, on purpose: Wikidata holds a few duplicate items for
 * one reserve (El Vizcaíno, Parangalitza, Alto Orinoco-Casiquiare each exist
 * twice with different QIDs and coordinates ~50 km apart), and a couple of
 * items that are arguably not reserves at all (two Venezuelan "Acuerdo de
 * Conservación" agreements). Collapsing them would mean matching on NAME, which
 * is precisely the identity this file refuses to trust — see the id section.
 * They are upstream data errors and belong upstream.
 *
 * ## Transboundary reserves: ONE row, ONE country, never invented
 *
 * A transboundary reserve is a single entry in the register that spans two to
 * five countries. It gets exactly ONE row here — emitting one row per country
 * would let a user tick "Białowieża" twice and would inflate every count.
 *
 * `isoCountryCode` is not nullable in practice (the seeder test requires a
 * two-letter code on every target), so the one code has to come from
 * somewhere real. The order of resort:
 *
 *  1. One country → that country. This is the overwhelming majority.
 *  2. Several countries → read the register's OWN filing out of `P2520`
 *     (UNESCO Biosphere Reserve URL) and take the country it names first. The
 *     legacy MABdb links carry the register code (`code=CZE-POL+01`,
 *     `code=ROM-UKR+01`, `code=UGA+02`); the directory links carry a country
 *     path segment (`…/europe-north-america/portugalspain/geres-xures/`).
 *     Either way the country is the register's, in the register's order — we
 *     read it, we do not choose it.
 *  3. Several countries and no usable register link → the row is DROPPED and
 *     named on stderr. Picking one of them would be a guess, and a guess about
 *     which country a reserve "belongs to" is exactly the kind of quiet wrong
 *     answer this catalog must not ship. It costs a handful of reserves
 *     (Kempen-Broek, Köpet Dag, Hamun, West Polesie, Trifinio Fraternidad …),
 *     several of which are duplicated anyway by a resolvable sibling item.
 *
 * Known imprecision, stated rather than hidden: where the register files two
 * national components under ONE joint entry (Katon-Karagay and Katunskiy both
 * point at `…/kazakhstanrussian-federation/great-altay/`), both take the
 * first-named country. That is what the register says; it is not what a map
 * would say for the Russian half.
 *
 * ## Stable ids come from the QID, not from the name
 *
 * `biosphere-reserves:Q864739`. The register has no public stable per-reserve
 * identifier that Wikidata carries reliably (`P2520` is a URL, and it has been
 * rewritten twice as UNESCO moved the directory). The QID is the one handle
 * that survives a rename. That matters here more than usual: reserves get
 * renamed and extended constantly ("Mono" → "Mono Transboundary Biosphere
 * Reserve"), and a name-derived id would turn a rename into a NEW row — which
 * silently un-ticks the visit of everyone who had already been there, because
 * `Place.curatedItemId` points at the old id and nothing joins any more.
 *
 * ## Country TEXT is deliberately empty
 *
 * Same as world-heritage: the source writes a CODE, not a country name, and
 * `Place.country` is "whatever the source wrote". Everything that groups or
 * counts joins on `isoCountryCode`, and the client localises it through
 * `Intl.DisplayNames` — an English country name baked in here would render as
 * English inside a German UI, which is worse than nothing.
 */

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA =
  "TravStats-catalog-seed/1.0 (self-hosted travel logbook; https://github.com/Abrechen2/TravStats)";

/** "biosphere reserve" as UNESCO means it. NOT a national designation. */
const BIOSPHERE_RESERVE = "wd:Q158454";

const QUERY = `
SELECT ?item ?coord ?nameDe ?nameEn ?descDe ?descEn ?iso ?iso3 ?cname ?isoVia ?url ?ended ?dissolved WHERE {
  { ?item p:P31 ?st . ?st ps:P31 ${BIOSPHERE_RESERVE} . }
  UNION
  { ?item p:P1435 ?st . ?st ps:P1435 ${BIOSPHERE_RESERVE} . }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  # Withdrawal, kept in the result set rather than filtered in SPARQL so the
  # generator can say out loud how many it dropped.
  OPTIONAL { ?st pq:P582 ?ended }
  OPTIONAL { ?item wdt:P576 ?dissolved }
  # A target with no position cannot be drawn and cannot be ticked.
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item rdfs:label ?nameDe . FILTER(LANG(?nameDe) = "de") }
  OPTIONAL { ?item rdfs:label ?nameEn . FILTER(LANG(?nameEn) = "en") }
  OPTIONAL { ?item schema:description ?descDe . FILTER(LANG(?descDe) = "de") }
  OPTIONAL { ?item schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  # Country, with its alpha-3 and English name alongside — both are needed to
  # match a candidate against the register's own code or URL slug.
  OPTIONAL {
    ?item wdt:P17 ?country .
    ?country wdt:P297 ?iso .
    OPTIONAL { ?country wdt:P298 ?iso3 }
    OPTIONAL { ?country rdfs:label ?cname . FILTER(LANG(?cname) = "en") }
  }
  # Fallback for the few reserves filed by administrative area only.
  OPTIONAL { ?item wdt:P131*/wdt:P17/wdt:P297 ?isoVia . }
  OPTIONAL { ?item wdt:P2520 ?url }
}`;

/**
 * Sanity band around the OUTPUT, not around the register. The register held
 * ~759 reserves when this was written; ~100 of them are coordinate-less stubs
 * on Wikidata and get dropped above, so a healthy run lands in the 600s. Far
 * outside this band → do NOT ship it: the shape of the source changed and this
 * header needs re-reading, not the band widening.
 */
const EXPECTED_MIN = 580;
const EXPECTED_MAX = 800;

/**
 * Name fallback after de and en, in preference order. `mul` first — it is
 * Wikidata's explicitly language-neutral label and a reserve's name usually is
 * one. Then Latin-script languages only, so the German UI gets something its
 * readers can read and its sort can order. The order is fixed so that two runs
 * of this generator produce byte-identical files.
 */
const NAME_FALLBACK_LANGS = [
  "mul",
  "es",
  "fr",
  "pt",
  "it",
  "ca",
  "gl",
  "eu",
  "nl",
  "pl",
  "cs",
  "sk",
  "hu",
  "ro",
  "sl",
  "hr",
  "sv",
  "da",
  "fi",
  "nb",
  "no",
  "et",
  "lv",
  "lt",
  "sq",
  "tr",
  "id",
  "ms",
  "vi",
  "sw",
  "af",
  "az",
  "uz",
  "tk",
  "is",
  "ga",
  "cy",
];

const val = (row, key) => row[key]?.value ?? null;

/** `Point(12.4922 41.8902)` → `{ lat, lon }`, or null when unparseable. */
function parsePoint(wkt) {
  const m = /^Point\(([-0-9.eE]+) ([-0-9.eE]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number.parseFloat(m[1]);
  const lat = Number.parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Null Island is what an unparsed coordinate looks like, and the seed test
  // asserts no target sits there.
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/**
 * Wikidata descriptions are one short phrase and often say nothing the name has
 * not already said. Those are dropped rather than rendered as a caption that
 * reads like a bug.
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

const squash = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The register's own country tokens out of a `P2520` URL.
 *
 * Two shapes exist in the wild, because UNESCO moved the directory twice:
 *   - legacy MABdb: `…/biores.asp?code=CZE-POL+01&mode=all` → `["CZE", "POL"]`
 *   - directory path: `…/biosphere-reserves/<region>/<countries>/<reserve>/`
 *     → `["portugalspain"]`
 * Anything else (a news article, the reserve's own homepage, the current
 * `unesco.org/en/mab/<slug>` links) names no country and yields nothing.
 */
function registerTokens(url) {
  const out = { codes: [], slug: null };
  if (!url) return out;
  const code = /[?&]code=([^&]+)/i.exec(url);
  if (code) {
    const decoded = decodeURIComponent(code[1].replace(/\+/g, " "));
    out.codes = decoded.split(/[\s-]+/).filter((p) => /^[A-Za-z]{3}$/.test(p));
  }
  const path = /\/biosphere-reserves\/[^/]+\/([^/?#]+)\//.exec(url);
  if (path) out.slug = squash(path[1]);
  return out;
}

/**
 * Pick the ONE country a multi-country reserve is filed under, or null.
 *
 * `candidates` is `[{ iso, iso3, name }]`. A legacy code part matches a
 * candidate on its alpha-3 (`MRT` → Mauritania) or on the first three letters
 * of its English name, because the MABdb codes are not always ISO — `ROM` for
 * Romania, `SLO` for Slovakia, `MON` for Mongolia. Codes are read left to
 * right, which is the register's own order.
 */
function countryFromRegister(url, candidates) {
  const { codes, slug } = registerTokens(url);
  for (const part of codes) {
    const p = part.toLowerCase();
    const hit = candidates.find((c) => squash(c.iso3) === p || squash(c.name).slice(0, 3) === p);
    if (hit) return hit.iso;
  }
  if (slug) {
    let best = null;
    for (const c of candidates) {
      const idx = c.name ? slug.indexOf(squash(c.name)) : -1;
      if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, iso: c.iso };
    }
    if (best) return best.iso;
  }
  return null;
}

async function ask(query) {
  const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
  const body = await res.json();
  return body.results.bindings;
}

/**
 * Second pass, for the reserves the first query left nameless. Kept out of the
 * main query on purpose: an `IN (…)` over three dozen languages multiplies
 * every row of the main result by however many labels the item happens to
 * carry, which is a several-fold blow-up on 600+ reserves and a timeout waiting
 * to happen. Asking again for the ~35 that need it costs one request.
 */
async function fetchFallbackNames(qids) {
  if (qids.length === 0) return new Map();
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const langs = NAME_FALLBACK_LANGS.map((l) => `"${l}"`).join(", ");
  const rows = await ask(`
SELECT ?item ?label (LANG(?label) AS ?lang) WHERE {
  VALUES ?item { ${values} }
  ?item rdfs:label ?label .
  FILTER(LANG(?label) IN (${langs}))
}`);
  const best = new Map();
  for (const row of rows) {
    const qid = val(row, "item")?.split("/").pop();
    const lang = val(row, "lang");
    const label = val(row, "label");
    if (!qid || !lang || !label) continue;
    const rank = NAME_FALLBACK_LANGS.indexOf(lang);
    if (rank < 0) continue;
    const prev = best.get(qid);
    if (!prev || rank < prev.rank) best.set(qid, { rank, label });
  }
  return new Map([...best].map(([qid, v]) => [qid, v.label]));
}

async function main() {
  const rows = await ask(QUERY);

  // One entry per RESERVE. Rows arrive one per (item × country × url × label),
  // so the reducer has to survive seeing the same reserve several times.
  const reserves = new Map();
  const withdrawn = new Map();

  for (const row of rows) {
    const qid = val(row, "item")?.split("/").pop();
    if (!qid) continue;

    const name = val(row, "nameDe") ?? val(row, "nameEn");
    if (val(row, "ended") || val(row, "dissolved")) {
      withdrawn.set(qid, name ?? qid);
      continue;
    }

    const point = parsePoint(val(row, "coord"));
    if (!point) continue;

    let r = reserves.get(qid);
    if (!r) {
      r = {
        qid,
        nameDe: val(row, "nameDe"),
        nameEn: val(row, "nameEn"),
        descDe: val(row, "descDe"),
        descEn: val(row, "descEn"),
        lat: point.lat,
        lon: point.lon,
        countries: new Map(),
        via: new Set(),
        urls: new Set(),
      };
      reserves.set(qid, r);
    }
    const iso = val(row, "iso");
    if (iso) {
      const prev = r.countries.get(iso);
      r.countries.set(iso, {
        iso,
        iso3: val(row, "iso3") ?? prev?.iso3 ?? null,
        name: val(row, "cname") ?? prev?.name ?? null,
      });
    }
    const via = val(row, "isoVia");
    if (via) r.via.add(via);
    const url = val(row, "url");
    if (url) r.urls.add(url);
  }

  // A reserve that appears both as still-designated and as withdrawn is
  // withdrawn — the end date is the newer statement about it.
  for (const qid of withdrawn.keys()) reserves.delete(qid);

  const fallbackNames = await fetchFallbackNames(
    [...reserves.values()].filter((r) => !r.nameDe && !r.nameEn).map((r) => r.qid)
  );

  const unnamed = [];
  const ambiguous = [];
  const stateless = [];
  const out = [];

  for (const r of reserves.values()) {
    const name = r.nameDe ?? r.nameEn ?? fallbackNames.get(r.qid) ?? null;
    if (!name) {
      unnamed.push(r.qid);
      continue;
    }

    let candidates = [...r.countries.values()];
    if (candidates.length === 0) {
      // Nothing direct — fall back to the containment chain, which yields codes
      // only (no name/alpha-3), so it can only settle an unambiguous case.
      candidates = [...r.via].map((iso) => ({ iso, iso3: null, name: null }));
    }

    let iso = null;
    if (candidates.length === 1) {
      iso = candidates[0].iso;
    } else if (candidates.length > 1) {
      for (const url of r.urls) {
        iso = countryFromRegister(url, candidates);
        if (iso) break;
      }
      if (!iso) {
        ambiguous.push(
          `${r.qid} ${name} [${candidates
            .map((c) => c.iso)
            .sort()
            .join("/")}]`
        );
        continue;
      }
    }
    if (!iso) {
      stateless.push(`${r.qid} ${name}`);
      continue;
    }

    out.push({ ...r, name, iso });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "de") || a.qid.localeCompare(b.qid));

  if (out.length < EXPECTED_MIN || out.length > EXPECTED_MAX) {
    throw new Error(
      `Got ${out.length} reserves, expected ${EXPECTED_MIN}-${EXPECTED_MAX}. ` +
        "The source shape changed — read the header of this file before shipping."
    );
  }

  for (const r of out) {
    // `nameEn` stays empty where it is identical — the client falls back, and a
    // duplicated string is noise it would have to compare.
    const en = r.nameEn && r.nameEn !== r.name ? r.nameEn : "";
    console.log(
      [
        csv(`biosphere-reserves:${r.qid}`),
        csv("biosphere-reserves"),
        csv(r.name),
        csv(en),
        csv(usefulBlurb(r.descDe, r.name)),
        csv(usefulBlurb(r.descEn, en || r.name)),
        csv(r.lat.toFixed(5)),
        csv(r.lon.toFixed(5)),
        csv(""),
        csv(r.iso),
        csv(0),
      ].join(",")
    );
  }

  console.error(`${out.length} Biosphärenreservate geschrieben.`);
  console.error(
    `${withdrawn.size} zurückgezogen (übersprungen): ${[...withdrawn.values()].join(", ")}`
  );
  if (ambiguous.length > 0) {
    console.error(
      `${ambiguous.length} grenzüberschreitend ohne Registereintrag, der ein Land nennt ` +
        `(übersprungen statt geraten):\n  ${ambiguous.join("\n  ")}`
    );
  }
  if (stateless.length > 0) {
    console.error(`${stateless.length} ohne Land (übersprungen):\n  ${stateless.join("\n  ")}`);
  }
  if (unnamed.length > 0) {
    console.error(`${unnamed.length} ohne deutschen/englischen Namen: ${unnamed.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
