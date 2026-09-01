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

Hand-written, 35 rows across FOUR catalogues, edited by hand. Nothing
bulk-derived, so no attribution obligation attaches. The four differ in how
their coordinates were obtained, and the difference is worth keeping:

**The two 2007/antiquity lists (14 rows)** were written from common knowledge
with coordinates read off the sites. **`museum-warships` (14 rows)** — preserved
warships open to the public across the US, UK, Japan, Sweden and Germany — was
written the same way, on a separate branch, and merged here on 2026-09-01.

**New 7 Wonders of Nature (7 rows, added 2026-09-01)** was verified entry by
entry rather than recalled — two candidate Wikidata ids guessed from memory
turned out to be an Italian village and an American singer, which is exactly the
failure a plausible-looking coordinate hides. Four rows take their coordinates
from **Wikidata (CC0)**: Amazon `Q656597`, Iguazú `Q36332`, Jeju/Hallasan
`Q494645`, Table Mountain `Q213360`.

Three rows — Ha Long Bay, Komodo, Puerto Princesa — take theirs from
**OpenStreetMap (ODbL)**, because Wikidata rounds those to one or two decimals
and the result lands four kilometres inland or on the wrong side of the island.
Three hand-picked coordinates are not a substantial extract of a database, so no
share-alike obligation is triggered; recorded here anyway, because "we may" is
not the same as "nobody should have to ask where this came from".

### Why a natural wonder gets an anchor, not a centroid

A rainforest of 5.5 million km² has no point, and the geometric centre of one is
not a place anybody visits. Each row therefore pins a defensible ARRIVAL point
and **says so in its own blurb**, so the map pin never pretends to be the whole
thing: the Encontro das Águas near Manaus for the Amazon, the Loh Liang ranger
station for Komodo, Hallasan's summit for Jeju, the Garganta del Diablo for
Iguazú.

Two rows carry a country that is a choice rather than a fact — the Amazon spans
nine countries and Iguazú sits on a border — and both blurbs name the other side
rather than letting the single `isoCountryCode` column assert something untrue.
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

## `curated_places.biosphere.csv` — UNESCO Biosphere Reserves

| | |
|---|---|
| **Source** | [Wikidata](https://www.wikidata.org/) via the [Query Service](https://query.wikidata.org/) |
| **Licence** | **CC0 1.0** — public domain dedication, no attribution required |
| **Retrieved** | 2026-09-01 |
| **Rows** | 646 |
| **Generator** | `backend/scripts/build-biosphere-csv.mjs` (carries the query and the filters) |

**Do not hand-edit this file.** Regenerate it with the generator.

### The entity, and how we know it is the right one

`wd:Q158454` — "biosphere reserve (UNESCO protected area)". A bare
`?i wdt:P31 wd:Q158454` returns **764** items against an official register of
**~759**. That agreement is the evidence, and it is why the query does NOT walk
`P279*`: the superclass chain runs into "protected area" and returns 178,000.

Several namesakes carry the English label "biosphere reserve" and are *national*
designations, not the UNESCO one: `Q61453609` (German), `Q28055306` (Latvian),
`Q107990793` (Spanish), `Q28861739` (Moldovan). Matching on the label rather
than the id would silently pull those in.

### Why 646 and not 759 — the honest gap

Roughly **98** register entries exist on Wikidata as name-and-country stubs with
no coordinate at all. They are dropped in the generator rather than emitted at
0/0, which is most of the difference. **This catalogue is therefore incomplete
by construction, and the missing rows are an upstream data problem, not a
filter.** Re-running it later will pick up whatever has since been given
coordinates.

A further **14** are withdrawn designations (`pq:P582` / `wdt:P576`) — the 2017
US withdrawal of seventeen, North Norfolk Coast 2014, Lake Torne 2010, Bavarian
Forest 2006. Excluded, and deliberately NOT treated the way
`world-wonders-ancient` treats a vanished building: a wonder whose temple is
gone still has a site to stand on, whereas a withdrawn designation leaves
nothing to tick.

Ten more have no renderable name after the de → en → `mul` → Latin-script
ladder. That ladder matters: de → en alone left **35** reserves nameless.

### Transboundary reserves: one reserve, one row, and the register decides

Never two rows, and never a guess. `isoCountryCode` resolves in order: the sole
country if there is one; otherwise the register's own filing, read out of the
`P2520` link (legacy MABdb codes like `CZE-POL+01`, or a country path segment in
a directory URL). Seventeen resolved that way. Where neither works, the reserve
is **dropped and named on stderr** — ten cases, listed in the generator header.

**One real loss:** the Austrian half of Neusiedler See has no separate Wikidata
item, so it is absent. Most of the other nine are covered by a resolvable
sibling (Kopet Dag's Iranian side, Lake Fertö, Arly and Pendjari separately).

### Two imprecisions left in place on purpose

- Katon-Karagay and Katunskiy both point at the joint Great Altay register
  entry, so both take `KZ`. That is what the register says; it is not what a map
  says for the Russian half.
- El Vizcaíno, Parangalitza and Alto Orinoco-Casiquiare each exist twice
  upstream with different QIDs and coordinates ~50 km apart. Collapsing them
  would mean matching on NAME — precisely the identity the id scheme refuses to
  trust, because a renamed reserve must not become a new row and un-tick
  somebody's visit.

### The sanity band

The generator checks its own output against **580–800 rows** and fails loudly
outside it. If a future run falls outside, the answer is to find out what changed
upstream — widening the band is the wrong response to a signal working correctly.

## `curated_places.nationalparks.csv` — National parks, per country

| | |
|---|---|
| **Source** | [Wikidata](https://www.wikidata.org/) via the [Query Service](https://query.wikidata.org/) |
| **Licence** | **CC0 1.0** — public domain dedication, no attribution required |
| **Retrieved** | 2026-09-01 |
| **Rows** | 79 — `nationalparks-de` 16, `nationalparks-us` 63 |
| **Generator** | `backend/scripts/build-national-parks-csv.mjs` |

**Do not hand-edit this file.** Regenerate it with the generator.

### Why per country, and why the counts are asserted

A bare "national park" query returns **3,449** worldwide. "National park" is not
one thing: it is a designation each legal system defines for itself, so a global
list would be a list nobody can complete and nobody can check. One list per
country makes the count knowable — and the generator **asserts** it: 16 and 63,
throwing and printing what it dropped rather than shipping a wrong list.

### The trap that nearly passed silently

Eight US parks exist as TWO Wikidata items: the combined "… National Park and
Preserve" unit and a recently split-out park portion. Six of those portions have
no coordinates — so the obvious rule, "drop coordinate-less rows", yields
**exactly 63 rows with the wrong content**: Lake Clark and New River Gorge
missing, Denali and Great Sand Dunes duplicated. The right count would have
signed off the wrong list.

Resolved by folding the pair onto its combined unit by name. `P361` (part of) is
NOT usable here — it points at tourism regions ("Mighty Five", "deserts of
California") as often as at a preserve.

### Three more things the query has to know

- **Rank.** Lake Clark files `protected area` at *preferred* rank and the
  national-park designation at *normal*, so `wdt:P31` — which returns preferred
  values only — hides the park completely. The query walks `p:P31 → ps:P31` and
  rejects only deprecated rank. (Verified independently: `Q712296` really does
  carry `Q473972` preferred and `Q34918903` normal.)
- **Qualified dissolution.** Virgin Islands NP carries `P576`, qualified
  *applies to part = biosphere reserve*: its MAB status lapsed, the park did not.
  A naive `NOT EXISTS { wdt:P576 }` deletes an open national park. Only
  UNQUALIFIED dissolutions count — which is what correctly drops General Grant NP
  (folded into Kings Canyon in 1940) and Nationalpark Elbtalaue (designated 1998,
  struck down by a court in 1999).
- **Where the rules are evaluated.** Rank and dissolution are filtered in JS, not
  SPARQL. Both were written as SPARQL first and pushed the query past the WDQS
  60-second ceiling (repeatable 504s); selected as bound variables it runs in
  under two seconds. Same rule, different evaluation site.

### Deliberate shapes

- **Wattenmeer is three rows** — Schleswig-Holstein, Niedersachsen and Hamburg
  are three state designations over one mudflat. Collapsing them would make 16
  unreachable.
- **`isoCountryCode` is a per-list constant**, not read from `P17`: the country
  *defines* the list, American Samoa and the Virgin Islands are US national parks
  whatever their own code says, and a missing `P17` must not silently produce a
  row the seeder then rejects.
- **A German label that does not contain "Nationalpark" is not the park's German
  name** and falls back to English. Gateway Arch's German label is still the
  pre-2018 "Jefferson National Expansion Memorial"; Kings Canyon's is the bare
  canyon.
- **Ids are QIDs**, never slugs. Gateway Arch renamed in 2018 and New River Gorge
  in 2020; a name-derived id would have survived neither and would have un-ticked
  every visit.
