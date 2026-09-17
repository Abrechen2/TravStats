# A complete, protected demo account

**Date:** 2026-09-17
**Status:** approved in chat by the owner, awaiting spec review
**Branch:** `dev/design-system`

## 1. Why

The public preview `beta.travstats.de` (CT134, beta slot) is where strangers
first meet TravStats. Its accounts carry 123 flights and 5 trips each; cruises,
places and tours are empty, lodging exists only on `demo` (4 stays). Neither
demo seeder creates places or tour routes, so every domain page except flights
opens on an empty state, and the tour feature cannot be seen at all.

The owner's decisions (2026-09-17):

| Question | Decision |
|---|---|
| Which seed | Extend the **standard** demo seed (`seedDemoAccount.ts`, user `demo`), which `init.ts` runs on a first install — not a preview-only script |
| Access | **Public and protected**: credentials shown on the login page of the public instance; account-level settings locked; data reset nightly |
| Beta switch on CT134 | **On**, so tours are visible |
| Data shape | **Narrated trips plus bulk**: a handful of coherent trips where everything fits together, plus the existing random volume for statistics |
| Approach | Typed seed modules through Prisma (not a JSON backup, not an API driver) |

## 2. Data

### 2.1 Narrated trips

Each trip has dates that agree across all its parts, a status, category,
countries, companions and tags, and is linked to its rows via `tripId`.

| Trip | Status | Flights | Stays | Places | Tour | Other |
|---|---|---|---|---|---|---|
| Island – Ringstraße | completed | MUC→KEF, KEF→MUC | 5 (guesthouse, hotel, campsite) | ~8 (waterfalls, glacier lagoon, national park) | car, ~8 stops | 4 journal entries |
| Japan – Tokyo bis Kyoto | completed | FRA→HND, KIX→FRA | 3 hotels | ~8 (temples, shrine, castle) | train, ~5 stops | 3 journal entries |
| Toskana | completed | MUC→FLR, PSA→MUC | 2 (agriturismo as guesthouse, apartment) | ~6 | car, ~6 stops | 2 journal entries |
| Mittelmeer-Kreuzfahrt | completed | MUC→BCN, CIV→MUC | 1 hotel before embarkation | ~4 port-city sights | — | cruise with port and sea-day stops |
| Norwegen Hurtigruten | completed | MUC→BGO, TOS→MUC | — | ~4 | — | cruise |
| Portugal (future) | planned | 2 planned flights | 2 planned stays | ~4 not yet visited | car, planned | — |

Places that exist in the curated catalogue (world heritage sites, national
parks) set `curatedItemId`, so the checklists show progress without extra data.
Two user place lists group places across trips (e.g. "Wasserfälle",
"Nächstes Mal").

### 2.2 Bulk

- The existing random flights and cruises stay as they are.
- ~25 further lodging stays and ~60 further places across several countries,
  none of them attached to a trip, some visited, some not.
- Achievements are recomputed at the end, as today.

### 2.3 Tours

A tour is a `TripRoute` with ordered `TripStop`s. Legs are written through the
existing `recomputeLegs` (`services/tour/legRecompute.ts`), which stores
`source: "straight"` legs with a great-circle distance. No routing service is
called by the seed; a visitor can still ask the app for a road route.

### 2.4 Idempotency

`wipeDemoUser` is extended to delete, for the demo user, everything the seed
now writes: place visits, place list entries, place lists, places, lodging
stays, lodgings, journal entries, trip stops, trip routes (legs cascade),
companions and their links — before the rows it already deletes. The user row
itself stays, as today. Running the seed twice yields the same counts.

`ensureUser` also restores the account itself on every run: password back to
`demo123`, `mustChangePassword` false, two-factor secrets, recovery codes,
passkeys and API tokens removed. The guards in section 3 should make that a
no-op; the reset is the second line if a guard is ever missed.

### 2.5 Layout

`seedDemoAccount.ts` keeps `main()`, `ensureUser`, flights, cruises and the
exports `seedDevAdmin` imports. New code goes into `backend/src/seedDemo/`:

| File | Owns |
|---|---|
| `stories.ts` | the narrated trips as typed constants (no Prisma) |
| `seedStories.ts` | writes the narrated trips and links everything |
| `seedLodging.ts` | bulk lodging |
| `seedPlaces.ts` | bulk places, curated links, place lists |
| `seedTours.ts` | tour routes + stops + legs for a trip |

Airports, ships and ports are looked up by code in the pools `loadPools()`
already loads; a missing code fails the seed loudly rather than silently
dropping a flight.

## 3. Protection of the demo account

Everything below applies only when `user.isDemo` is true. A shared helper
(`middleware/demoGuard.ts`, exporting `rejectDemo`) answers
`403 { error: "DEMO_ACCOUNT_FORBIDDEN" }`, the code the two existing guards in
`routes/flights.ts` already use; those two move onto the helper.

Locked, because a visitor could lock out or harm every other visitor:

| Area | Routes |
|---|---|
| Password | `POST /api/v1/auth/change-password` |
| Two-factor | `POST /api/v1/auth/2fa/setup`, `/activate`, `/disable`, `/recovery-codes` |
| Passkeys | `POST /api/v1/auth/passkeys/register/options`, `/register/verify`, `PATCH` and `DELETE /api/v1/auth/passkeys/:id` |
| Device pairing | `POST /api/v1/pairing/start`, `/claim`, `/unpair` |
| API tokens | `POST` and `DELETE /api/v1/settings/tokens` |
| Provider keys | `PUT /api/v1/settings/api-keys` and its `/test/*` routes |
| Outbound connections | `PUT` and `POST /test` on `/api/v1/settings/immich` and `/api/v1/settings/dawarich` — a shared account must not point the server at an arbitrary URL |
| Profile picture | `POST` and `DELETE /api/v1/settings/profile-picture` — an uploaded image is shown to every other visitor |

Not locked: editing, adding and deleting travel data, display settings, map
colours, imports. The nightly reset puts the data back.

The frontend reads `isDemo` from `/auth/me` and, for the demo account, replaces
each locked control with one sentence saying the demo account cannot change it
(DE and EN). The server check is the protection; the UI only avoids offering a
button that always fails.

## 4. Credentials on the login page

A new environment variable `PUBLIC_DEMO_LOGIN` (default `false`, parsed in
`config/env.ts`) is added as `publicDemoLogin` to the unauthenticated
`GET /api/v1/setup/status`, which the app already calls before any login
(`App.tsx`). The OpenAPI schema of that route gains the field. When true, the login page shows a short line with
`demo` / `demo123` and a button that fills both fields. Without the variable an
install never displays credentials, even though a first install seeds the same
demo user.

## 5. CT134 rollout

1. Build `2.7.0-design.7` from `dev/design-system` and deploy it to the beta
   slot with `scripts/preview/deploy-preview.sh` (backup of DB and `.env` first,
   as on 2026-09-17).
2. Set `PUBLIC_DEMO_LOGIN=true` in the slot's compose environment and the beta
   switch on in `admin_settings`.
3. Run the seed in the container once; it resets the existing `demo` row to
   `demo123` (section 2.4). `admin`, `alex` and `claude` are not touched.
4. A cron entry on CT134 runs the seed in `preview-beta` nightly at 04:00 UTC and
   logs to `/opt/preview/beta/demo-reset.log`.
5. Leitstand `expect` for the preview instance follows the deployed tag.

CT106 gets `design.7` only on a separate owner request.

## 6. Tests

| What | How |
|---|---|
| Seed writes every domain, every narrated trip is complete | Jest against the test database: run the seed, assert per-domain counts > 0, and per narrated trip at least one flight, one stay (where specified), one place visit, one tour with ≥2 stops and legs = stops − 1 |
| Seed is idempotent | run twice, counts equal |
| Every tour leg is consistent | leg endpoints belong to the same route, distance > 0 |
| Guards | one test per locked route family: demo user → 403 `DEMO_ACCOUNT_FORBIDDEN`, normal user → not 403 |
| Login hint | Vitest: hidden without the flag, shown with it, the button fills both fields |
| Locked controls | Vitest: settings sections render the explanation instead of the control for `isDemo` |

Browser check after the CT134 deploy: log in as `demo` from the hint, open each
logbook, a narrated trip with its tour on the map, the places checklists, and
the security settings.

## 7. Out of scope

- Photos for trips, places or stays (no image assets in the seed).
- Real road geometry for tour legs.
- Changing `seedDemoUser.ts` (used by `seed:dev-admin` and the preview user
  script); it keeps its current content.
- Resetting the other preview accounts.
