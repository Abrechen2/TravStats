# POI Domain (Places, Lists & Checklists) — Design Spec

**Date:** 2026-08-23
**Status:** Design draft — three open decisions for the owner (§12), no code written
**Source:** Owner brief (custom place lists + shipped checklists with photo proof)
plus GitHub #177 (*Option to show POIs of trips on the dashboard map*), which
constrains the whole design.
**Domain key:** `poi` (already reserved in `backend/src/shared/domains.ts`,
`available: false`, `routePrefix: '/places'`, colour `#5ec2b2`, icon 📍)

## 1. What this is

Two features that the owner brief describes as one:

1. **Custom lists of places.** "Every McDonald's I have been to, worldwide."
   The user defines the list, adds places to it, and the list is a first-class
   thing with its own page, its own map layer, its own count.
2. **Shipped checklists.** "New 7 Wonders" ships with the app; the user ticks
   items off and attaches a photo as proof.

Plus the integration that makes both worth having: **the globe** and **trips**.

They are one feature because both are collections of the same primitive — a
place the user has (or wants to have) been to. The difference is only who
authored the list.

### Goals

- One place entity that works standalone *and* inside a trip.
- User-defined lists, arbitrary many, with colour/icon, shown on the globe.
- Shipped checklists with progress and photo proof.
- Trip POIs and global POIs are **the same data** — this is the hard requirement
  from #177, not a nice-to-have (see §3).
- Search-as-you-type place lookup, reusing the geocoder that already ships.

### Non-goals (this spec)

- A POI *parser* (email/PDF). `PARSER_SUPPORTED_DOMAINS` stays
  `flight | cruise | lodging`. Places are entered by hand or imported from a
  file (Phase D).
- Reviews/ratings as a social feature. A private note and an optional 1–5 is
  enough; nothing leaves the instance.
- Routing between places. A place is a point, not a leg.

## 2. What exists today (measured, not assumed)

| Thing | State | File |
|---|---|---|
| `poi` domain descriptor | stub, `available: false` | `backend/src/shared/domains.ts` + frontend mirror |
| Dashboard POI tab | placeholder panel (emoji + one line), beta-gated as `poiDashboardTab` | `frontend/src/components/Dashboard/tabs/PoiTab.tsx` |
| POI dashboard modes | **already registered**: `["markers", "heatmap"]`, default `markers` | `frontend/src/types/dashboard.ts` |
| Actual POIs today | `TripStop` rows with `domain: "poi"` — trip-scoped only, no global existence | `schema.prisma:938` |
| Place search | Photon + Nominatim + Google Places, with a `degraded` flag for a dead geocoder | `backend/src/services/geo/`, `routes/geo.ts` → `/api/v1/geo` |
| Search-as-you-type UI | `LocationInput`, `LocationSuggestions`, `LocationMapModal`, `useLocationSearch` | `frontend/src/components/location/` |
| Map pin layer | `buildLodgingPins` — dots, labels, declutter, zoom-budgeted label priority | `frontend/src/components/layers/lodgingPinsLayer.ts` |
| Dot sizing contract | shared by airports/ports/lodging, pinned by a parity test | `layers/markerDotStyle.ts`, `dotSizeParity.test.ts` |
| Colour-mode pattern | explicit modes + store + legend, never hardcoded | `lib/lodgingColor.ts`, `lib/cruiseColor.ts` |
| Timeline merge | typed `kind` events merged and ordered; `lodging-checkin`, `journal`, … | `frontend/src/lib/tripTimeline.ts` |
| Photos | `TripPhoto` (uploads + Immich import) and a checked Immich asset proxy | `schema.prisma:869`, `routes/immich/assetProxy.ts` |
| Achievements | `checkAndUpdateAchievements(userId)`, fire-and-forget from domain routes | `backend/src/utils/achievements.ts` |
| Seeded catalogs | `Port`, `Ship`, `LodgingChain` from CSV, idempotent, `isUserAdded` escape hatch | `backend/src/seedData/`, `seed*FromCSV.ts` |

**The lodging spec promised this.** `2026-07-04-lodging-domain-design.md` §Decisions:
*"POI is a separate future domain (the existing `poi` stub) — not built here; the
geocoding + map-layer utilities are built reusable so POI docks onto them."*
That promise was kept. This spec is the docking.

### Related issues

- **#177 (open)** — show trip POIs on the dashboard map. Contains the design
  constraint quoted in §3.
- **#175 (closed)** — POIs on the trip timeline need a *time*, not just a date,
  to order several POIs within one day.
- **#176 (closed)** — POIs on the trip map need labels.

#175 and #176 were fixed against `TripStop`. Both fixes must survive the move
described in §4 — a regression there is a user-visible regression of shipped
behaviour, so both get a pinned test.

## 3. The one decision everything else follows from

The #177 reporter wrote:

> May this could be resolved on adding the global POI feature. I think they have
> to be **synced** because otherwise there will be **two different kinds of POI**
> which would be very confusing.

That is correct and it is the spine of this design. There are two ways to satisfy
#177:

- **(a) Project trip stops onto the global map.** Read `TripStop where domain='poi'`
  and draw it. Cheap — perhaps two days. But a POI then only exists if it belongs
  to a trip, so "every McDonald's I've been to" is unbuildable without inventing
  a fake trip, and a place visited on two trips is two unrelated rows that no
  count can ever reconcile.
- **(b) Promote the place to a first-class entity, and make the trip a *view* of it.**
  More work, and it needs a migration of live user data. But it is the only shape
  in which the owner's actual request (lists across trips, checklists, a count of
  distinct places) is expressible at all.

**This spec picks (b).** Under (a) the owner's brief cannot be built later without
doing (b) anyway, on top of more data.

The shape is not new: **`Lodging` (the place) + `LodgingStay` (the visit)** is
exactly this split, already shipped, already reviewed, already understood by the
codebase. POI mirrors it one-to-one, which is also what makes the work estimable.

```
Lodging  ──< LodgingStay >──  Trip        (shipped)
Place    ──< PlaceVisit  >──  Trip        (this spec)
```

## 4. Model

### 4.1 `Place` — the thing in the world

Per-user, like `Lodging`. Not a global catalog: on a shared instance, my
McDonald's list is nobody else's business.

```prisma
model Place {
  id     String @id @default(uuid())
  userId String @map("user_id")

  name     String
  /// Free-form-but-registered category driving the pin icon and the default
  /// colour mode: restaurant | landmark | nature | museum | stadium | bar |
  /// beach | viewpoint | other. Mirrored in frontend/src/shared/placeCategories.ts.
  category String @default("other")

  /// A place without coordinates cannot be drawn, and drawing is the point —
  /// so unlike Lodging.lat/lon these are REQUIRED. The picker always yields a
  /// position (search hit, map click, or manual entry), so there is no path
  /// that produces a coordinate-less place.
  lat Float
  lon Float

  address        String?
  city           String?
  country        String?
  /// ISO 3166-1 alpha-2 derived from `country`, same contract as Lodging:
  /// everything that GROUPS or COUNTS joins on this, never on the free text.
  isoCountryCode String? @map("iso_country_code")

  /// Provenance from the geocoder, e.g. "osm:node/240109189" or
  /// "google:ChIJ...". Enables dedup on re-import and a later enrichment pass.
  externalRef String? @map("external_ref")

  /// Set when this place was materialised by ticking a curated checklist item
  /// (§5). Null for anything the user created themselves.
  curatedItemId String? @map("curated_item_id")

  /// Has the user actually been here, or is it only on the wishlist? Same
  /// question Lodging.visited answers, same reason: a saved-places export mixes
  /// both and only the user knows which is which. NOTE the different default —
  /// see §4.3.
  visited Boolean @default(false)

  notes      String?
  dataSource String? @map("data_source") // manual | import | curated
  batchId    String? @map("batch_id")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  batch       ImportBatch?     @relation(fields: [batchId], references: [id], onDelete: SetNull)
  visits      PlaceVisit[]
  listEntries PlaceListEntry[]

  @@unique([userId, externalRef])
  @@unique([userId, curatedItemId])
  @@index([userId])
  @@index([userId, category])
  @@index([userId, visited])
  @@map("places")
}
```

`@@unique([userId, externalRef])` is the dedup key — the same McDonald's picked
twice from search is one row. Postgres treats NULLs as distinct, so hand-entered
places (no `externalRef`) are never blocked by it. That is the same trade
`Lodging` already makes.

### 4.2 `PlaceVisit` — the visit

Mirrors `LodgingStay`. This is what **replaces `TripStop{domain:'poi'}`**, and it
is why #175 is satisfied for free.

```prisma
model PlaceVisit {
  id      String  @id @default(uuid())
  placeId String  @map("place_id")
  userId  String  @map("user_id")
  tripId  String? @map("trip_id")

  /// Local wall-clock at the place — do NOT normalize to UTC (the same
  /// reasoning tripTimeline.ts already documents for TripStop: there is no
  /// timezone column, and inventing one would be worse than the honest local
  /// reading).
  ///
  /// Carries a TIME, not just a date — that is #175, which needed a second
  /// POI on the same day to sort correctly. Nullable: a place you know you
  /// visited but cannot date is still a visit (the Lodging 2.7 precedent).
  visitedAt DateTime? @map("visited_at")

  /// Tie-break within a day when two visits share a timestamp, or when
  /// visitedAt is null and the user dragged them into an order.
  orderIdx Int @default(0) @map("order_idx")

  notes  String?
  rating Int?    // 1..5, optional, private

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  place  Place            @relation(fields: [placeId], references: [id], onDelete: Cascade)
  user   User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  trip   Trip?            @relation(fields: [tripId], references: [id], onDelete: SetNull)
  photos PlaceVisitPhoto[]

  @@index([userId])
  @@index([placeId])
  @@index([tripId])
  @@index([userId, visitedAt])
  @@map("place_visits")
}
```

`onDelete: SetNull` on `tripId` matches `Booking.tripId`: deleting a trip must
not delete the evidence that you stood in front of the Great Wall.

### 4.3 The `visited` / visit relationship — and the counting rule

There are two different questions and the model must not conflate them:

- `Place.visited` — *does this belong to my logbook, or my wishlist?*
- `PlaceVisit` — *when was I there?*

A place can be `visited = true` with **zero** visit rows (I've been to that
Maccis, no idea when — the dateless case #4.2 allows). A place can be
`visited = false` with zero visits (wishlist / unticked checklist item).

**Counting rule, consistent with the lodging rule and the status-blind-counts
work (`2026-08-18-status-blind-counts-findings.md`):** counts derive from
**data and dates, never from a status string**.

- "Places visited" counts `Place where visited = true`.
- A **future-dated** visit does not count as visited — a planned stop at the
  Colosseum next month is not a visit. `visitedAt > now()` is excluded from
  every count and from the "visited" map layer, exactly as a not-yet-checked-out
  stay is.
- Ticking a checklist item sets `visited = true` **and** writes a visit row, so
  the two never disagree for the case the user actually cares about.

`Place.visited` defaults to **`false`** — deliberately the opposite of
`Lodging.visited`'s `true`. Lodging chose `true` because every row that predated
the column described a real stay. Places have no such history: the dominant
creation path here is *adding a target to a list*, and a wishlist entry silently
counted as visited would inflate the headline number on day one.

> Consequence to handle in the API layer: the "log a place I just visited" path
> must set `visited: true` explicitly. Getting this wrong is silent and only
> visible in a count, so it gets a route-level test, not just a schema default.

### 4.4 Lists

```prisma
model PlaceList {
  id     String @id @default(uuid())
  userId String @map("user_id")

  name        String
  description String?
  color       String  @default("#5ec2b2") // defaults to the poi domain colour
  icon        String? // emoji, like Trip.icon
  sortIdx     Int     @default(0) @map("sort_idx")

  /// Non-null when this list is the user's subscription to a shipped
  /// checklist (§5) — e.g. "world-wonders-new7". Null for a hand-made list.
  /// A subscribed list's name/items are not user-editable; its colour is.
  curatedKey String? @map("curated_key")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user    User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries PlaceListEntry[]

  @@unique([userId, curatedKey])
  @@index([userId])
  @@map("place_lists")
}

model PlaceListEntry {
  id      String @id @default(uuid())
  listId  String @map("list_id")
  placeId String @map("place_id")
  sortIdx Int    @default(0) @map("sort_idx")

  list  PlaceList @relation(fields: [listId], references: [id], onDelete: Cascade)
  place Place     @relation(fields: [placeId], references: [id], onDelete: Cascade)

  @@unique([listId, placeId])
  @@index([listId])
  @@index([placeId])
  @@map("place_list_entries")
}
```

A place may be in many lists (a McDonald's at the Trevi Fountain is in
"Maccis" *and* "Rome"), which is why membership is its own table rather than a
column.

## 5. Shipped checklists

A checklist is reference data the instance ships — the same category of thing as
`Port`, `Ship` and `LodgingChain`, all three of which already seed from CSV
idempotently.

```prisma
/// Ships with the app. Global, read-only, seeded from CSV. Never user-owned —
/// a user's *progress* against it lives in their own Place/PlaceVisit rows.
model CuratedList {
  key         String @id            // "world-wonders-new7"
  name        String                // "Neue 7 Weltwunder"
  description String?
  icon        String?
  sortIdx     Int    @default(0) @map("sort_idx")

  items CuratedPlace[]

  @@map("curated_lists")
}

model CuratedPlace {
  id      String @id                // "world-wonders-new7:great-wall"
  listKey String @map("list_key")

  name           String
  lat            Float
  lon            Float
  country        String?
  isoCountryCode String? @map("iso_country_code")
  blurb          String?
  sortIdx        Int     @default(0) @map("sort_idx")

  list CuratedList @relation(fields: [listKey], references: [key], onDelete: Cascade)

  @@index([listKey])
  @@map("curated_places")
}
```

### How progress works — lazy materialisation

Subscribing to a checklist creates **one** row (`PlaceList` with `curatedKey`),
not N copies of the catalog. The checklist page renders `CuratedPlace` items
LEFT-JOINed to the user's `Place` rows on `curatedItemId`:

- **unticked** — no matching `Place`. Rendered from catalog data, and (optionally)
  drawn on the map as a *ghost* pin, visually distinct.
- **ticked** — a real `Place` exists, with `visited = true`, a `PlaceVisit`, and
  any photos. From this moment it is an ordinary place in the logbook,
  indistinguishable on the globe from a hand-added one.

Ticking is therefore a create:

```ts
// POST /api/v1/places/curated/:itemId/visit
const item = await prisma.curatedPlace.findUnique({ where: { id: itemId } });
if (!item) return res.status(404).json({ error: "notFound" });

const place = await prisma.place.upsert({
  where: { userId_curatedItemId: { userId, curatedItemId: item.id } },
  create: {
    userId,
    curatedItemId: item.id,
    name: item.name,
    category: "landmark",
    lat: item.lat,
    lon: item.lon,
    country: item.country,
    isoCountryCode: item.isoCountryCode,
    visited: true,
    dataSource: "curated",
  },
  update: { visited: true },
});
```

**Why lazy rather than copy-on-subscribe.** Copying is simpler to write, and for
seven wonders it would be fine. It stops being fine at the lists that obviously
come next — UNESCO World Heritage (~1200), US National Parks (63), Michelin
stars — where every subscriber gets a full copy of a catalog they have mostly not
visited, and where a corrected coordinate in 2.9 never reaches anyone who
subscribed in 2.8. Lazy also keeps §3's promise literally true: **every pin on
the globe is a `Place`**, and a `CuratedPlace` is a target, not a pin.

The cost is honest and worth stating: the checklist screen is the one screen in
the app that renders two kinds of row. That is acceptable because a checklist is
not the logbook — the ghost row *is* the unticked state, and it must look
different or the checklist has no meaning.

### Seed content, v1

`backend/src/seedData/curated_places.csv`, seeded by `seedCuratedPlacesFromCSV.ts`,
idempotent on `id` like the port/ship seeds. Ship exactly two lists at first:

- `world-wonders-new7` — New 7 Wonders (7 items)
- `world-wonders-ancient` — Ancient 7 Wonders (7 items; six no longer stand,
  which is a feature — the blurb says so, and a "visit" means the site)

Two lists is enough to prove the mechanism without committing to curating a
1200-row UNESCO CSV before anyone has asked for it.

> Licensing note before adding more: coordinates and names from OSM are ODbL and
> need attribution; a hand-curated 7-row CSV is not a database extract. Anything
> bulk-derived gets its source and licence recorded in the CSV header — the
> marnet vendoring set that precedent.

## 6. Migrating the POIs that already exist

Live data: `TripStop` rows with `domain = 'poi'`. They must become
`Place` + `PlaceVisit` without the user losing a thing.

```sql
-- migration: 20260823HHMMSS_poi_domain
-- 1. one Place per distinct (user, title, rounded position)
INSERT INTO places (id, user_id, name, category, lat, lon, visited, notes, data_source, created_at, updated_at)
SELECT gen_random_uuid(), t.user_id, s.title, 'other', s.lat, s.lon, true, s.notes, 'manual', s.created_at, s.updated_at
FROM trip_stops s
JOIN trips t ON t.id = s.trip_id
WHERE s.domain = 'poi' AND s.lat IS NOT NULL AND s.lon IS NOT NULL
-- dedup: same user, same name, same position to ~11 m
GROUP BY t.user_id, s.title, s.lat, s.lon, s.notes, s.created_at, s.updated_at;

-- 2. one PlaceVisit per original stop, keeping trip link and date
-- 3. DELETE the migrated trip_stops rows
```

Three things this must get right, each of which is a way to lose data:

1. **Coordinate-less POI stops.** `TripStop.lat/lon` are nullable; `Place.lat/lon`
   are not. Rows without a position **are not migrated and are not deleted** —
   they stay `TripStop`s with `domain = 'poi'`, and the timeline keeps rendering
   them as it does today. Deleting them would destroy user text to satisfy a
   schema. (Expected count is small; the migration logs it.)
2. **`TripStop` is not POI-only.** `domain` also carries `hotel`, `train`, `hike`
   and null. Only `domain = 'poi'` moves. `TripStop` survives as the generic
   timeline primitive.
3. **Reversibility.** The `DELETE` in step 3 is the irreversible part. It ships in
   a *separate* migration one release after the copy, so a bad backfill is
   recoverable from rows still present. Standard expand/contract.

**#175 and #176 must not regress.** #175 (a time on POIs) is carried by
`PlaceVisit.visitedAt` being a `DateTime`; #176 (labels on the trip map) is
carried by the new pin layer's label pass (§7.1). Both get a test that names the
issue number, because both are already-shipped behaviour that a rewrite is
otherwise free to drop silently.

## 7. Frontend

### 7.1 Map layer

`frontend/src/components/layers/placePinsLayer.ts`, built as a near-copy of
`lodgingPinsLayer.ts` — same `markerDotStyle` radius props (the parity test in
`dotSizeParity.test.ts` gets a `place` case so a POI dot cannot drift from an
airport/port/lodging dot), same `declutterByDistance` / `pickLabelled` label
budget, same tooltip contract.

Colour follows the established rule from CLAUDE.md — *layers AND the legend
resolve colour through a store, never hardcoded*. So `lib/placeColor.ts` +
`placeColorStore`, mirroring `lodgingColor.ts`, with modes:

```ts
export const PLACE_COLOR_MODES = ["category", "list", "visited"] as const;
```

- `category` — restaurant / landmark / nature / … (the default)
- `list` — each `PlaceList.color`; a place in several lists takes its
  lowest-`sortIdx` list, and the tooltip names all of them
- `visited` — visited vs. wishlist, the checklist-progress view

Ghost pins for unticked curated items are a **separate sub-layer**, not a colour
mode: hollow, lower opacity, never counted, toggled by a checkbox on the
checklist page. Keeping them out of the colour model is what stops an unvisited
target from ever being mistaken for a visit.

### 7.2 Dashboard POI tab

`PoiTab.tsx` loses the placeholder. The modes are **already registered** as
`["markers", "heatmap"]` with default `markers` — no change to
`types/dashboard.ts` is needed, which is a pleasant surprise the stub left behind.

- `markers` — pins, coloured by the mode above, with a list filter
- `heatmap` — reuses `heatmapLayer.ts` weighted by visit count

Remove `poiDashboardTab` from `betaFeatures.ts` when the tab is real. Per the
registry's own doc comment, deleting the entry makes TypeScript point at the
gate site.

### 7.3 #177 — POIs on the global map

Once places are first-class this is no longer a special case: the **All** tab
gains a places layer alongside flights/cruises/lodging, and a trip's POIs appear
on the global map because they are places like any other. #177 closes as a
consequence of the model, which is precisely the reporter's "they have to be
synced".

### 7.4 Pages

Following the freshly-unified list infrastructure on `main` (`e2cafa09`,
`cde7c662`, `9d52bd82` — one filter bar, one sort header, one row-click contract
across all three domain lists), the POI list is the **fourth** consumer of that
shared furniture, not a new one:

- `/places` — all places, shared filter bar + sort header, row → detail
- `/places/:id` — detail: map, visits, photos, list membership, notes
- `/places/lists` — the user's lists + available checklists to subscribe to
- `/places/lists/:id` — one list: map + rows; for a curated list, a progress
  header ("4 / 7") and ghost rows

Every page checks `useEnabledDomains()` — mandatory per CLAUDE.md.

### 7.5 Trip integration

`tripTimeline.ts` gains a `place-visit` kind, merged like `lodging-checkin` /
`journal` already are. The existing per-day ordering rules are untouched;
`visitedAt`'s time component slots a place visit into the right position within
its day (#175), and `journal` stays the day's last word.

The trip detail page gets an "Orte" section: add a place to this trip (search or
pick from existing places), which creates a `PlaceVisit` with `tripId` set.

### 7.6 Photo proof

```prisma
model PlaceVisitPhoto {
  id           String  @id @default(uuid())
  placeVisitId String  @map("place_visit_id")
  filename     String
  mimetype     String
  sizeBytes    Int     @map("size_bytes")
  caption      String?
  sortIdx      Int     @default(0) @map("sort_idx")
  /// Immich provenance, set only when imported from a linked album.
  immichAssetId String? @map("immich_asset_id")
  createdAt    DateTime @default(now()) @map("created_at")

  visit PlaceVisit @relation(fields: [placeVisitId], references: [id], onDelete: Cascade)

  @@index([placeVisitId])
  @@map("place_visit_photos")
}
```

Deliberately a mirror of `TripPhoto` (same columns, same storage helper shape)
rather than a generalisation of it. Generalising `TripPhoto` to a polymorphic
owner would touch the shipped Immich import job, the album resync ordering
invariant, and the asset proxy's ownership check — three things CLAUDE.md flags
as load-bearing and easy to break. A parallel table costs one small file and
risks nothing.

A cheap and genuinely nice extra: `TripPhoto` already stores EXIF `lat`/`lon`.
"Suggest places from your trip photos" is a Phase-D idea, not a v1 promise.

## 8. API

Mirrors `routes/lodging.ts` throughout: `router.use(authenticate)`,
`requireWriteScope` on mutations, ownership via `findFirst({ where: { id, userId } })`,
`$transaction` for parent+child writes, fire-and-forget
`checkAndUpdateAchievements(userId)` after a write, Zod schemas in
`backend/src/schemas/place.ts`.

```
GET    /api/v1/places                    ?category=&listId=&visited=&q=
POST   /api/v1/places
GET    /api/v1/places/:id
PATCH  /api/v1/places/:id
DELETE /api/v1/places/:id

POST   /api/v1/places/:id/visits
PATCH  /api/v1/places/visits/:visitId
DELETE /api/v1/places/visits/:visitId
POST   /api/v1/places/visits/:visitId/photos     multipart

GET    /api/v1/place-lists
POST   /api/v1/place-lists
PATCH  /api/v1/place-lists/:id
DELETE /api/v1/place-lists/:id
POST   /api/v1/place-lists/:id/entries           { placeId }
DELETE /api/v1/place-lists/:id/entries/:placeId

GET    /api/v1/place-lists/curated               shipped checklists + subscribed flag
POST   /api/v1/place-lists/curated/:key/subscribe
GET    /api/v1/place-lists/curated/:key/progress items + tick state
POST   /api/v1/places/curated/:itemId/visit      tick (§5)
```

Place *search* needs no new endpoint: `/api/v1/geo/places/search` already exists
and already reports `degraded` when the geocoder is unreachable. The POI picker
must surface that flag — #263 was exactly the bug where a blocked-egress
self-hoster saw "no results" instead of "search is unavailable", and a new picker
that ignores `degraded` reintroduces it.

## 9. Stats & achievements

New `requirementType` values on the existing `Achievement` model,
`domain: 'poi'`:

| code | requirementType | requirement |
|---|---|---|
| `places_10` / `_50` / `_250` | `places_count` | distinct visited places |
| `place_countries_10` / `_25` | `place_countries` | distinct `isoCountryCode` |
| `wonders_new7` | `curated_list_complete` | all 7 ticked |
| `wonders_ancient` | `curated_list_complete` | all 7 ticked |
| `maccis_25` | `places_in_category` | 25 in one category |

All counts obey §4.3: `visited = true`, future-dated visits excluded.

Dashboard stat tiles: places visited, countries with a place, lists, best
checklist progress.

## 10. Use cases

Written as acceptance criteria — each one should be executable by hand on the
beta slot before this ships.

1. **The McDonald's list.** Create list "Maccis weltweit" (🍟, yellow). In Tokyo,
   search "McDonald's Shibuya", pick the hit, save → place created, `visited: true`,
   added to the list. The list page shows 1 place, 1 country. On the dashboard POI
   tab in `list` colour mode it is a yellow dot. → *proves: custom list, search,
   colour-by-list.*
2. **A place visited twice.** Add a second visit to the same McDonald's a year
   later. It stays **one** place with two visits, the "places visited" count stays
   1, the visit count is 2. → *proves the §3 split; this is the case option (a)
   could never express.*
3. **Ticking a wonder.** Subscribe to "Neue 7 Weltwunder" → progress 0/7, seven
   ghost pins. Tick "Kolosseum", attach a photo, set the date. Progress 1/7, the
   ghost becomes a real pin, the photo shows on the place detail page, the
   `wonders_new7` achievement reports 1/7. → *proves: checklist, photo proof,
   achievement progress.*
4. **#177, the whole point.** A POI added to the trip "Rom 2024" appears on the
   global dashboard map with a label, without opening the trip. It is the same
   row, so renaming it in the trip renames it on the globe. → *proves: no second
   kind of POI.*
5. **Two POIs on one day (#175).** Two visits on 2024-06-12, 10:00 and 16:00,
   appear in that order in the trip timeline, with the journal entry last. →
   *proves the #175 fix survived the migration.*
6. **The wishlist.** Add "Machu Picchu" with `visited: false`. It appears on the
   map only in `visited` colour mode, and is excluded from every count and from
   the achievement progress. → *proves the §4.3 counting rule.*
7. **The dateless memory.** "I've definitely been to that Maccis in Paris, no idea
   when." Place with `visited: true`, a visit with `visitedAt: null`. It counts,
   it draws, it sorts to the end of any date-sorted list. → *the Lodging 2.7
   precedent, applied.*
8. **A planned visit does not count.** A visit dated next month is visible on the
   trip's timeline as upcoming, and is excluded from "places visited". →
   *proves the future-date rule, the one that also caught out lodging.*
9. **The migration.** A pre-upgrade trip with three POI stops still shows three
   entries on its timeline afterwards, now also on the global map, with notes and
   dates intact — and a POI stop that never had coordinates is still there,
   untouched. → *proves §6, including the case designed not to be migrated.*
10. **A dead geocoder.** With egress blocked, the place picker says search is
    unavailable, not "no results" — and manual coordinate entry still works. →
    *proves #263 was not reintroduced.*

## 11. Phasing

Each phase is releasable. The whole thing lives on `dev/poi-domain` off `main`
and does not touch `backend/VERSION` or `CHANGELOG.md` (owned by `/deploy`).

| Phase | Content | Rough size |
|---|---|---|
| **A — Core** | `Place` + `PlaceVisit` + migration §6 + CRUD + Zod + place picker + `placePinsLayer` + `placeColor` store/legend + POI tab real + **#177 closes** + trip timeline `place-visit` + domain `available: true` + un-gate `poiDashboardTab` | the bulk |
| **B — Lists** | `PlaceList` / `PlaceListEntry` + list pages + `list` colour mode + list filter on the POI tab | small |
| **C — Checklists & proof** | `CuratedList` / `CuratedPlace` + CSV seed + subscribe/tick + ghost pins + `PlaceVisitPhoto` + POI achievements + stat tiles | medium |
| **D — Import & enrichment** | CSV / Google Takeout / Maps-saved-places import via `ImportBatch`; EXIF-based suggestions from trip photos | later, separate spec |

Phase A alone closes #177 and delivers a working domain. The owner's brief needs
B and C, so "done" for this brief is A+B+C.

## 12. Open decisions for the owner

1. **Lazy vs. copy-on-subscribe for checklists (§5).** The recommendation is
   lazy, for the UNESCO-sized lists that follow. The cost is the one screen with
   two kinds of row. Copy-on-subscribe is simpler and uniform but caps how big a
   shipped list can sensibly get and freezes catalog corrections. **This decision
   is hard to reverse after Phase C ships**, because it changes what the user's
   own rows mean — worth settling before C starts, not during.
2. **Which checklists ship in v1.** Proposal: the two 7-item wonder lists only.
   Anything bulk-derived needs a licence line first (§5).
3. **Does POI belong in the Trips-only view or standalone too?** The spec assumes
   standalone-with-optional-trip, like flights and lodging. Worth confirming,
   because it is the assumption that makes "every McDonald's, worldwide" possible
   without inventing trips.

Not a decision but a flag: **Phase A migrates live user data.** It should land on
the RC server against a prod mirror (`scripts/stage-rc-from-prod.sh`, CT 107)
before it goes near production, and the expand/contract split in §6.3 exists so
that a mistake there is recoverable.
