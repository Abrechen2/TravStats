# Market visits from position data — preview prototype

> The file prototype remains usable on its own. The app integration built since
> is described in [Automatic market visits](2026-10-15-automatic-market-visits.md).

## Scope

Rule-based detection of a visit to a whole market area, even when someone moves
between stalls and several market buildings. No AI call. This prototype runs
only on explicitly supplied files. It is not yet connected to the scan API, the
scheduler, the suggestion list or the confirmation workflow. No database, no
credentials, no network query and no change to Prod. The existing stay
detection stays unchanged.

## Usage

From the backend working directory:

```sh
node_modules/.bin/tsx scripts/preview-market-visits.ts \
  /private/input.json /private/markets.geojson /private/new-preview.json
```

The input contains `points` in the existing `DawarichPoint` format. Optional:
`places`, `visits`, `trips`, each from a separate read-only extract. Detection
still works without trips, Immich, hotels or flights; without existing visits
only their recognition is impossible.

The market catalogue is a GeoJSON FeatureCollection. A feature needs
`properties.kind = "market"`, `id`, `name`, `sourceUrl` and a Polygon or
MultiPolygon geometry. Coordinate order is `[lon, lat]`. An optional `entityRef`
(`wikidata:Q…`) joins several areas of the same place; `parentId` explicitly
groups related partial areas under a parent market. Similar names or spatial
proximity are not enough for that.

A point geometry is reported as `areaMissing`. No circle is invented as a
supposed market area. A shop with `kind = "shop"` is not processed as a market.
Ambiguous overlapping markets stay separate and are flagged with
`overlappingMarkets`.

The output file is written with mode 0600 and exclusive creation. Existing
files, input files in particular, are never overwritten. Truncated tracks are
refused for this trip preview.

## Conservative rules

- At least five minutes, five distinct timestamps and three points actually
  inside the area. Points inside must span at least two minutes; merely
  standing at the edge is not enough.
- At most 20 m of edge tolerance; it does not grow with poor GPS accuracy.
- A reported inaccuracy above 100 m and invalid coordinates, speeds and
  timestamps are excluded.
- At most 3 m/s. A missing speed can be derived from the movement over short
  measurement intervals. A reported zero speed does not override clearly fast
  movement either; the derivation takes the reported inaccuracy of both points
  into account.
- Up to ten minutes between matching points; an observed absence of at least
  two minutes separates visits. Short interruptions and measurement gaps stay
  visible as uncertainties.
- Polygon holes stay excluded. Different buildings of one MultiPolygon count as
  the same market; the same public place identifier joins, for example, a hall
  and the surrounding market grounds.
- Original point IDs, the area IDs used, sources and uncertainties stay on the
  result. Input order does not change it.
- Existing visits are recognised only with a matching market name AND a
  matching location/time. A single shop inside the market does not replace a
  market visit. Precise times have a ten-minute matching tolerance; day values
  are compared on the local calendar day. Ambiguous old minute values are not
  silently read as UTC.
- Trip assignment only to a single clearly matching trip whose days cover the
  whole visit. No trip is created.

## Result of the private real-data check

On the Korea extract already obtained read-only, with 62,902 original position
points, the final prototype finds four market visits. Two match existing
entries; two remain new suggestions for review. In particular, several areas of
the same market are merged into one visit. The exact places, times, point IDs
and input data are kept only in the private workbook, not in the public
repository.

A duplicate result first observed for a hall and its grounds was fixed by
merging on the same public place identifier. Matching against an already
recorded visit then takes the combined areas into account. Missing areas are
reported as a data gap, not as proof that no visit took place.

Checked: repetition and reversed input order, original point IDs only,
unchanged sources, existing visits, standalone use without other travel
features, drive-past counter-examples and agreement between the CLI and the
library output. No automatic adoption and no writes to Prod.

## Open steps for a regular feature

1. A bounded, cached area catalogue with clean provenance and updates. The
   prototype reads a catalogue prepared beforehand; a worldwide automatic
   market search is therefore not implemented yet.
2. Show data gaps and point-only places understandably in the UI; add a
   verified area where needed. No unchecked vendor points as markets.
3. Connect to the existing consent, module pause and scan reservation.
4. Store suggestions durably with their sources, including recognition across
   growing time windows and already rejected suggestions. The current
   fingerprint is stable only for repeats of the same data extract.
5. Shared review/confirmation with the existing stay and Immich suggestions,
   and matching against visits added in the meantime.

This work and a deployment were not done here. Even a solid market stay stays a
suggestion at first — not an automatically confirmed visit and not evidence of
a purchase.

## Technical checks

- 46 targeted tests passed (new detection core, file CLI and the existing
  stationary detection); the new tests need neither a database nor a network.
- Backend typecheck passed; 1,193 backend test files additionally checked with
  no type errors.
- CLI typechecked separately with `tsc -p tsconfig.market-preview.json`. With
  locally linked dependencies, `--preserveSymlinks` may be needed.
- Lint of the new backend modules, formatting and the file-size check passed.
- Eleven additional control conditions on the private real data passed;
  compared with the earlier independent geographic analysis.
