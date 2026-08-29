# Tours as route sections inside a trip — design

- **Status:** approved by the owner on 2026-08-29, not yet implemented
- **Target line:** 2.7.0
- **Branch:** `dev/tour-routes` (worktree `.worktrees/camper-v1`), off `main` @ `1f8b819b`
- **Supersedes:** nothing. First design in this area.
- **Related:** `2026-07-04-dawarich-integration-concept.md`

## 1. Decision

A **Tour** is an ordered, named route section that lives **inside a Trip**. It is
not a fifth domain.

The owner asked for motorhome trips and then widened it twice: it might be a tent
trip, a trekking trip or a road trip; someone might want only the accommodations
and no route at all; and a night inside a tour still counts as an ordinary night.
Those three constraints, plus what the codebase already contains, rule out both a
`camper` domain and a generic "ground travel" domain.

What gets built:

- `TripStop` gains two optional fields that make a stop part of a route.
- `TripRoute` is the section: name, transport mode, optional vehicle.
- `TripRouteLeg` is derived between consecutive stops of one section.
- `TripRouteTrack` holds a recorded GPX or Dawarich track.
- `Vehicle` and `FuelEntry` are a **catalog**, like `Aircraft` and `Ship`.

## 2. Why not a fifth domain

Measured on `main` @ `1f8b819b`, not assumed:

| Fact | Where |
|---|---|
| `TripStop` is live: create/update/delete, and a cleanup service that moves stops when trips merge | `backend/src/routes/trips.ts:895-995`, `services/tripCleanupService.ts:165` |
| The stop editor already offers `poi | hotel | train | road | ferry | hike | bike | other` | `frontend/src/components/trips/StopModal.tsx:18` |
| The trip map already draws flight arcs, cruise paths, lodging pins and stops coloured per mode | `frontend/src/components/trips/TripMap.tsx` (576 lines) |
| Stops are drawn as points only — `PathLayer` is imported but used solely for cruise routes | `TripMap.tsx:6, 346, 374` |
| `Lodging.type` already accepts `campsite`, end to end | schema, `schemas/lodging.ts`, `lodgingCsv.ts`, `lodgingStats` (`nightsByType`) |
| The dashboard map accepts arbitrary extra deck.gl layers | `MapContainer3D` prop `extraLayers?: Layer[]` |
| A dashboard tab is not a domain — `all` already is one | `types/dashboard.ts` `DASHBOARD_TABS` vs `shared/domains.ts` `DOMAIN_KEYS` |
| No road router exists anywhere; every `polyline` hit belongs to the cruise domain | `services/cruiseDistance/` |
| `polylineDistanceKm` measures any `[[lon,lat],…]` line and knows nothing about the sea | `services/cruiseDistance/polylineDistance.ts` |

A separate tour domain would put a second ordered stop list, a second map layer
and a second editor next to ones that already work, and would create three
competing answers to "where did this trip go?" — `TripStop`, the new tour stop,
and `LodgingStay.tripId`. Finishing the existing itinerary is cheaper and leaves
one answer.

The cost of this choice is stated in §14.

## 3. Scope

A Tour **is**: an ordered sequence of stops, the legs between them, their
distances, an optional vehicle, and optional recorded tracks.

A Tour **is not**: the night (that is `LodgingStay`), the experience (that is
`Trip` — journal, photos, companions, countries), or the place (that is
`Lodging` / `Place`).

A trip may hold any number of tours. A tour may be a loop: its first and last
stop may be the same place, which is what makes a day hike from a base camp
expressible.

## 4. Data model

### 4.1 Changes to `TripStop`

```prisma
model TripStop {
  // … every existing field unchanged …

  /// Free-form display label, unchanged. It already carries three jobs
  /// (colour, loose stop kind, implied type for `sourceId`); route
  /// semantics is deliberately NOT a fourth. The transport mode lives on
  /// the LEG, because it cannot be derived from either endpoint.
  domain String?

  /// Route membership. NULL means this stop is what every stop is today:
  /// a timeline point that produces no kilometres. Set means it is a
  /// vertex of that route section.
  routeId       String? @map("route_id")
  /// Position WITHIN the route, 0-based and contiguous. Written only by
  /// the atomic stop-assignment endpoint (§8), never by the client.
  routeOrderIdx Int?    @map("route_order_idx")

  route TripRoute? @relation(fields: [routeId], references: [id], onDelete: SetNull)

  @@unique([routeId, routeOrderIdx])
  @@index([routeId])
}
```

`onDelete: SetNull`: deleting a route releases its stops back to the timeline.
It never deletes them.

### 4.2 `TripRoute`

```prisma
model TripRoute {
  id       String @id @default(uuid())
  tripId   String @map("trip_id")
  /// Optional. A hike has no vehicle; a rented van is the same entity
  /// with a different `ownership`.
  vehicleId String? @map("vehicle_id")

  name     String
  /// Default mode for legs created in this section:
  /// road | ferry | rail | foot | bike
  mode     String
  orderIdx Int    @default(0) @map("order_idx")
  color    String?
  notes    String?

  /// Odometer at the start and end of the section. Deliberately NOT
  /// reconciled with the sum of the legs — see §6.3.
  startOdometerKm Int? @map("start_odometer_km")
  endOdometerKm   Int? @map("end_odometer_km")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  trip    Trip             @relation(fields: [tripId], references: [id], onDelete: Cascade)
  vehicle Vehicle?         @relation(fields: [vehicleId], references: [id], onDelete: SetNull)
  stops   TripStop[]
  legs    TripRouteLeg[]
  tracks  TripRouteTrack[]

  @@index([tripId])
  @@index([vehicleId])
  @@map("trip_routes")
}
```

### 4.3 `TripRouteLeg`

```prisma
/// One leg of one route section.
///
/// Keyed by its two ENDPOINT STOPS, never by an ordinal — the same lesson
/// `CruiseLegRoute` records: keying by position means inserting a stop
/// shifts every stored line one leg along, and the map then looks like the
/// router broke. With endpoint keying an inserted stop simply leaves the
/// neighbouring stored line unmatched until it is recomputed.
model TripRouteLeg {
  id         String @id @default(uuid())
  routeId    String @map("route_id")
  fromStopId String @map("from_stop_id")
  toStopId   String @map("to_stop_id")

  distanceKm Float  @map("distance_km")
  /// straight | drawn | routed | track — where the geometry came from.
  source     String
  /// road | ferry | rail | foot | bike. Defaults from TripRoute.mode but
  /// is per-leg: a road tour that includes one ferry crossing must not
  /// count that crossing as motorway kilometres.
  mode       String
  /// low | medium | high, mirroring CruiseLeg.
  confidence String @default("medium")

  /// `[[lon, lat], …]` in GeoJSON order. Null for `straight`.
  waypoints      Json?
  drivingMinutes Int?   @map("driving_minutes")
  tollCost       Float? @map("toll_cost")
  currency       String?

  computedAt DateTime @default(now()) @map("computed_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  route    TripRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)
  fromStop TripStop  @relation("LegFrom", fields: [fromStopId], references: [id], onDelete: Cascade)
  toStop   TripStop  @relation("LegTo",   fields: [toStopId],   references: [id], onDelete: Cascade)

  @@unique([routeId, fromStopId, toStopId])
  @@index([routeId])
  @@map("trip_route_legs")
}
```

Deleting a stop cascades its legs away, which is correct: a leg without an
endpoint has no meaning. The neighbouring legs are recomputed by the same
request (§6.1).

### 4.4 `TripRouteTrack`

```prisma
/// A recorded track. Hangs off the SECTION and a time window, never off a
/// leg: a GPX file knows nothing about the user's stops, and forcing it
/// into the leg structure on import loses data. Legs may later take their
/// distance from an overlapping track (§7.3); the track itself stays whole.
model TripRouteTrack {
  id         String   @id @default(uuid())
  routeId    String   @map("route_id")
  source     String   // gpx | dawarich
  name       String?
  startedAt  DateTime @map("started_at")
  endedAt    DateTime @map("ended_at")
  /// GeoJSON LineString coordinates, already simplified on import.
  geometry   Json
  pointCount Int      @map("point_count")
  distanceKm Float    @map("distance_km")
  createdAt  DateTime @default(now()) @map("created_at")

  route TripRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)

  @@index([routeId])
  @@map("trip_route_tracks")
}
```

### 4.5 `Vehicle` and `FuelEntry`

A catalog, not a domain. It follows `Aircraft` / `Ship` / `Port`: its own page
under the reference data, no dashboard tab, no entry in `DOMAIN_KEYS`.

```prisma
model Vehicle {
  id            String  @id @default(uuid())
  userId        String  @map("user_id")
  name          String              // "Der Dicke"
  kind          String              // motorhome | campervan | caravan | car | motorcycle | bicycle | other
  ownership     String              // owned | rented
  rentalCompany String? @map("rental_company")
  make          String?
  model         String?
  firstRegistered DateTime? @map("first_registered")
  fuelType      String? @map("fuel_type")   // diesel | petrol | electric | lpg | none
  tankLitres    Float?  @map("tank_litres")
  /// Last known odometer reading, maintained from FuelEntry and routes.
  odometerKm    Int?    @map("odometer_km")
  notes         String?
  isRetired     Boolean @default(false) @map("is_retired")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  routes  TripRoute[]
  refuels FuelEntry[]

  @@index([userId])
  @@map("vehicles")
}

/// Hangs off the VEHICLE, not the tour: consumption between two full tanks
/// does not respect trip boundaries.
model FuelEntry {
  id            String   @id @default(uuid())
  vehicleId     String   @map("vehicle_id")
  routeId       String?  @map("route_id")
  date          DateTime
  odometerKm    Int      @map("odometer_km")
  litres        Float
  pricePerLitre Float?   @map("price_per_litre")
  totalPrice    Float?   @map("total_price")
  currency      String   @default("EUR")
  /// Only full tanks yield a consumption figure. A partial fill is a cost
  /// record, never a divisor.
  isFull        Boolean  @default(true) @map("is_full")
  fuelType      String   @map("fuel_type")
  countryCode   String?  @map("country_code")
  notes         String?
  createdAt     DateTime @default(now()) @map("created_at")

  vehicle Vehicle @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([vehicleId, odometerKm])
  @@index([routeId])
  @@map("fuel_entries")
}
```

`LodgingStay`, `Lodging` and `Trip` are **not modified**.

## 5. Invariants

1. **Route membership is explicit.** Nothing derives it. No migration sets
   `routeId` on an existing stop. A trip recorded before 2.7.0 shows zero
   kilometres until the user assigns stops, and that is the correct outcome.
2. **A stop without coordinates cannot join a route.** Enforced by Zod on the
   assignment endpoint and by a disabled control in the UI, with the reason
   shown.
3. **`LodgingStay` is canonical for the night.** A stop may point at a stay via
   the existing `sourceId`; the stay never points at a route. Deleting a route,
   a stop or a whole trip's routes never touches a stay, its price, rating,
   nights or membership.
4. **Reordering or removing stops changes geometry and distance, and nothing
   else.** It never changes lodging, journal or photo data.
5. **`TripStop.domain` stays a display label.** The transport mode lives on the
   leg.
6. **Legs are derived.** They are recomputed on every change to a route's stop
   set or order. Only user-supplied geometry (`waypoints`, a manual
   `distanceKm`, `source: drawn`) survives a recompute, matched by endpoint pair.
7. **A route belongs to exactly one trip**, and a stop to at most one route.

## 6. Legs and distance

### 6.1 Derivation

Given a route's stops ordered by `routeOrderIdx`, a leg exists for every
consecutive pair. On any change:

- pairs that still exist keep their stored row, including user geometry;
- pairs that no longer exist are deleted;
- new pairs are created with `source: straight` and the route's default `mode`.

The whole recompute runs in one transaction with the stop assignment.

### 6.2 Distance

- `straight` — great-circle distance between the two stop coordinates
  (`shared/geo/haversine.ts`).
- `drawn` — `polylineDistanceKm(waypoints)`, the existing domain-neutral helper.
- `routed` — the distance the external provider returns (§7.2).
- `track` — the length of the overlapping track segment (§7.3).

A route's distance is the sum of its legs. A trip's distance is the sum of its
routes.

**Driven** kilometres are narrower than travelled ones: only legs whose `mode`
is not `ferry` and whose route has a `vehicleId` count towards a vehicle's
mileage. A van on a ferry is travelling, not driving; a hike is neither.

### 6.3 The odometer gap is a finding, not an error

`TripRoute.startOdometerKm` / `endOdometerKm` describe the same quantity as the
sum of the driven legs, and they will disagree whenever a stop is missing or a
recording lapsed. The UI **shows** the difference ("odometer says 3,410 km, legs
say 3,089 km") and never silently reconciles it. Reconciling produces two wrong
numbers where an honest difference would have pointed at the missing stop.

## 7. Where geometry comes from

`source` is a field, so the routing question is data rather than architecture,
and one route may mix all four.

### 7.1 Hand-drawn (phase 1)

The cruise route editor generalised to land. Waypoints are `[[lon,lat],…]`,
2..256 points, validated by Zod for count and coordinate range; the endpoint
anchor (first and last point within 1 km of the stop coordinates) is checked in
the handler, which is where the stop coordinates are available.

### 7.2 External router (approved)

Opt-in, **off by default**, admin-configured. Coordinates leave the instance, so
this is a deliberate choice an operator makes, not a default.

- First adapter: **OpenRouteService** — open source, self-hostable later, a
  documented free tier. The adapter interface is provider-shaped so GraphHopper,
  Valhalla or a self-hosted ORS can follow.
- Key resolution reuses `services/apiKeyResolver.ts`: user key → admin global →
  ENV, with `allowUserApiKeys` respected. New columns
  `openrouteserviceApiKey` / `globalOpenrouteserviceApiKey` on the existing
  settings tables, and an entry in `apiKeyTester.ts`.
- Requests are per-leg, cached by endpoint pair plus profile. A failure returns
  `null` and the leg falls back to `straight` with `confidence: low` — never a
  fabricated number.
- Profiles map from leg mode: `road → driving-hgv` (a motorhome is not a car),
  `bike → cycling-regular`, `foot → foot-hiking`. `ferry` and `rail` are never
  routed.

### 7.3 Tracks: GPX and Dawarich (approved)

- **GPX upload** needs no new dependency: `fast-xml-parser` is already in
  `backend/package.json`. Parse trackpoints, simplify (Douglas-Peucker, the same
  approach `schematicRouter` uses), store as `TripRouteTrack`.
- **Dawarich** is a read-only pull that mirrors the Immich integration: per-user
  opt-in, URL + API key through the same resolver chain, a version-contained
  client, and the fixed error-kind vocabulary the frontend already parses. The
  user picks a time window; TravStats fetches the points and stores one track.
  See `2026-07-04-dawarich-integration-concept.md`; a live test instance exists.
- A leg may then adopt the track: the segment of the track between the two stops'
  nearest track points becomes its geometry, `source: track`, `confidence: high`.
  Adoption is an explicit action, never automatic — the track may cover a
  different day than the leg claims.

## 8. API

All under the existing `/api/v1`, `authenticate` + `requireWriteScope`, Zod at
the boundary. **Every new endpoint needs an OpenAPI entry** — the build fails on
an endpoint that is not either specified or listed in `pending.ts`.

```
GET    /trips/:id/routes                      list sections with legs + totals
POST   /trips/:id/routes                      create a section
PATCH  /trips/:id/routes/:routeId             rename, mode, vehicle, odometer, colour
DELETE /trips/:id/routes/:routeId             delete section; stops survive (SetNull)

PUT    /trips/:id/routes/:routeId/stops       ATOMIC: the full ordered stop id list.
                                              Renumbers routeOrderIdx 0..n-1, releases
                                              removed stops, recomputes legs. This is the
                                              only writer of routeOrderIdx.

PUT    /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId   waypoints / source / mode
DELETE /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId   drop the override, back to straight
POST   /trips/:id/routes/:routeId/route-all   ask the external router for every routable leg

POST   /trips/:id/routes/:routeId/tracks      GPX upload (multipart)
POST   /trips/:id/routes/:routeId/tracks/dawarich   pull a time window
DELETE /trips/:id/routes/:routeId/tracks/:trackId

GET    /trips/:id/routes/:routeId/geometry    GeoJSON FeatureCollection for the map

GET|POST        /vehicles
GET|PATCH|DELETE /vehicles/:id
GET|POST        /vehicles/:id/refuels
PATCH|DELETE    /vehicles/:id/refuels/:entryId
```

A single atomic stop-assignment endpoint is the reason the broken global
`orderIdx` (see §12) does not block this work: `routeOrderIdx` is route-scoped
and only ever written there.

## 9. Frontend

### 9.1 Trip detail page

`TripDetailPage.tsx` is **1576 lines** against a project maximum of 800. The
section editor must not become another block on it. Instead:

- The page gains a compact **Touren** tab listing the sections with distance,
  stop count and mode, plus a combined map.
- Editing happens on a new sub-route **`/trips/:id/route/:routeId`**. The app has
  no sub-routes under a detail page today; this is the first.
- Splitting `TripDetailPage` is not in scope, but nothing new is added to it.

### 9.2 Map

`TripMap.tsx` already imports `PathLayer` and colours stops per mode. It gains
one `PathLayer` per section, coloured by leg mode, dashed for `straight`. Stops
that belong to no route keep rendering exactly as today.

### 9.3 Dashboard

- `MapContainer3D` already accepts `extraLayers?: Layer[]`; tour paths go there.
  The map component learns nothing about tours.
- `AllTab` gains a tour layer plus a legend row, mirroring the four existing
  `build*Legend` helpers with a new `buildTourLegend`.
- A **`tour` entry in `DASHBOARD_TABS`** with modes `["routes", "globe"]`.
  `DASHBOARD_TABS` is a separate list from `DOMAIN_KEYS`; adding a tab does not
  add a domain, does not touch either registry mirror and needs no domain gating.

### 9.4 Beta gate

Until the owner accepts it, the Touren tab and the dashboard tab register in
`frontend/src/config/betaFeatures.ts` and hide behind `betaFeaturesEnabled`.

### 9.5 Copy

German primary, English mirrored in the same change. The UI word for a section
is **„Tour"** (EN "Tour"), sitting inside a **„Reise"** (EN "Trip"): *„Die Reise
Norwegen 2024 enthält eine Tour über 3.240 km."*

While here, one existing inconsistency gets fixed: `de/lodging.json` calls
`campsite` „Campingplatz" and `de/map.json` calls it „Zeltplatz". Pick
„Campingplatz" in both.

## 10. Migration and backfill

One migration, additive only: two nullable columns on `trip_stops`, four new
tables, two catalog tables, and the settings columns for the router key. No
existing column changes type or nullability.

**There is no backfill.** No heuristic assigns existing stops to routes, and no
"same date and nearby, therefore linked" rule connects stops to stays. Existing
data keeps its current meaning. The UI may *offer* unlinked stays and
route-less stops for the user to connect; it never connects them itself.

## 11. Statistics and achievements

- Per route: distance, legs, nights, source mix, driving time.
- Per trip: total distance, driven distance, distance by mode.
- Per vehicle: lifetime kilometres, l/100 km from full tanks only, cost per km,
  cost per night when combined with the trip's stays.
- Nights are **not** recounted. They come from `lodgingStats`, which already
  breaks down by `nightsByType`, and a tour changes nothing there. Nothing may
  sum "tour nights" and "lodging nights" — they are the same rows.
- Achievements follow the existing monotonic engine: a row is not an unlock.

## 12. Known defects this work must not inherit

Found while measuring, recorded on the internal board rather than as GitHub
issues (no user-visible effect today):

1. `orderIdx` on `TripStop` is never sent by the frontend, so
   `routes/trips.ts` stores `0` for every stop and the effective order comes
   from `startDate`. The comment at `frontend/src/lib/tripTimeline.ts:137`
   claims the opposite. Fix the comment; the new `routeOrderIdx` is independent.
2. `tripCleanupService.ts` moves stops between trips with `updateMany` and does
   not renumber. It must also move `TripRoute` rows when trips merge, or a
   section ends up on a trip whose stops have gone elsewhere. This is a real
   bug the moment routes exist.

## 13. Testing

- Unit: leg derivation across add / remove / reorder, including that a stored
  hand-drawn line survives an unrelated insertion (the endpoint-keying promise).
- Unit: distance per source; driven-vs-travelled separation for ferry and foot.
- Unit: consumption uses only full tanks.
- Integration: deleting a route leaves stops and stays untouched; deleting a stop
  removes exactly its two legs and recomputes the join.
- Integration: a stop without coordinates is rejected by the assignment endpoint.
- Regression: a trip created before the migration reports zero route distance and
  no route rows — the "no fabricated history" guarantee, pinned by a test.
- Router adapter: a provider failure yields `straight` with `confidence: low`,
  never a number.

## 14. What this design gives up

- A tour cannot exist without a trip. Recording a quick drive means creating a
  trip first.
- There is no `/tours` list page with sorting and a column picker like flights or
  lodging have. The dashboard tab covers the map; a list would need a real
  domain.
- One stop belongs to at most one route. Two sections that share a night both
  need their own stop at that place.

These were weighed against a fifth domain and accepted by the owner.

## 15. Phasing

| Phase | Content |
|---|---|
| **P1** | Migration, `TripRoute` + `TripStop` fields + derived legs, atomic stop assignment, straight and hand-drawn geometry, the `/trips/:id/route/:routeId` sub-route, the Touren tab, `TripMap` paths, the two defects in §12. |
| **P2** | `Vehicle` catalog page, `FuelEntry`, consumption and cost statistics, odometer gap panel, tolls and ferry costs, achievements. |
| **P3** | GPX import, the external router adapter and its key plumbing, leg adoption from tracks. |
| **P4** | Dawarich pull. Parser for campsite and rental confirmations. Tour suggestion from photo clusters. |

The release cut is the owner's decision. P1 is the smallest thing worth
shipping; P2 without P1 is meaningless.

## 16. Open

- Which OpenRouteService plan and whether a self-hosted ORS is worth documenting
  as the private alternative.
- Whether a tour without a vehicle should still show an odometer panel (a hike
  has no odometer, so probably hidden rather than empty).
- Privacy handling for exact wild-camping coordinates and the home address —
  raised in review, deliberately deferred to its own decision.
