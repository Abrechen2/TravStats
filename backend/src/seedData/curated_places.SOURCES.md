# Where the curated catalogs come from

The POI design spec (§5) asks for this file before any checklist grows beyond
something hand-typed:

> Licensing note before adding more: coordinates and names from OSM are ODbL and
> need attribution; a hand-curated 7-row CSV is not a database extract. Anything
> bulk-derived gets its source and licence recorded in the CSV header — the
> marnet vendoring set that precedent.

A CSV read with `columns: true` cannot carry a comment header — a leading `#`
line would be parsed as the header row — so the record lives here instead.

## `curated_places.csv` — the wonder lists and the museum warships

Hand-written, from common knowledge; coordinates read off the sites. Nothing
bulk-derived, so no attribution obligation attaches. Edit it by hand.

Three catalogs share the file: the two wonder lists (14 rows) and
`museum-warships` (14 rows) — preserved warships open to the public as
museum ships, spread across the US, UK, Japan, Sweden and Germany.

## `curated_places.world-heritage.csv` — UNESCO World Heritage

| | |
|---|---|
| **Source** | [Wikidata](https://www.wikidata.org/) via the [Query Service](https://query.wikidata.org/) |
| **Licence** | **CC0 1.0** — public domain dedication, no attribution required |
| **Retrieved** | 2026-08-24 |
| **Rows** | 1247 sites |
| **Generator** | `backend/scripts/build-world-heritage-csv.mjs` (carries the SPARQL query and the filters) |

**Do not hand-edit this file.** Regenerate it:

```bash
cd backend
node scripts/build-world-heritage-csv.mjs > src/seedData/curated_places.world-heritage.csv.new
# the generator writes rows only; keep the header line
{ head -1 src/seedData/curated_places.world-heritage.csv; cat …csv.new; } > …
```

### Why not UNESCO directly

`whc.unesco.org` answers **403** to anything that is not a browser, and its
terms of use are not a licence under which a public repository can vendor bytes
without asking first. Wikidata's CC0 removes the question entirely. The
generator's header explains the three filters that take the raw ~1500 query rows
down to the ~1250 that are actually on the list — serial components, extension
numbers and delisted sites.

### What the rows deliberately do NOT carry

`country` is **empty**; only `isoCountryCode` is set. The source wrote a code,
not a country name, and `Place.country` is documented as "whatever the source
wrote". Everything that groups or counts joins on the code anyway, and the
client localises it through `Intl.DisplayNames` — an English country name baked
in here would show up as English in a German UI, which is worse than nothing.

Blurbs are Wikidata's one-line descriptions, kept only where they say something
the name does not. "Nationalpark" under "Simien-Nationalpark" is dropped rather
than rendered as a caption that reads like a bug.
