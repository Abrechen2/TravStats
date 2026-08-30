# POI Phase D — import & enrichment — design

**Date:** 2026-08-25
**Rides:** undecided (see §9)
**Status:** DRAFT — §9 lists what the owner must settle first
**Follows:** `2026-08-23-poi-domain-design.md` §11, which scoped Phase D as
"CSV / Google Takeout / Maps-saved-places import via `ImportBatch`; EXIF-based
suggestions from trip photos — later, separate spec". This is that spec.

## 1. The finding that reorders the whole phase

Phase D reads like one feature. It is four, and they differ enormously in cost
because of one fact:

> **A Google Takeout "Saved" CSV carries a name, a note and a Maps URL. It
> carries no address and no coordinates.**

Verified 2026-08-25 against published documentation of the current export, and
consistent with the reader this repo already ships: `MapsExportRow` is
`{ name, cid, note, url }` (`frontend/src/lib/mapsExport.ts:18-23`) — there is
no coordinate field, because there is nothing to put in one.

`Place.lat` and `Place.lon` are **required, not nullable**
(`backend/prisma/schema.prisma`, `Place` block) — deliberately, since a POI is a
point. So every saved-places row must be geocoded before it can become a Place,
and geocoding is the expensive, rate-limited, wrong-answer-prone part. That
inverts the naive order of work. The four pieces, cheapest first:

| # | Piece | Needs geocoding? | New dependency? |
|---|---|---|---|
| 1 | Photo-coordinate suggestions from **Immich** albums | no — coordinates already stored | none |
| 2 | **CSV import** with explicit lat/lon columns | no | none |
| 3 | **Google Takeout** saved lists | **yes, every row** | none |
| 4 | **EXIF** from manually uploaded photos | no | yes — an EXIF reader |

## 2. What exists today (measured, not assumed)

- **The Maps reader already ships, pointed at the wrong domain.**
  `frontend/src/lib/mapsExport.ts` reads the localised Takeout CSV
  (`NAME_HEADERS`/`URL_HEADERS`/`NOTE_HEADERS`, line 47-49), extracts the Google
  feature id from the URL (`cidFromMapsUrl`, line 31) and mints
  `` `gmaps:${cid}` `` (`mapsExternalRef`, line 44). It feeds **lodging**
  (`MapsExportImportTile`). Phase D does not need to write this; it needs to
  stop it being lodging's private property.
- **`ImportBatch.places Place[]` already exists** — the foreign key is wired.
  But `IMPORT_DOMAINS = ["flight", "cruise", "lodging"]`
  (`backend/src/services/importBatchService.ts:14`) has no `"poi"`, the import
  log's `OR` filter (`:65-70`) does not look at `places`, `ImportBatchItem.kind`
  (`:93`) has no POI member, and **`revertImportBatch` (`:239`) has no POI
  branch while `asDomain` falls back to `"lodging"` (`:31`)**. A POI batch
  today would be invisible in the log and misrouted on revert. Unreachable at
  present because nothing creates one — but it is a trap armed and waiting.
- **A POI import adapter exists and is dead code.**
  `frontend/src/components/import/adapters/poiAdapter.tsx` exports
  `POI_IMPORT_READY = false` and `usePoiImportAdapter`, referenced nowhere.
  Its header comment claims `DOMAINS.poi.available` is `false`; it is `true`
  (`frontend/src/shared/domains.ts:47-53`). The comment is stale.
- **The import hub already shows an empty POI group.** `ImportSection.tsx:42`
  has no `poi` key in `listImporters`, so Settings → Import renders the POI
  group with `t("settings:import.noRoutes")`. The hole is visible to users now.
- **`Place.externalRef` — the dedup key — is written by no code.** The column is
  documented as `"osm:node/240109189"` and carries
  `@@unique([userId, externalRef])`, but `PlaceFormModal.tsx:65` copies
  lat/lon/name/address/city/country/category off a search hit and never sets
  `externalRef`. `grep "osm:"` finds nothing outside comments. The server-side
  dedup at `backend/src/routes/places.ts:220-229` (`deduped: true`) is therefore
  currently unreachable from the UI.
  **And in Postgres NULL does not collide under a unique index** — any number of
  ref-less places coexist. Idempotency exists only for rows that carry a ref.
- **Nothing in this repo parses EXIF.** No `exifr`, no `sharp`, no
  `exif-parser` in either `package.json`. The only EXIF anywhere is Immich's
  server-side `exifInfo`, read over HTTP
  (`backend/src/services/immich/immichClient.ts:137-147`).
- **Manually uploaded trip photos have no coordinates at all.**
  `backend/src/routes/trips.ts:1159-1168` writes `tripId, filename, mimetype,
  sizeBytes, sortIdx` and nothing else. `TripPhoto.lat/lon` are populated on
  exactly one path: `services/immich/immichImport.ts:232-243`. The schema
  comment promising "best-effort for manual uploads" describes an intent that
  was never implemented.
- **A suggestion engine already exists and already has the right manners.**
  `backend/src/services/places/visitSuggestions.ts` — `RADIUS_KM = { place: 15,
  lodging: 30, cruise_port: 40, flight: 60 }`, and its contract in the header:
  *"It proposes. It never ticks."* `buildAnchors` takes lodgings, cruise stops,
  flights and places. It takes no photo anchors — which is precisely the
  extension point Phase D wants.
- **The matching rules are already written down**, for lodging:
  `services/lodging/lodgingImportPreview.ts:74-140` — ref is PROVEN and may be
  skipped silently; name+city is a GUESS and must ask; proximity is a last
  resort and also asks. `proximityMatch.ts` (Haversine, skips unpinned rows) and
  `nameSimilarity.ts` are domain-neutral in shape.
- **`OSM_LODGING_VALUES` is exactly wrong for POIs.**
  `services/lodging/geocodeBackfill.ts:33` allow-lists OSM values after
  measuring that 7 of 21 Photon answers were "a charging station, a restaurant,
  a locality or a sawmill". For a POI import, a restaurant and a museum are the
  *point*. This list cannot be reused; §5 says what replaces it.

## 3. Identity, before anything else

Every import decision follows from what counts as "the same place".

**The rule:** `externalRef` is the only proven identity. It gets a namespace
prefix and is minted from the source, never from a name:

| source | ref | note |
|---|---|---|
| Google Takeout | `gmaps:<cid>` | `mapsExport.ts` already mints it |
| Photon/OSM search hit | `osm:<type>/<id>` | the documented scheme **nothing writes today** |
| CSV with an explicit id column | `csv:<user-supplied>` | user's own key, namespaced so it cannot collide with the above |
| hand-entered, no source | `null` | not identifiable, and honestly so |

Two consequences worth stating plainly:

1. **Fix the picker as part of this work.** `PlaceFormModal` must write
   `osm:<type>/<id>` from the Photon hit. Without it, a user who adds the
   Colosseum by hand and later imports it from Takeout gets two Colosseums, and
   the unique index that was built to prevent exactly that never fires. This is
   a small change and it is a precondition, not a nice-to-have.
2. **Ref-less rows cannot be deduped by the database.** They fall to the
   name+proximity GUESS path, which asks rather than decides.

## 4. Piece 1 — photo coordinates that already exist (recommended first)

Immich-imported trip photos already carry `lat`/`lon`/`takenAt`. A trip with a
linked Immich album is therefore already a list of geo-located, dated points,
sitting unused.

Add a fifth anchor kind to `buildAnchors` — `photo`, radius **1 km** (much
tighter than the others: a photo's GPS fix is a real position, not a proxy like
"the airport you flew into"). Feed it `TripPhoto` rows with non-null `lat/lon`.
The existing engine then does the rest, and its "it proposes, it never ticks"
contract carries over unchanged.

This is the highest ratio of user-visible value to work in the whole phase: no
new dependency, no geocoding, no new import pipeline, no file handling. It also
does something no import can — it suggests places the user *went to* rather
than places they *bookmarked*.

## 5. Piece 2 — CSV with coordinates

A plain `placeCsv.ts` mirroring `lodgingCsv.ts`: field list, German-first
aliases, `buildPlaceMappingFields` for the generic `ColumnMappingWizard`.

Columns: `name` (required), `lat`, `lon`, `category`, `address`, `city`,
`country`, `notes`, `visitedAt`, `list`, `externalRef`.

**If `lat`/`lon` are present, no geocoding happens.** That is the whole reason
this piece is cheap, and it is also the escape hatch for anyone whose Takeout
file the geocoder cannot resolve: export, fill in coordinates, re-import.

Rows without coordinates are the same problem as §6 and take the same path.

Backend: `/api/v1/place-import` with `preview` and `commit`, modelled on
`lodgingImport.ts`. Copy these properties deliberately — they are the ones that
were learned the hard way:

- every row in its own try/catch, **a failed row never fails the batch**;
- `P2002` on `externalRef` is a **SKIP, not a failure** — this is what makes
  re-import a no-op;
- failures collapse to a fixed enum, raw Prisma errors never reach the body;
- IDOR guard on any client-supplied id;
- `MAX_PLACE_IMPORT_ROWS = 1000`, matching lodging.

## 6. Piece 3 — Google Takeout, and the geocoding wall

Takeout gives two things, and they are not equally useful:

- **Saved lists → one CSV per list**, name + note + Maps URL. **No
  coordinates.** One list per file maps naturally onto one `PlaceList` — the
  file name is the list name.
- **Starred places → GeoJSON**, which *does* carry geometry.

> **Unverified and deliberately left so:** the exact property names inside that
> GeoJSON. Published guides describe the file but do not quote its fields, and
> Google has changed this export more than once. The implementer must open a
> real export and read it. Writing field names into this spec from memory is
> exactly how the `osm:` scheme in §2 came to be documented but never
> implemented.

Prefer the GeoJSON path where a user has both: it needs no geocoding.

For the CSV path, N rows means N geocoder calls, and the ceiling is real:
`photonSearchLimiter` allows 30/min (`middleware/rateLimit.ts:107`) and
Nominatim is throttled process-wide to 1/s (`services/geo/nominatim.ts:14`). A
300-place "Want to go" list is a ten-minute job at best.

So: **geocoding is a background job after commit, not a step inside it** — the
pattern `backfillLodgingLocations` already establishes
(`routes/lodgingImport.ts:74`, fire-and-forget on the batch id). But
`Place.lat/lon` are NOT NULL, so a place cannot be created and geocoded later
the way a lodging can. Three ways out, and this is a decision, not a detail:

- **(a) Import only what resolves.** Geocode during preview, show the user
  exactly what was found and what was not, commit the resolved rows. Honest and
  simple; the preview is slow for a large list.
- **(b) Make `Place.lat/lon` nullable.** Rejected: the POI design made them
  required on purpose, a coordinate-less place cannot be drawn, and this
  reverses a settled decision for the convenience of one importer.
- **(c) A staging table** of unresolved rows that become Places when a
  background job resolves them. Most correct, most machinery, and it invents a
  second half-place concept the UI must then explain.

**Recommendation: (a)**, with the preview geocoding in the background and
streaming results, and §5's "fill in the coordinates and re-import" as the
escape hatch for the rest. It is the only one of the three that adds no new
concept to the data model.

**The geocode answer must be checked, and `OSM_LODGING_VALUES` cannot do it.**
For POIs the useful check is not "is this the right kind of thing" — it is "is
this plausibly the thing named". Reuse `sameWord`-style name agreement
(`geocodeBackfill.ts:47`) and, where the source gives a city, require the
answer to sit in it. Anything else is `needs_input`, never a silent write. A
geocoder that confidently returns the wrong Colosseum is worse than one that
returns nothing, because nothing is visible and wrong is not.

## 7. Piece 4 — EXIF (greenfield, and the least urgent)

Needed only for **manually uploaded** photos; Immich users already get §4 free.

Requires a new dependency — `exifr` reads GPS from a buffer without native
bindings, which matters for this project's Docker image. Read on upload in
`routes/trips.ts` and in `routes/places/visitPhotos.ts`, store into the
`TripPhoto.lat/lon/takenAt` columns **that already exist and are already
populated by the Immich path** — so the schema comment stops lying and §4's
anchor gets a second source with no further work.

Three cautions:

- **EXIF is attacker-controlled input.** Parse defensively, cap what is read,
  and never let a malformed header fail an upload — a photo with broken EXIF is
  still a photo.
- **Do not backfill silently.** Existing photos keep their nulls unless the user
  asks for a re-scan.
- `PlaceVisitPhoto` has no `lat`/`lon`/`takenAt` columns at all. Adding them is
  a schema change; decide whether a place-visit photo needs its own coordinates
  when the visit already has a place.

## 8. Plumbing to fix regardless

These are small and mostly pre-existing defects that Phase D would otherwise
walk into:

1. `IMPORT_DOMAINS` gains `"poi"`; the log's `OR` filter gains
   `{ places: { some: {} } }`; `ImportBatchItem.kind` gains `"place"`;
   `ImportBatchSummary.counts` gains `places`; `ImportBatchDomain` in
   `frontend/src/lib/api/importBatches.ts:11` gains `"poi"`.
2. **`revertImportBatch` gains a POI branch.** Today `asDomain` falls back to
   `"lodging"` and a POI batch would be misrouted. A revert that deletes the
   wrong domain's rows is the worst failure available here, so this lands with
   a test before any code can create a POI batch.
3. `ImportLogSection.describeCounts` stops describing POI batches in hotel
   wording.
4. `mapsExport.ts` moves out of lodging's orbit into a shared importer module.
5. `poiAdapter.tsx` — flip `POI_IMPORT_READY`, wire it into `PlacesListPage`,
   fix the stale comment. Or delete it if §9.1 says imports live only in the
   hub.

## 9. Decisions for the owner

1. **Split the phase?** §4 (Immich photo suggestions) is small, needs nothing
   new, and delivers the most distinctive feature here. §6 (Takeout) is the
   biggest piece and the one gated on a geocoder. Shipping §4 alone as "Phase
   D1" is defensible; bundling all four is one long branch.
2. **The unresolved-rows question in §6** — (a) import only what resolves, (b)
   nullable coordinates, (c) staging table. The recommendation is (a). This one
   is hard to change later because it decides what a half-imported list means.
3. **Does the picker fix (§3.1) ride this branch or land on its own?** It is
   independently correct — the dedup index does nothing without it — and it is
   small. It could ship well before the rest of Phase D.
4. **Scope**: 2.6.0 is at rc.14. None of this is a candidate for that release.
   2.7.0 already holds #177's deferral.
