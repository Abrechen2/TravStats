#!/usr/bin/env node
/**
 * Regenerate `seedData/curated_places.nationalparks.csv` — the two national
 * park checklists, Germany and the United States.
 *
 * Run it, don't hand-edit the rows it writes:
 *   node scripts/build-national-parks-csv.mjs > src/seedData/curated_places.nationalparks.csv
 *
 * Source is Wikidata (CC0), for the same reason the world-heritage catalog is:
 * no attribution obligation, so a public repository can vendor the bytes
 * without asking anyone. Provenance is recorded in `curated_places.SOURCES.md`
 * anyway.
 *
 * ## The scoping rule IS the list
 *
 * A bare "instance of national park" query returns 3,449 rows worldwide. Both
 * lists here are defined by a *legal designation inside one country*, not by
 * the shape of the landscape, and that is the whole reason they are completable
 * at all. Get the filter wrong and you do not ship a slightly-off list, you
 * ship a list nobody can ever finish. The expected counts below are therefore
 * hard assertions, not sanity bands: 16 and 63. If a future run misses them, do
 * NOT ship it — read this header, find out what moved in the source, and decide
 * deliberately.
 *
 * ## Germany — 16
 *
 * `Nationalpark in Deutschland` (Q21815132) is a subclass of `national park`
 * (Q46169), so the class walk `P31 → P279* → Q46169` plus `P17 = Germany` is
 * the designation filter. Nature parks (Naturpark) and biosphere reserves are
 * different classes entirely and never enter the set — which is exactly what
 * the list description promises the user.
 *
 * That query returns 17. The seventeenth is **Nationalpark Elbtalaue**, which
 * Lower Saxony designated in 1998 and a court struck down in 1999; it carries a
 * dissolution date and is dropped (see the P576 note below). 16 remain.
 *
 * **Wattenmeer is THREE parks, not one.** Schleswig-Holsteinisches (Q706721),
 * Niedersächsisches (Q661217) and Hamburgisches Wattenmeer (Q686539) are three
 * separate designations by three separate states over one continuous mudflat.
 * They are three rows here on purpose. Collapsing them — which "one Wadden Sea"
 * intuition and their shared World Heritage inscription both invite — would
 * make the list impossible to complete against any official count of 16.
 *
 * ## United States — 63
 *
 * `National Park of the United States` (Q34918903) is the LEGAL DESIGNATION
 * Congress confers, and it is not the National Park System: the NPS runs ~430
 * units, and National Monuments, Historic Sites, Seashores and Recreation Areas
 * are none of them National Parks. Filtering on the designation rather than on
 * the administering agency is what turns 430 into 63.
 *
 * Three things stand between the raw query and those 63:
 *
 *  1. **Rank.** `wdt:P31` exposes only best-rank statements. Lake Clark
 *     National Park and Preserve (Q712296) carries `protected area` at
 *     PREFERRED rank and the national-park designation at normal rank, so
 *     `wdt:` hides it and the park silently vanishes from the list. The query
 *     therefore walks `p:P31 → ps:P31` and rejects only DEPRECATED rank.
 *
 *  2. **Park-and-Preserve pairs.** Eight parks — the six Alaskan ones plus
 *     Great Sand Dunes and New River Gorge — are administered as "X National
 *     Park and Preserve". Wikidata models each of those as TWO items: the
 *     combined unit, and (split out recently) the park portion. Left alone that
 *     is eight duplicate rows. Six of the eight portion items have no
 *     coordinates at all, so merely "drop the coordinate-less rows" would have
 *     produced the right COUNT with the wrong CONTENT — Lake Clark and New
 *     River Gorge missing, Denali and Great Sand Dunes twice. Instead the pair
 *     is resolved by name: a candidate whose English label plus " and Preserve"
 *     is the label of an NPS-administered item is the portion, and the combined
 *     unit becomes the row (it carries the coordinates, the German label and
 *     the description). `P361` looks like the right property for this and is
 *     NOT — it points at tourism regions ("Mighty Five", "deserts of
 *     California") and transboundary heritage sites just as often as at a
 *     preserve.
 *
 *  3. **Dissolution, but only the unqualified kind.** General Grant National
 *     Park was folded into Kings Canyon in 1940 and carries `P576`. So does
 *     Virgin Islands National Park — except there the statement is qualified
 *     `applies to part = biosphere reserve` (its MAB status lapsed in 2017, the
 *     park did not). A naive `NOT EXISTS { ?item wdt:P576 ?d }` drops a park
 *     that is very much open. Only an UNQUALIFIED dissolution ends a park.
 *
 * ## Why rank and dissolution are decided in JavaScript, not in SPARQL
 *
 * Both read more naturally as SPARQL filters, and both were written that way
 * first. `FILTER NOT EXISTS { ?statement wikibase:rank ... }` and the nested
 * `NOT EXISTS`-inside-`NOT EXISTS` the qualified-dissolution rule needs each
 * pushed the query past the WDQS 60-second ceiling — repeatable 504s, not bad
 * luck. Selecting `?rank`, `?dissolvedOn` and `?appliesToPart` as plain bound
 * variables and deciding in the reducer runs the same query in under two
 * seconds. The rule is identical; only the place it is evaluated moved.
 *
 * ## Ids are QIDs, deliberately
 *
 * `nationalparks-us:Q351`, not `nationalparks-us:yellowstone`. A curated id is
 * what a user's tick hangs off (`Place.curatedItemId`), so a renamed park must
 * not become a new row — that would un-tick the visit of everyone who had been
 * there. Gateway Arch was "Jefferson National Expansion Memorial" until 2018
 * and New River Gorge was a National River until 2020; both kept their QID
 * across the rename, and a name-derived id would have survived neither.
 *
 * For a park-and-preserve pair the id is the COMBINED unit's QID, since that is
 * the item the row is built from.
 *
 * ## Three smaller judgement calls, all visible in the output
 *
 *  - **`country` stays empty, only `isoCountryCode` is set** — the
 *    world-heritage precedent. `Place.country` is "whatever the source wrote",
 *    and the source wrote a QID, not a country name; everything that groups or
 *    counts joins on the code, and the UI localises it. Here the code is a
 *    per-list CONSTANT rather than read from `P17`, because the country is what
 *    DEFINES each list: American Samoa and the Virgin Islands are US national
 *    parks whatever their own ISO code says, and a park with a missing `P17`
 *    must not become a row the seeder then rejects for having no country.
 *
 *  - **A German label that does not contain "Nationalpark" is not the park's
 *    German name.** Every genuine German label in both sets follows
 *    "X-Nationalpark" / "Nationalpark X". Exactly two do not: Gateway Arch's
 *    German label is still the pre-2018 memorial name, and Kings Canyon's is
 *    the bare canyon. Both fall back to the English label, which is right in
 *    both cases and better than shipping a park under a name it lost in 2018.
 *
 *  - **New River Gorge keeps "and Preserve" in its German name**, because the
 *    combined unit has no German label at all and the English one is the only
 *    name there is. The other seven pairs do have a German label
 *    ("Denali-Nationalpark"), so only this one reads bilingual.
 *
 * A park spanning a border cannot appear twice: rows arrive one per
 * (item × label × statement) combination and are folded into a Map keyed by
 * QID, so Glacier (which shares an international peace park with Waterton) and
 * the Bavarian Forest (which abuts Šumava) are one row each, in one list each.
 */

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA =
  "TravStats-catalog-seed/1.0 (self-hosted travel logbook; https://github.com/Abrechen2/TravStats)";

/** The suffix that turns a park's name into the name of its combined unit. */
const PRESERVE_SUFFIX = " and Preserve";

/**
 * Shared tail: labels, descriptions, coordinate, and the two variables the
 * reducer needs to judge a dissolution. `?item` must already be bound.
 */
const COMMON = `
  OPTIONAL { ?item rdfs:label ?nameDe . FILTER(LANG(?nameDe) = "de") }
  OPTIONAL { ?item rdfs:label ?nameEn . FILTER(LANG(?nameEn) = "en") }
  OPTIONAL { ?item schema:description ?descDe . FILTER(LANG(?descDe) = "de") }
  OPTIONAL { ?item schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL {
    ?item p:P576 ?dissolution .
    ?dissolution ps:P576 ?dissolvedOn .
    OPTIONAL { ?dissolution pq:P518 ?appliesToPart }
  }`;

const LISTS = [
  {
    listKey: "nationalparks-de",
    iso: "DE",
    expected: 16,
    label: "Deutschland",
    // `?rank` is selected rather than filtered — see the header.
    query: `
SELECT ?item ?rank ?nameDe ?nameEn ?descDe ?descEn ?coord ?dissolvedOn ?appliesToPart WHERE {
  ?item wdt:P17 wd:Q183 ; p:P31 ?statement .
  ?statement ps:P31 ?class ; wikibase:rank ?rank .
  ?class wdt:P279* wd:Q46169 .
${COMMON}
}`,
  },
  {
    listKey: "nationalparks-us",
    iso: "US",
    expected: 63,
    label: "USA",
    // The DESIGNATION Congress confers, not the ~430-unit National Park System.
    query: `
SELECT ?item ?rank ?nameDe ?nameEn ?descDe ?descEn ?coord ?dissolvedOn ?appliesToPart WHERE {
  ?item p:P31 ?statement .
  ?statement ps:P31 wd:Q34918903 ; wikibase:rank ?rank .
${COMMON}
}`,
    // Every NPS unit called "… National Park and Preserve". Kept as its own
    // small query: joining it into the one above with a CONCAT on labels is
    // what tipped that query over the WDQS time limit.
    unitQuery: `
SELECT ?item ?rank ?nameDe ?nameEn ?descDe ?descEn ?coord ?dissolvedOn ?appliesToPart WHERE {
  ?item wdt:P137 wd:Q308439 ; rdfs:label ?unitEn .
  FILTER(LANG(?unitEn) = "en")
  FILTER(STRENDS(STR(?unitEn), "National Park and Preserve"))
  BIND(wikibase:NormalRank AS ?rank)
${COMMON}
}`,
  },
];

const CSV_HEADER = "id,listKey,name,nameEn,blurb,blurbEn,lat,lon,country,isoCountryCode,sortIdx";

const val = (row, key) => row[key]?.value ?? null;
const qidOf = (uri) => uri.split("/").pop();

/** `Point(12.4922 41.8902)` → `{ lat, lon }`, or null when unparseable. */
function parsePoint(wkt) {
  const m = /^Point\(([-0-9.eE]+) ([-0-9.eE]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number.parseFloat(m[1]);
  const lat = Number.parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Null Island is what an unparsed coordinate looks like, and the seed suite
  // asserts that no target sits there.
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/**
 * Wikidata descriptions are one short phrase and often say nothing the name has
 * not already said ("Nationalpark" under "Nationalpark Harz"). Those are
 * dropped rather than rendered as a blurb that reads like a bug.
 */
function usefulBlurb(desc, name) {
  if (!desc) return "";
  const d = desc.trim();
  if (d.length < 15) return "";
  if (name.toLowerCase().includes(d.toLowerCase())) return "";
  return d;
}

/**
 * A German label is only the park's German name when it says so — see the
 * header on Gateway Arch and Kings Canyon.
 */
function germanName(nameDe, nameEn) {
  if (nameDe && /nationalpark/i.test(nameDe)) return nameDe;
  return nameEn ?? nameDe;
}

/** Minimal RFC4180 quoting — every field, so the file is diff-stable. */
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * WDQS answers 502/504 under load often enough that a single attempt is not a
 * generator, it is a coin flip. Three tries with a growing pause.
 */
async function ask(query) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
      });
      if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
      const body = await res.json();
      return body.results.bindings;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw lastError;
}

/**
 * Fold SPARQL rows into one entry per item.
 *
 * Rows arrive one per (item × label × statement) combination, so the reducer
 * has to survive seeing the same park several times with different fields
 * populated. Two rules are applied here rather than in the query, for the
 * performance reason in the header:
 *
 *  - a DEPRECATED designation statement means "this is not true", so the row
 *    does not count as evidence of a designation;
 *  - an UNQUALIFIED dissolution date ends the park, a qualified one ends
 *    something else the park also happened to be.
 */
function collectItems(rows) {
  const items = new Map();
  const dissolved = new Set();
  for (const row of rows) {
    const qid = qidOf(val(row, "item"));
    if (val(row, "dissolvedOn") && !val(row, "appliesToPart")) dissolved.add(qid);
    if (val(row, "rank")?.endsWith("DeprecatedRank")) continue;

    const entry = items.get(qid);
    if (!entry) {
      items.set(qid, {
        qid,
        nameDe: val(row, "nameDe"),
        nameEn: val(row, "nameEn"),
        descDe: val(row, "descDe"),
        descEn: val(row, "descEn"),
        point: parsePoint(val(row, "coord")),
      });
      continue;
    }
    entry.nameDe ??= val(row, "nameDe");
    entry.nameEn ??= val(row, "nameEn");
    entry.descDe ??= val(row, "descDe");
    entry.descEn ??= val(row, "descEn");
    entry.point ??= parsePoint(val(row, "coord"));
  }
  for (const qid of dissolved) items.delete(qid);
  return items;
}

async function buildList(list) {
  const candidates = collectItems(await ask(list.query));

  // "Denali National Park" → the entry for "Denali National Park and Preserve".
  const unitsByParkName = new Map();
  if (list.unitQuery) {
    for (const unit of collectItems(await ask(list.unitQuery)).values()) {
      if (!unit.nameEn?.endsWith(PRESERVE_SUFFIX)) continue;
      unitsByParkName.set(unit.nameEn.slice(0, -PRESERVE_SUFFIX.length), unit);
    }
  }

  const parks = new Map();
  const dropped = [];
  for (const candidate of candidates.values()) {
    // The combined unit is the park people visit; the portion item is
    // bookkeeping. Both fold onto the same QID, which is what makes the pair
    // one row instead of two.
    const park = (candidate.nameEn && unitsByParkName.get(candidate.nameEn)) || candidate;
    const name = germanName(park.nameDe, park.nameEn);
    // No name and no position each mean the row cannot be drawn or ticked.
    if (!name || !park.point) {
      dropped.push(`${park.qid} (${name ?? "namenlos"})`);
      continue;
    }
    parks.set(park.qid, { ...park, name });
  }

  const out = [...parks.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  if (out.length !== list.expected) {
    throw new Error(
      `${list.listKey}: got ${out.length} parks, expected exactly ${list.expected}. ` +
        `Dropped for want of a name or a position: ${dropped.join(", ") || "keine"}. ` +
        "The shape of the source changed — read the header of this file, decide what " +
        "the list should contain, and do NOT ship it with the wrong count."
    );
  }
  return out;
}

async function main() {
  const built = [];
  for (const list of LISTS) {
    built.push([list, await buildList(list)]);
  }

  console.log(CSV_HEADER);
  for (const [list, parks] of built) {
    for (const park of parks) {
      // `nameEn` stays empty where it is identical — the client falls back, and
      // a duplicated string is noise it would have to compare.
      const en = park.nameEn && park.nameEn !== park.name ? park.nameEn : "";
      console.log(
        [
          csv(`${list.listKey}:${park.qid}`),
          csv(list.listKey),
          csv(park.name),
          csv(en),
          csv(usefulBlurb(park.descDe, park.name)),
          csv(usefulBlurb(park.descEn, en || park.name)),
          csv(park.point.lat.toFixed(5)),
          csv(park.point.lon.toFixed(5)),
          // Country TEXT deliberately empty; the code is the per-list constant.
          csv(""),
          csv(list.iso),
          csv(0),
        ].join(",")
      );
    }
    console.error(`${parks.length} Nationalparks geschrieben (${list.label}).`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
