# Whole-venue suggestions from Dawarich

This extends the existing market-area detector with named shopping malls,
parks, zoos, theme parks and museum grounds. It uses public OSM boundaries,
not an AI provider or a manually maintained list of venues.

## Consent and optional features

`venueEnabled` is a separate, default-off consent. Existing `marketEnabled`
consent remains market-only. Either switch can be used independently, but
both require the own Dawarich connection, stay-scan consent and visible Places.
Turning off Places pauses collection; turning off either consent invalidates
in-flight work. Existing suggestions can still be reviewed. Immich, flights,
hotels and trips are optional; missing or ambiguous trips are never guessed.

Migration `venue_area_consent` only adds the default-off boolean to scan state.
It neither rewrites visits nor enables collection for existing accounts.
The settings API and its OpenAPI contract include the new field. No deployment
or account activation is performed by implementing this feature.

## Recognized areas

Explicit OSM tags are used: `shop=mall`, `leisure=park`, and `tourism=zoo`,
`tourism=theme_park` or `tourism=museum`. Existing market matching remains
unchanged. Ordinary shops, restaurants, generic attractions, retail land use,
forests and large protected regions do not imply a whole venue. Names alone
never make two venues the same entity.

Only named, complete and valid local polygons/multipolygons qualify. Holes
remain excluded. Point-only venues and broken geometry are reported as gaps;
no boundary is invented from a point or a convex hull. The existing local-area
and vertex limits also apply to large parks and museum grounds.

A park requires at least fifteen observed minutes; malls, zoos, theme parks and
museums require ten. Markets retain their five-minute threshold. All existing
interior-point, speed, accuracy and signal-gap guards still apply. These are
review heuristics, not proof of entry, opening hours or a purchased ticket.

## Nesting and review

Parts with the same explicit public identity and venue type can be grouped.
Different venue types are not grouped merely because they share a Wikidata ID.
Explicit cross-type parent links are rejected. Independent overlapping venues,
such as a museum inside a park, stay separate with a visible overlap warning.
Known independent places inside a larger non-market venue keep their stationary
suggestions. Accepted and rejected findings are never superseded as raw fragments.

New findings have `kind=venue` and carry `venueType` alongside original points,
time windows and OSM source URLs. The existing evidence `market` metadata key
is retained for wire compatibility. Old market evidence and fingerprints remain
valid. The review UI labels each venue type and displays safe source links.

Only confirmation creates a Place/PlaceVisit. Acceptance is idempotent and
retains OSM/Wikidata identity only if the user keeps the venue name and location.
Categories use the existing vocabulary: mall/market = shopping, park/zoo = nature,
museum = museum, theme park = entertainment. Independent existing visits are
not mistaken for visits to the entire venue.

## Public maps and limits

The broader query uses a separate `venue-v1` cache profile, while market-only
queries retain `market-v1`. Old narrower caches never masquerade as complete
venue maps. Both profiles share the existing global request lease, daily quota,
response-size limits, cache limits, expiry, and upstream backoff. No exact track,
point IDs or times are sent to Overpass. Approximate coarse regions are disclosed
only after consent. Missing map data leaves ordinary stay suggestions available.

A scan still selects at most 48 regions. Longer journeys can be checked in
shorter windows; loaded regions do not imply that every OSM venue has a usable
boundary. The UI reports partial results rather than asserting completeness.

## Validation

Tests cover every category, thresholds, missing boundaries, cache-profile
separation, separate consent, hidden Places, in-flight revocation, overlapping
independent venues, category/provenance on confirmation, idempotence and UI
failure handling. Synthetic fixtures belong only in isolated tests; any replay
of personal travel data stays outside the repository and production visit tables.

OSM references: [mall](https://wiki.openstreetmap.org/wiki/Tag:shop%3Dmall),
[park](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dpark),
[zoo](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dzoo),
[theme park](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dtheme_park),
[museum](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dmuseum).
