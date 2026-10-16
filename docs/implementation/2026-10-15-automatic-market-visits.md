# Automatic market visits from Dawarich

Implemented on the branch `feat/dawarich-place-detection`. This implementation
does not deploy or enable anything on existing instances.
The [file prototype](2026-10-15-market-area-prototype.md) remains available as
an independent tool; the app now uses the same detector with an automatic map
catalogue and the existing confirmation flow.

## Behaviour

- Prerequisites are the user's own Dawarich connection, the Places module
  switched on and stay detection. An additional switch allows the market-area
  lookup. New and existing accounts have not given this permission by default.
- Immich, trips, flights and hotels are not prerequisites. Without trips the
  trip assignment stays empty. Overlapping or incompletely covered trips are not
  guessed. Immich visits can serve as evidence for existing visits.
- The existing six-hour scan covers the last seven days. Manually, 7/14/30 days
  can be chosen in the UI; the API allows 1–30. Long or truncated Dawarich
  answers are fetched day by day, at most 250,000 original points in total.
  Remaining gaps stay visible as a partial result.
- Only suggestions are created. Confirming creates at most one place/visit;
  confirming again is idempotent. Rejections stay in force on later scans.
  Existing matching market visits do not produce a new suggestion.
- A market visit suppresses stationary partial stays of the same visit. Older
  open partial suggestions are marked `superseded` atomically as soon as the new
  market suggestion is stored. Their source fields and evidence stay unchanged;
  the new evidence contains their IDs. A concurrent confirmation prevents the
  replacement. Accepted/rejected sources are not replaced.

## Automatic area lookup

The original track is binned locally into a worldwide 0.05° grid. Only regions
with at least five distinct timestamps across five minutes and no gap over ten
minutes are considered. There is no list of cities or market names. Queries
send grid bounds with a small margin, never original coordinate sequences,
times, point or user IDs. The public map service does learn approximate stay
regions this way; that is what the separate consent is for.

Overpass returns `amenity=marketplace` regardless of language and country. In
addition, named market buildings/grounds with an English `name:en` are taken
into account; ordinary shops, streets and supermarkets are not. Data quality
and tagging decide the coverage. Any market in Antananarivo works the same way
as one in Jeju when a suitable area exists; missing areas or untagged markets
are not invented. No AI service is needed.

Closed ways and complete multipolygon relations are taken over, including
holes. Single market points are not areas. Incomplete geometries are discarded
and counted. Partial areas with the same Wikidata ID are merged into one venue.
Proximity or similar names alone never join different markets.

## Cache and outages

- Public area data is stored without any personal reference in
  `market_catalog_tiles`. Fresh for 14 days, with a flagged fallback to data at
  most 90 days old. At most 2,048 stored regions. Source URLs and the OSM data
  timestamp are kept in the catalogue. Switching provider separates the cache.
- At most 48 selected regions and 24 new queries per scan; additional regions
  or unavailable answers produce visible partial results. A repeat uses the
  cache and fills in missing regions. Very long periods can be split with a
  shorter look-back.
- A database lease serialises fetches across accounts and processes. Shared
  daily limit: 80 requests; once 4 MB of payload has been received, no new
  request is allowed. A final answer is capped at 4 MB.
- A fetch has a 16-second time budget. After errors, network fetching ends for
  that scan; existing cache data is still evaluated. At least 30 seconds of
  shared back-off, and on 406/429 a longer `Retry-After` of up to 1 h. No
  parallel fetches and no automatic fallback to other servers.
- Without areas, the normal stay suggestions remain available. A map outage
  does not mean "no market visit". When consent is withdrawn, late answers are
  neither cached nor stored as a suggestion.

`MARKET_OVERPASS_URL` can set a different Overpass endpoint on the server. It
is not a URL users can write. Default: `https://overpass-api.de/api/interpreter`.

## Evidence and adoption

The suggestions contain the original Dawarich point IDs and time windows, area
IDs, public sources, the number of points inside and the uncertainties.
Borderline cases stay for manual review. A fully detected market is adopted as
`shopping`, `dataSource=dawarich` with an OSM/Wikidata reference. If the user
changes the name or position substantially, these references are not attached
to the corrected new place. Existing own places may be recognised by name or
public identity; a shop inside the market does not count as the market already
being recorded.

## Migration and validation

Migration `20261015020000_market_area_catalog` adds two optional scan fields
and two catalogue tables. It does not change any trip or visit data. Before an
instance enables it, the migration and the application must be deployed
together. Deployment and container changes need the existing approval; in
particular, Prod was not changed.

Tests cover geometries, slow drive-throughs, edge tolerance, pauses, duplicate
points, worldwide grids, the cache, answer limits, budget leases, consent
withdrawal, replacing old data, existing visits and repeated confirmation. Real
Korea position data was checked only in an isolated local copy. Private results
do not belong in the repository.

Sources: [OSM marketplace](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dmarketplace),
[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API),
[Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).
