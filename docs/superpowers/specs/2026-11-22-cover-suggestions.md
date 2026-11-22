# Cover suggestions ("Deckblatt vorschlagen")

Owner, 2026-11-22: a suggestion, inside the trip, for the cover photo — a
beautiful photo that shows where you are, and that you are in yourself.

Nothing is set automatically. The server proposes up to three photos with
reasons; the user picks one; the cover is written through a cover route.

## Provider capabilities (from the API sources, nothing called live)

| Need | Immich | PhotoPrism |
|---|---|---|
| Photos of a person | `POST /search/metadata` body `personIds: [id]` (flat field, as `takenAfter`, which the code already uses) | `GET /photos?subject=<UID>` (`form:"subject"`, alias of people) |
| List people | `GET /people?page&size&withHidden=false` -> `{people:[{id,name,isHidden}], hasNextPage}`; unnamed clusters have an empty name | `GET /subjects?type=person&count=N&hidden=no` (`count` is required by the form) -> `[{UID, Name, Hidden}]` |
| Favourite | asset `isFavorite` | photo `Favorite` |
| Rating | none (favourite only) | photo `Quality` (0-7; >= 5 counts as high) |
| Dimensions | `exifInfo.exifImageWidth/Height` (needs `withExif`, already sent) | `Width`, `Height` |
| Camera | `exifInfo.make` | `CameraMake` |
| GPS | `exifInfo.latitude/longitude` | `Lat`, `Lng` (0/0 = none) |
| Smart search | `POST /search/smart {query}` exists (CLIP) | none |

Smart search is deliberately NOT used in this slice: a CLIP query for "scenic"
is a weak, Immich-only signal that would need a tuned vocabulary and a second
code path; the place signal below already carries "where you are".

## Candidates

The trip's photos from every route: `TripPhoto` rows (uploads and imported
copies), photos of linked albums (link mode; import mode is already a
`TripPhoto`) and `EntryPhotoLink`s of the trip's flights, stays, rail, bus,
ferry and rental entries. One photo reached by several routes counts once
(copy > album > entry link). Capture time must fall inside the trip (start day
minus 14 h to end day plus 38 h, zones of single photos being unknown). A trip
without dates abstains (`noTripDates`). Metadata for every route comes from one
time-window search per source, overlaid with the albums' own listing.

## Score (sum of named reasons; the reasons are returned)

| Reason | Points |
|---|---|
| `me`: the account's chosen person is in the photo | 40 |
| `placeClose`: GPS within 2 km of a stay of the trip or a place visited on it | 25 |
| `placeNearby`: within 15 km of one | 10 |
| `favorite` | 20 |
| `highQuality` (PhotoPrism Quality >= 5) | 8 |
| `landscape` (w/h >= 1.2) | 8 |
| `resolution` (>= 8 MP: 6, >= 2 MP: 3) | 6 / 3 |

Unknown values earn nothing and cost nothing. Excluded outright: videos,
non-images, file names like screenshot/scan/document, PNG without a camera
make. Threshold 30: quality signals alone reach at most 22, so a trip with
nothing but decent-looking photos abstains (`noneQualified`) instead of
offering the least bad one. Bursts: frames within 5 s of a better kept one are
dropped. Ranking: score, then earlier capture time, then key.

## "Das bin ich"

Per source, in the account settings on the Immich / PhotoPrism cards. The
people list is read from the source when the picker opens; only the chosen id
is stored (`user_settings.immich_self_person_id`, `photoprism_self_person_id`).
`PUT` validates the id against the source's current people. No face data is
stored, nothing leaves the account.

## API

- `GET /trips/:id/cover-suggestions` -> `{suggestions[<=3], abstained, sources[]}`.
  `sources[].photos` / `.people` is `ok`, `notSet` (people only) or a failure
  kind; one failing source never blanks the others.
- Apply through the existing `POST /trips/:id/immich/cover` (album) and
  `POST /trips/:id/photos/:photoId/cover` (copy); entry-linked photos belong to
  no album, so `POST /trips/:id/cover/entry-photo {linkId}` is new.
- `GET /settings/photo-sources/:provider/people`, `PUT .../self {personId|null}`.

Contract: additive only; Companion needs nothing.
