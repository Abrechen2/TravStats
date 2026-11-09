# Tours as a domain of their own

Status: draft 2026-11-09, coordinator. Ledger item `tours-own-domain`.

## Why

Tester feedback (Discord #dev-talk, thread "TravTrack", 2026-11-08): tours are
the only kind of entry that lives inside trips, although they weigh about as
much as roadtrips. Owner, 2026-11-09: "Punkt 7 mach es als eigener Bereich".

This reverses the coordinator ruling of 2026-10-09 recorded in
`backend/src/services/tourVisibility.ts` ("Tours are not a domain") and the
`TOUR_COLOR` comment in `shared/domains.ts`.

## What exists today (measured on main 0c78a7f24)

- A tour is a `TripRoute` row with `kind = "tour"`; a roadtrip is the same
  table with `kind = "roadtrip"`, and roadtrip is already a full domain
  (`/roadtrips`, colour, enable switch, share type, stats).
- `TripRoute.tripId` is nullable and `userId` is direct. Standalone tours
  already exist (`routes/trips/tourIndex.ts`), and so does `ToursPage`.
- Deleting a trip (`routes/trips.ts` ~625) already detaches roadtrips and
  tours whose points are all their own; only a tour drawn over the trip's
  timeline stops still cascades. Moving a tour between trips exists
  (`tourRoutes.ts`, rejects timeline-backed tours).
- `GET /tours` exists (`tourIndex.ts`, bare `{tours}`, optionally with
  roadtrips); web client `tourIndexApi`.
- Sync already carries standalone routes (`sync/entities.ts`).
- Tour insights and badges exist; `shared/comparisonMetrics.ts` files tour
  metrics under `roadtrip`.
- Visibility: `toursVisible()` = the instance beta switch (registry key
  `roadtrips`), never a per-user domain switch.
- Sharing: tours are exempt (`tourIndex.ts`: "only roadtrips are shared").

## Decisions (coordinator calls, the owner can overrule)

1. **`tour` joins `DOMAINS`** in both `shared/domains.ts`, with
   `routePrefix: "/tours"`, the existing `TOUR_COLOR` as its colour, no parser
   target. `TOUR_COLOR` stays exported as an alias so map and legend do not
   move.
2. **No tour is lost with its trip.** The existing detach rule stays; the
   remaining case, a tour drawn over the trip's timeline stops, gets the
   roadtrip treatment: its borrowed stops are copied into its own points
   (geometry, legs, photos) before the trip goes, then it is detached. No FK
   change; the Prisma cascade stays as the last line for rows the handler
   already emptied.
3. **Gating**: tours follow `useEnabledDomains()` like every domain (user
   switch), and stay behind the `roadtrips` beta key until the owner releases
   roadtrips; that key's `returnsWhen` is unchanged. `tour` goes into both
   beta-gate registries (`frontend/src/config/domainBetaGates.ts`, server
   `BETA_GATED_DOMAINS`), not only `toursVisible()`. Every account that has
   at least one tour gets `tour` enabled by the migration, creating the
   `UserSettings` row where it is missing (`domainVisibility.ts` defaults a
   missing row to flights). An older Companion that writes `enabledDomains`
   without `tour` must not switch tours off: the settings write keeps `tour`
   unless the client states it knows the key (field `knownDomains` on the
   write; absent = old client).
4. **A tour can be shared** like a roadtrip, as its own phase (T1b): a
   `SHARE_TYPES` entry over the same table filtered by `kind`, an adapter
   that also transfers recorded tracks (the roadtrip adapter copies stations
   and legs only) and strips external references (Strava ids, provider
   ids), DE+EN inbox labels. Audit `sharing/keyOps.ts` (roadtrip special
   case), delegate dedup, detach and federation for a second type on one
   table.
5. **Counting**: a tour counts in statistics, achievements and "Dein Jahr"
   under its own domain, whether it belongs to a trip or not, never twice.
   Tour metrics move from `roadtrip` to `tour` in `comparisonMetrics.ts`
   (both mirrors); existing badge unlocks and their dates are kept.

## Phases

| Phase | Content | Depends on | Status |
|---|---|---|---|
| T1 server | registry entry (both mirrors), beta-gate registries, timeline-tour copy-on-trip-delete, enabled-domain backfill + `knownDomains` guard, `toursVisible()` → domain + beta check, sync visibility when the switch changes (tombstones/cursor), OpenAPI | — | done `81baf7d38` (2026-11-09) |
| T1b sharing | share type + adapter with tracks, keyOps/federation audit | T1 | done (see "T1b as built") |
| T2 web | `/tours` route as a domain page (list layout shared with roadtrips), nav entry, dashboard tab + map overlay through the domain registry, create a tour without a trip, "move to trip / detach" action, settings domain switch | T1 | done (see "T2 as built") |
| T3 stats | stats tab, insights, achievements, year in review under domain `tour` | T1 | done (see "T3 as built") |
| T4 Companion | contract below; app shows tours as a domain | T1 | open |

## Contract (additive, server first)

- The existing `GET /tours` (bare `{tours}`) stays as it is; nothing is
  renamed or re-enveloped. New fields only.
- Attach/detach uses the existing reassignment in `tourRoutes.ts` with its
  rules (timeline-backed tours rejected, station photos checked).
- `enabledDomains` may now contain `"tour"`; settings writes take an
  optional `knownDomains: string[]` (decision 3).
- Sync: standalone tours are already carried; switching `tour` off hides
  them per user with tombstones, switching on re-sends them.
- Minimum server version for the app: the release that carries T1.

## Review focus

1. A trip deleted with tours: tours survive, detached, still on the map.
2. A tour shared to another account: stops, legs and tracks arrive; nothing
   of the trip around it leaks.
3. An account with tours but `tour` not enabled after migration: must not
   happen (backfill test).
4. Achievements: a tour inside a trip is not counted twice.
5. Beta switch off: no tour visible anywhere, including the Companion.

## Codex review 2026-11-09

Four P1 and seven P2 against the first draft; all folded in above (existing
`/tours` contract kept, timeline tours preserved, sharing as its own phase
with tracks and a keyOps audit, beta registries, `knownDomains`, settings-row
backfill, metric reclassification).

## T1 as built

- Trip photos stay with the trip (`TripPhoto.tripId` is required and
  cascades); a detached tour keeps stops, legs and geometry, as roadtrips do.
- Detached stops carry `domain: "tour"`.
- Data-only migration `20261109130000_tour_domain_backfill`, replay-tested.
- Follow-ups: `tourKind.ts` conversion does not call
  `ensureTourDomainEnabled`; `useToursAccess` and the route guard are still
  beta-only (T2); `usageV2` `domain_buckets` gains a `tour` key.

## Open for the owner

None blocking. The `knownDomains` guard is a coordinator call.

## T2 as built

- `/tours` and both tour editor routes use `DomainRouteGuard domain="tour"` (switch AND
  `roadtrips` beta key via `DOMAIN_BETA_GATES`); `useToursAccess` is three-state on both.
  Nav and settings switch already followed from the T1 registry entry.
- The dashboard add button on the tour tab opens `/tours` (T1 exclusion removed).
- Deviation from the contract text: the existing PATCH `tripId` refused every tour
  ("Only a roadtrip can be attached"); that kind check is gone, the timeline-stop
  rule (409) stays. Row actions "Reise zuordnen" / "Von Reise lösen" on `/tours`;
  `ROADTRIP_HAS_TRIP_PHOTOS` is offered as an opt-in, not shown as a timeline error.
- `PATCH /tours/:id/kind` to `tour` now enables the domain; the review notice reloads settings.

## T3 as built

- Comparison: `tours` / `tourKm` carry domain `tour` in both `comparisonMetrics.ts` mirrors; the
  loader moved with them and `roadtrip` has no leaderboard figure left (nothing counted under both).
  **Consents:** a consent granted for `roadtrip` alone no longer carries the tour totals; the
  tour figures need `tour` in the consent domains (no implicit widening of what a friend may see).
- Badges: `TOUR_FIRST_STEPS`, `TOUR_THREE_KINDS`, `TOUR_ASCENT_1000` are `domain: "tour"` seeds
  now (were `shared` + `TOUR_BADGE_CODES`, removed). `ensureAchievements` rewrites the catalogue
  row in place, so every `UserAchievement` (hung off the achievement id) keeps its unlock and
  date. Visibility is the plain domain rule, also on the leaderboard (it used the raw beta flag).
- Evidence: `EvidenceDomain` gains `tour` (both mirrors, schema); `tourEvidenceEntry`; cross-domain
  population loads one event per completed tour (its day, its year). **No country row:** the
  passport counts no country a day tour alone reached, so a row would cite evidence the number
  does not hold. Entry windows: recorded span, else the tour's day on its own clock, movement.
- Overview: new `GET /stats/insights/tours/counted` (404 while the tour domain is not shown) feeds
  `adaptTour`; the same `completedTourFacts` feeds the population and the comparison loader, so
  card, evidence and leaderboard cannot disagree. Tour tab = `TourStatsSection`; it left the
  roadtrip tab and the overview.
- Counting guard: `stats.tourInTripCountedOnce.test.ts` (wrapped, trip distance, insights, badge
  measure, counted endpoint). The data layer already read `kind = "tour"` only; no double count
  existed, the test pins it.
- Follow-up: the Companion's `knownDomains` consent UI is T4.


## T1b as built

- **Registry:** `tour` is a `SHARE_TYPES` entry over `trip_routes` (`ROUTE_KINDS` / `isRouteEntity` in
  `shareTypes.ts`): two types, one table, told apart by `kind`. `DOMAIN_SHARING.tour = "tour"`; count key
  `tours`; `exchangeKind: null` (the `.travstats` file stays roadtrips-only, listed in `shareTypes.test.ts`).
- **Adapter:** `adapters/tour.ts` over the route half shared with the roadtrip (`adapters/routeParts.ts`).
  Facts: name, mode, orderIdx, activity, tourDate, tourStartMinute; pseudo-facts `stations`, `routeLegs`
  and `tracks`. Not carried: notes, tags, odometer, expenses, anchor station, vehicle, `externalRef`
  (Strava / HealthKit ids), row ids. A copy's tracks have `externalRef = null`.
- **Track identity:** `trip_route_tracks` has no share key (no schema change); identity is derived from
  source + span (`facts/tour.ts` `trackKeys`). A track the sender dropped is removed from a copy only when
  the change's `previous` says the sender held it; a track a member recorded is theirs.
- **Kind filter everywhere:** both adapters filter `load`/`copiesOf` by `kind`; `keyOps` filters assign,
  keyed ids, held keys, shared ids and moved ids. Route writes that say `"roadtrip"` for "a route" are
  dispatched by the row's kind in `propagate.ts` (`routeIdsByKind`); callers did not change.
- **Kind switch** (`PATCH /tours/:id/kind`): the members' entry of the old type is ended (key cleared,
  `deleted` notice, their copy stays) and the row is shared afresh as the new type with a new key. No
  entry changes type under its key.
- **Write paths now propagating as `tour`:** tour create (both routes), track upload / Dawarich pull /
  delete / Strava import / archive import / jitter re-measure, point replacement (`replaceTourPoints`),
  suggestion link. `tripRouteTrack` joined the `propagate.writePaths` table list; the stale
  "only roadtrips are shared" exemptions were rewritten or removed.
- **Receiver gate:** `copyInto` hands a tour only to a recipient whose `loadVisibleDomains` includes `tour`
  (user switch AND the instance's `roadtrips` beta switch). Otherwise nothing is copied and no notice is
  written (same contract as an own entry in another group). The tour is not backfilled later by itself;
  a new share of the trip (`copyMissing`) brings it.
- **Federation:** wire shape `TOUR_SHAPE` (tracks <= 60, geometry over the point budget travels as null and
  is dropped on decode, never stored as an empty track); an entry over one message sheds trailing tracks
  with a log line (`trip_share_tracks_trimmed`); a `fact-update` too large drops the `tracks` change like a
  geometry. A server without T1b rejects a `tour` entry (unknown `entity`), see Open.
- **Migration** `20261110100000_tour_share_entity_type`: widens the `share_notices_entity_type_check`
  CHECK constraint (hand-written, not visible to Prisma; `shareVocabulary.test.ts` holds it).
- Inbox: DE+EN entity type, fact labels (`activity`, `tourDate`, `tourStartMinute`, `tracks`), offer counts.
- Open for the owner/coordinator: federation version skew (a trip with a tour offered to a pre-T1b server
  fails there); a recipient who converts a shared copy to the other type creates a second route for the
  sender (same rule as for any member).
