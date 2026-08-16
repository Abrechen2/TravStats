# Cruise route editing, private places and shore excursions

**Date:** 2026-08-16
**Branch:** `dev/cruise-extension` (off `origin/main` @ `0734d177`)
**Target version:** 2.7.0
**Status:** direction approved by the owner 2026-08-16; this document awaits
his review. Nothing implemented.

---

## 1. Context

Two owner wishes, raised together:

1. **Record shore excursions per port.** Today a stop carries a single
   free-text `excursionNote` (500 chars) and nothing else.
2. **Hand-correct the route by moving waypoints on a map**, so that an
   expedition cruise — Arctic, Antarctic — can be shown as it actually
   sailed. Such a cruise calls at landing sites, anchorages and ice edges
   that do not exist in the port catalogue.

A follow-up clarified the priority and added a third case:

> Waypoints are the main thing. A private place is also good when, for
> example, an excursion happens mid-route to an iceberg.

And, after trying a working mock-up of the editor:

> The route editing has to be easy to use — drag and drop the waypoints, or by
> clicking with the mouse. And you must be able to add a zodiac trip or the
> like to a waypoint.

Both wishes fail on the same sentence in the current model: **a route
point must be a `Port` row from the shared catalogue.** The last clarification
adds a second: whether a point is "a bend in the line" or "a place we were" is
something the *user* decides afterwards, on the map — not something the data
model should make them declare up front (§6.2).

### Owner decisions (2026-08-16)

| # | Question | Decision |
|---|---|---|
| 1 | Is the private-place entity worth the cost of re-shaping leg endpoints? | **Yes.** Full path, stages 1–5. |
| 2 | Does a landing count as a port call? | **No — count them separately.** A landing is not a port visit. |
| 3 | How much excursion in the first cut? | **Keep it simple.** Photos "maybe, like trips with Immich" — see §10. |
| 4 | Which release? | **2.7.0** |

---

## 2. Current state (measured, not remembered)

All statements below were read from the working tree at `0734d177`.

- **`CruiseStop`** (`backend/prisma/schema.prisma`) holds `portId?`,
  `dayNumber`, `date?`, `isAtSea`, `arrivalTime?`, `departureTime?`,
  `excursionNote?`, `unresolvedPortName?`.
- **The 3-state invariant** is enforced by `superRefine` in
  `backend/src/schemas/cruise.ts` and documented in `CLAUDE.md`: a stop is
  exactly one of matched port / sea day / unresolved port name.
- **`CruiseLeg.fromPortId` and `toPortId` are NOT NULL FKs** to `Port` with
  `onDelete: Restrict`. Legs carry `distanceKm`, `method`, `routerVersion`.
- **`Port` has no `userId`.** The catalogue is instance-wide, and
  `POST /api/v1/ports` (`backend/src/routes/ports.ts`) already lets any
  session with write scope create a row with `isUserAdded: true`.
- **Route geometry is not persisted at all.** The `CruiseRouteCache` table
  was dropped (migration `20260425200000_drop_cruise_route_cache`).
  `GET /api/v1/cruises/:id/geometry` calls `computeSchematicRoute`
  (`backend/src/services/schematicRouter.ts`) per leg on every request, with
  an in-process cache. It returns 3–8 waypoints per leg; the frontend runs a
  Catmull-Rom spline through them (`cruiseArcsLayer.ts`).
- **Distances are persisted**, in `cruise_legs`, rebuilt by
  `recomputeLegsForCruise` (`services/cruiseDistance/cruiseLegService.ts`).
- **Departure and arrival ports live on the `Cruise` row**, not in
  `cruise_stops`. `buildEffectivePortSequence`
  (`backend/src/shared/cruise/portSequence.ts`) splices them onto the stop
  sequence for every consumer.
- A **click-to-place / draggable pin map** already exists and is the right
  building block: `frontend/src/components/location/LocationMiniMap.tsx`
  (plain `react-map-gl/maplibre`, no deck.gl).

---

## 3. Pre-existing defects on the same seam

Three defects already sit exactly where this work cuts. None is caused by
this feature; all three would look like its fault afterwards. They are
stage 1 for that reason: **after the rebuild there is no way to attribute a
wrong number.**

**D1 — Frontend and backend count "ports" by different rules.**
`countUniquePorts` (`frontend/src/components/Cruise/cruisePorts.ts`) adds
distinct unresolved port *names* to its unique count. The backend
`cruisePortsUnique` (`backend/src/utils/cruiseStats.ts`) deliberately
excludes them — its own comment reads "no unique-port id" — and counts them
only in `totalPortCalls`.

**D2 — The globe time slider does not know the first and last leg.**
`computeCruiseLegDates` (`frontend/src/components/Globe/timeSliderUtils.ts`)
builds legs from stops with a port only; departure and arrival ports are on
the `Cruise`. The server geometry *does* include them, and `GlobeView`
pairs the two by the key `` `${fromPortId}:${toPortId}` ``. For the first and
last leg the lookup therefore misses, and in slider mode those legs are
silently absent.

**D3 — The leg backfill script expects the wrong leg count.**
`backend/src/scripts/backfillCruiseLegs.ts` computes
`expectedLegs = portCallCount - 1` from stops only, while
`recomputeLegsForCruise` includes departure and arrival. The script judges
correct cruises to be out of date — and it is precisely the instrument we
would otherwise trust during the migration.

---

## 4. Model

Three new things, one reshaping. Nothing about flights, trips or lodging
changes.

### 4.1 `CruisePlace` — a private place

A user-owned point that is not a catalogue port.

```
CruisePlace
  id              uuid
  userId          → User (cascade)
  label           string           -- "Alkefjellet"
  lat, lon        float
  kind            string           -- landing | anchorage | passage | scenic | other
  isoCountryCode  string?          -- ISO-3166 alpha-2, nullable (Antarctica etc.)
  region          string?
  notes           string?
  createdAt, updatedAt
  @@index([userId])
```

Why a table and not `lat`/`lon` columns on `CruiseStop`:

- **Identity.** The same landing site visited on two cruises is one place.
  Raw coordinates on a stop cannot express that.
- **A stable endpoint key.** Map layers and the globe pair geometry to legs
  by endpoint reference. Coordinates make a poor key; a row id does not.
- **Metadata.** Country and region feed the country/region statistics.
  `isoCountryCode` rather than a country name, deliberately: ports carry
  country *names* and airports carry ISO codes, and the cross-domain
  vocabulary should stop drifting further apart, not gain a third dialect.

`Port` is **not** touched. No user data enters the shared catalogue.

### 4.2 `CruiseStop` gains a fourth state

```
CruiseStop
  + placeId  → CruisePlace? (onDelete: Restrict)
```

The invariant grows from three states to four. A stop is **exactly one** of:

| State | `portId` | `isAtSea` | `unresolvedPortName` | `placeId` |
|---|---|---|---|---|
| matched port | set | false | null | null |
| sea day | null | true | null | null |
| unresolved port | null | false | set | null |
| **private place** | null | false | null | **set** |

Enforced in `backend/src/schemas/cruise.ts` by extending the existing
`superRefine`, and documented in `CLAUDE.md` alongside the current rule.
`onDelete: Restrict` mirrors the leg FKs: a place still used by a stop
cannot be deleted out from under it.

**A place stop is normally born as a waypoint.** The owner's requirement —
"you must be able to add a zodiac trip or the like to a waypoint" — is not a
fourth feature; it is one gesture that turns a shape-only waypoint into a
place stop and back. See §6.2. This collapses what an earlier draft of this
document treated as two separate things.

### 4.3 `CruiseLegRoute` — the hand-corrected line

```
CruiseLegRoute
  id          uuid
  cruiseId    → Cruise (cascade)
  fromKind    string   -- 'port' | 'place'
  fromRef     string   -- portId as text, or place uuid
  toKind      string
  toRef       string
  waypoints   Json     -- [[lon, lat], …] , 2..64 points
  createdAt, updatedAt
  @@unique([cruiseId, fromKind, fromRef, toKind, toRef])
```

**Keyed by endpoints, not by leg ordinal.** Keying by ordinal is the classic
bug: inserting a port shifts every stored line one position along, and the
map then looks like the router broke. With endpoint keying an itinerary
change simply leaves the override unmatched and inert.

Consequence, accepted deliberately: if the same directed pair occurs twice
in one itinerary, both occurrences render the same corrected line. That is
almost always what the user meant.

`fromKind`/`toKind` exist from the start even though stage 2 ships before
places do. Until stage 5 the only value written is `'port'`. The column is
there so stage 5 adds rows, not a migration of every stored line.

### 4.4 Leg endpoints become generic

```
CruiseLeg
  + fromKind, toKind      string    -- 'port' | 'place'
  + fromPlaceId, toPlaceId → CruisePlace?
  + fromLat, fromLon, toLat, toLon  float   -- snapshot at compute time
    fromPortId, toPortId            -- become nullable in stage 4
```

Coordinate snapshots exist so a leg row is self-describing: distance
statistics never have to resolve a foreign row to know where a leg ran.

**A leg is not re-keyed to `fromStopId`/`toStopId`.** That looks tempting
and is wrong: embarkation and disembarkation are on the `Cruise` row, not in
`cruise_stops`, so a minimal A-to-B cruise with no stop list would lose both
its legs.

### 4.5 `CruiseExcursion`

```
CruiseExcursion
  id             uuid
  cruiseStopId   → CruiseStop (cascade)
  ordinal        int
  title          string
  notes          string?
  locationLabel  string?    -- "Rom" for a call at Civitavecchia
  lat, lon       float?     -- optional own coordinates
  createdAt, updatedAt
  @@index([cruiseStopId])
```

Kept deliberately small (decision 3). **Not** in the first cut: price and
currency, duration, provider, rating, companions, photos. The one thing that
cannot be retrofitted cheaply is the cardinality — one text field never
becomes many rows without migrating data — and that is what this buys.

The mid-leg excursion (the iceberg) needs no special case: it hangs off a
stop whose state is *private place*. That is why the two wishes are one
design and not two.

---

## 5. Counting rules (decision 2)

A landing is not a port visit. Concretely:

- `totalPortCalls`, `cruisePortsUnique` — **unchanged**. Place stops do not
  enter them.
- New `totalPlaceCalls` and `cruisePlacesUnique`, reported and displayed
  next to the port figures, never merged into them.
- Countries and regions: a place contributes through `isoCountryCode` when
  it has one. A place in international waters or Antarctica contributes
  nothing, which is correct.
- Distances **do** include place legs. A landing is not a port, but the
  ship really sailed there.
- Achievements: existing port-based achievements keep their current meaning.
  Whether landings earn their own badge is out of scope here.

**Open, needs the owner's word (§11):** D1 forces a choice about unresolved
ports. The proposal is that the backend rule wins — an unresolved name is a
port *call* but not a unique *port*, because it cannot be reliably deduped
against a matched port of the same name. This changes a visible number on
the cruise row for cruises with unresolved stops.

---

## 6. Editing the automatic route

The contract, in the user's terms:

1. **Open a leg for editing.** The map loads exactly the waypoints the
   router just returned, as visible handles on the existing line. Nothing is
   empty; nothing has to be rebuilt by hand.
2. **Drag, insert, delete.** The line follows immediately. The first and
   last waypoints are the leg's endpoints and are not movable — a leg begins
   and ends at its places.
3. **Saving means adopting.** From then on the user's line applies, marked
   as such, with a way back ("automatic again", which deletes the override
   row). It is never silently recomputed.

Deleting a handle matters as much as moving one: the router likes to bend
around a landmass that is not there at that resolution, and two points fewer
is often the whole fix.

### 6.1 Interaction (explicit owner requirement)

Editing must be **directly manipulable** — drag and drop, click, no forms
full of coordinates. The full set of gestures:

| Gesture | Result |
|---|---|
| Drag a handle | Moves that waypoint; the route redraws live during the drag, not on release. |
| Click on the guide line between two handles | Inserts a new waypoint at that position, between exactly those two. |
| Hover a handle → click its ✕, or select it and press `Delete` | Removes that waypoint. |
| Drag an endpoint handle | Refused — endpoints are the leg's places. The cursor says so; nothing moves. |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo within the editing session. |
| `Esc` | Leaves the editor without saving; the line returns to what it was. |

Two supporting requirements:

- **What you drag is what you see.** While editing, the leg renders as the
  final Catmull-Rom curve *plus* a faint straight guide polyline through the
  handles — the convention every vector editor uses. Without it, "click on
  the line to insert" is ambiguous: the curve bulges away from the polyline,
  so a click on the curve does not identify a segment. The guide line
  removes the ambiguity instead of guessing at it.
- **Keyboard reachable.** Handles are focusable; arrow keys nudge the
  focused waypoint, `Delete` removes it. A map editor that only answers to a
  mouse is unusable for anyone who cannot use one, and this one is small
  enough that there is no excuse.

Only the leg under edit is interactive; the rest of the cruise stays drawn
and static, so the user keeps the context of the whole route.

Optional: a waypoint dropped on land could be flagged with a quiet hint —
never a block, since sometimes the mask is wrong and it is the user's map.
Note that this is **not** free as first assumed: the land mask is a backend
asset loaded by the router, not something the browser has. It would need a
small server check on save, or dropping the idea. Left out of the staging
below until it is asked for.

Technically this is the `LocationMiniMap` pattern one step further:
`react-map-gl` `<Marker draggable>` for the handles, a GeoJSON line layer for
the guide and the curve, and nearest-segment insertion computed from the
click coordinate rather than by hit-testing a rendered feature.

### 6.2 Promoting a waypoint to a landing

A waypoint is cheap on purpose: it shapes the line, has no name, no time, and
counts nowhere. Where something actually happened, one click turns it into a
place stop — with a label, a time, and excursions hanging off it. A second
click turns it back.

| Gesture | Result |
|---|---|
| Select a waypoint, click ◆ (or press `Enter`) | Becomes a place stop. A `CruisePlace` is created at those coordinates and the stop references it. |
| On a place stop, click the same badge again, or "back to waypoint" | Reverts to a shape-only waypoint. If excursions hang off it, **ask first** — never delete silently. |
| Delete (✕) on a place stop | Removes the point entirely, with the same warning. |

**Two invariants make this safe, and they are the whole reason it is one
gesture rather than two features:**

1. **Promoting must not move the line.** The rendered route may not shift by a
   pixel when a waypoint becomes a stop. The user is labelling a point, not
   re-routing.
2. **Promoting must not change the distance.** One leg becomes two, and the
   total stays identical.

Both follow from one implementation rule: **the spline is computed over the
whole route, not per leg in isolation.** Splining each leg separately gives
its endpoints duplicated control points, so every new stop would introduce a
tangent break — a visible kink and a small distance jump on every promotion.
Per-leg distance is therefore measured by walking the continuous route curve
between consecutive stop indices, not by re-splining the leg on its own.

This differs from today's rendering, where the geometry endpoint emits one
LineString per port pair and the frontend splines each separately. Ports are
genuine corners so nobody noticed; a promoted waypoint is not, and would.

### The trap this must not fall into

Geometry is not persisted; distance is. If `recomputeLegsForCruise` does not
consult `CruiseLegRoute`, the next router-version bump **silently resets the
kilometres to the router's value while the map keeps the user's line.** Map
and statistics would then disagree with nobody noticing.

Therefore:

- `recomputeLegsForCruise` looks up an override for each leg first. When one
  exists, `distanceKm` is the haversine sum along the stored polyline and
  `method` is `manual_polyline`.
- `manual_polyline` is a first-class method, not a faked router result.
- A `routerVersion` / `ORCHESTRATOR_VERSION` bump **never** deletes an
  override.
- The geometry endpoint returns the override verbatim, with
  `properties.method = "manual_polyline"` and `routed: false`, so map and
  globe render from the same source the statistics used.

---

## 7. Invariants that must survive

1. A stop is exactly one of four states — never a mixture. Zod rejects the
   rest; the test that pins this gets a fourth case.
2. `Port` rows are never created on a user's behalf by this feature.
3. Distance and rendered line come from one source per leg.
4. A hand-corrected route survives router and data version bumps.
5. Departure and arrival ports stay part of every effective sequence.
6. Frontend and backend answer "how many ports" with the same rule.
7. Promoting or demoting a waypoint moves neither the drawn line nor the
   total distance (§6.2). This is a property test, not a code review item:
   promote every waypoint of a fixture route in turn and assert the total is
   unchanged to the metre.

---

## 8. Integration into the app

### Where it lives

The cruise detail page already shows the route on a MapLibre map
(`frontend/src/components/Cruise/CruiseRouteMap.tsx`, read-only today). The
editor is a **mode of that map**, not a new page: a "Route bearbeiten" button
in its chrome, an editing state, and Speichern / Wieder automatisch beside it.
The stop list lives in `CruiseStopsEditor` inside `CruiseEditModal`.

### One truth, two views

Map and list edit the same stops, so their roles have to be split cleanly or
they will fight:

- **The list owns order, dates and times.** It is the right tool for "day 4
  was Ny-Ålesund".
- **The map owns geometry** — waypoints, and the coordinates of a place.
- **Both may promote and demote.** A place created on the map appears in the
  list at once; a landing deleted in the list disappears from the map.

Anything a view cannot express, it must show rather than hide. The list shows
a place stop with its label and a "on the map" affordance; it does not offer
a coordinate field, because typing coordinates is exactly what the map exists
to replace.

### The `dayNumber` conflict — needs a decision

`CLAUDE.md` records the current rule: *the stops editor renumbers `dayNumber`
as `index + 1` after add / remove / reorder.* `dayNumber` is therefore
positional, not calendrical.

That rule breaks on the itineraries this feature is for. Three zodiac landings
on one day of an expedition cruise would become days 4, 5 and 6, and every
later stop would shift. Promoting a waypoint mid-leg would silently renumber
the rest of the cruise.

Two ways out, and this is the owner's call:

- **(a) `dayNumber` becomes a pure ordering index that may repeat**, with the
  calendar day read from `date`. Truthful, and it makes "three landings on day
  4" expressible. Costs: every consumer that treats `dayNumber` as a day has
  to be found and fixed.
- **(b) A promoted stop inherits the `date` of the leg it sits on and keeps a
  positional `dayNumber`.** Cheaper, but the displayed day number stays a lie
  for multi-landing days.

Recommendation: **(a)**, but only after the write paths are enumerated — the
same lesson as the derived-values sweep: listing every writer finds more than
the reported symptom.

### Where excursions surface

The cruise detail timeline already renders a per-stop `meta` line (that is
where `excursionNote` appears today) — excursions replace it there. Beyond
that: a count in the cruise statistics section, and the trip page inherits
them through its cruises. Nothing new on the dashboard in 2.7.

### Touch and small screens

The same editor has to work on a phone: drag is native to pointer events, but
the ✕ and ◆ badges need real touch targets (≥ 44 px) rather than the 18 px
that reads well with a mouse. Below a breakpoint the badges become a small
action bar under the map instead of floating next to the handle.

### Scope and permissions

Route edits and places are writes and are covered by the existing
`requireWriteScope` on the cruise routes — a read-only PAT keeps read access
and cannot edit. Places are per-user; nothing in this feature writes to a
shared catalogue.

---

## 9. Migration and back-compat

- **Additive first.** Stage 4 adds the generic endpoint columns, backfills
  existing legs as `kind = 'port'` with coordinates copied from the ports,
  and only then relaxes `fromPortId`/`toPortId` to nullable. The old columns
  stay populated for ports throughout 2.7.
- **Existing stops are untouched.** Unresolved names are *not* converted to
  places automatically — there are no coordinates to convert, and inventing
  them is exactly the failure mode this design exists to avoid.
- **Existing excursion notes** migrate into one `CruiseExcursion` row each.
  `CruiseStop.excursionNote` stays as a column for 2.7 and is retired later.
- **Parser and import are unchanged.** `ParsedCruiseStop` carries no
  coordinates; the resolver either matches a port or emits an unresolved
  name. It stays that way — the LLM must not invent landing-site
  coordinates. Places are created by hand, on the map.
- **Version bump and recompute.** Stage 4 bumps the orchestrator version and
  recomputes all cruises. D3 must be fixed before that run, or the check is
  measuring with a broken ruler.

---

## 10. Explicitly out of scope for 2.7

- **Excursion photos.** Trips link *Immich albums* — album granularity, in
  either link mode (proxied, zero bytes) or import mode (`TripPhoto` rows).
  An excursion is finer than an album, so this needs either a per-excursion
  album link or per-asset selection, and that is its own design. Noted as
  the owner's "maybe", not smuggled in.
- **Excursion price**, and therefore any effect on the trip total price.
  First candidate to add once the simple version has been used.
- Sharing places between users, or promoting a place into the catalogue.
- Merging with the POI domain.
- Letting the parser produce coordinates.
- Landing-specific achievements.

---

## 11. Staging

Each stage is useful on its own and leaves the numbers measurable.

| Stage | Content | Acceptance |
|---|---|---|
| **1** | Fix D1, D2, D3. No feature, no visible change beyond the corrected port count. | One counting rule, shared by a test across both sides; first and last leg appear in the globe slider; backfill agrees with `recomputeLegsForCruise` on an untouched database. |
| **2** | Route editing: `CruiseLegRoute`, override-aware geometry and distance, whole-route splining (§6.2), map editor. **The owner's main wish.** | A hand-corrected leg keeps its line and its kilometres across a forced `recomputeLegsForCruise` and a version bump. |
| **3** | `CruiseExcursion` + note migration + editor + detail page + one statistic. Independent of 2 and 4; may run in parallel. | Existing notes survive as excursions; a stop carries several excursions. |
| **4** | Generic leg endpoints, additive, backfilled, version bumped, everything recomputed. Resolve the `dayNumber` question (§8) before stage 5 depends on it. | Total distance over all cruises identical before and after. Single number, single check. |
| **5** | `CruisePlace`, fourth stop state, **promote / demote a waypoint**, separate counters, excursions on place stops, list-and-map sync. | An Arctic cruise with landings renders end to end; ports and landings count separately; promoting every waypoint of a fixture route in turn changes the total distance by zero. |

Stages 1 + 2 alone satisfy the primary wish. Stage 3 alone satisfies the
excursion wish for ports. Only the mid-leg iceberg needs all five.

---

## 12. Open items

1. **D1 resolution** (§5): confirm that the backend rule wins and the cruise
   row's port count changes for cruises with unresolved stops.
2. **Board item.** `roadmap.local.yaml` lives in the main checkout and is
   gitignored, so it is not in this worktree. A 2.7.0 item for this work
   still has to be added there.
3. **`dayNumber`** (§8): does it become a repeatable ordering index with the
   calendar day read from `date` (recommended), or does a promoted stop
   inherit its leg's date and keep a positional number? The current
   `index + 1` rule cannot express three landings on one day, which is the
   normal shape of an expedition itinerary.
4. Whether stage 3 runs in parallel with stage 2 or after it — a scheduling
   question, not a design one.

---

## Appendix — second opinion

A cold read by Codex (`gpt-5.5`, read-only, no conversation context)
contributed three things that were not in the first draft, each re-measured
against the code before being adopted:

- D2 and D3 above.
- The objection that raw coordinates on a stop form no identity — which
  produced `CruisePlace` instead of `CruiseStop.lat/lon`.
- The sharpest point: embarkation and disembarkation live on the `Cruise`,
  so re-keying legs to stop ids would have swallowed minimal A-to-B cruises
  (§4.4).
