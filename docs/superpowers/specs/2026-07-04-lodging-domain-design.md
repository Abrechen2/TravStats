# Lodging Domain (Hotels) — Design Spec

**Date:** 2026-07-04
**Source:** Discord `#hotel-poi-domain` brief (alexkuenzel_58740 + abrechen2)
**Branch:** `dev/hotels` (long-running, off `main`, releases several releases later)
**Status:** Design — reviewed 2026-07-10 (base-currency + FX and the migration
approach folded in, §7.1 / §3 / §17); ready for Phase-A implementation planning

## 1. Overview

Add **Lodging** as a new multi-domain domain to TravStats (alongside flights and
cruises): document hotels — and later campsites — you've stayed at, with per-stay
details, ratings, price, and map/timeline/stats/achievements integration. It
mirrors the **cruise domain** end-to-end (the reference implementation).

Core model, per the Discord brief: a **Lodging** (the place) is reused across
multiple **Stays** (Übernachtungen). A stay can be attached to a Trip but also
works standalone (like flights — you don't want to create a "trip" just to log a
one-night business stay). Booking-confirmation import and manual entry both
first-class.

### Goals
- A Lodging/Stay data model that works standalone or trip-linked, camping-ready.
- Manual entry + booking-confirmation import (email/PDF, 7 real samples on hand).
- Free coordinates via OSM geocoding → map pins (TravStats is map-centric).
- Ratings, price, chains, memberships, achievements, cross-domain stats.

### Decisions (confirmed with owner)
- **Domain key: `lodging`** (rename the existing `hotel` stub in `domains.ts`).
  Generic model names (`Lodging`, `LodgingStay`, …) with a `type`
  (`hotel` | `campsite`) field so **camping** is a future type, not a migration.
  UI labels each item as Hotel/Campingplatz by `type`; the domain is "Unterkünfte".
- **Ratings: 1–5 stars** (half-steps allowed) for room/breakfast/service/overall.
- **POI is a separate future domain** (the existing `poi` stub) — not built here;
  the geocoding + map-layer utilities are built reusable so POI docks onto them.

### Phasing (build order on the branch; released together)
- **A — Core domain:** models + migration + CRUD + manual entry + chains +
  memberships + trip-timeline + map pins + achievements + stats + **base currency &
  historical FX (§7.1)** + **OSM geocode-on-save (§7)** + turn the domain on.
  (The bulk.)
- **B — Booking import:** `lodgingBookingParser` + `lodgingEntityResolver`
  (chain match, **hotel dedup**, geocode) + email/PDF branch + import preview,
  driven by the 7 samples.
- **C — Keyed enrichment:** optional keyed enrichers (Amadeus/Foursquare) behind
  the User→Admin→ENV resolver, filling stars/amenities/photo/chain.

Each phase gets its own implementation plan; this spec is the shared contract.

## 2. Existing code this mirrors (cruise blueprint)

- **Domain registration:** `backend/src/shared/domains.ts` (`DOMAIN_KEYS`,
  `DOMAINS`, `AVAILABLE_DOMAINS`, `PARSER_SUPPORTED_DOMAINS`) + manual mirror
  `frontend/src/shared/domains.ts`. `hotel` already a stub (`available:false`).
- **Models:** `Cruise`/`CruiseStop`/`Ship`/`Port` in `schema.prisma` — the
  standalone-with-optional-`tripId` pattern, shared reference tables, `isUserAdded`.
- **Routes:** `routes/cruises.ts` (`router.use(authenticate)` + `requireWriteScope`,
  ownership via `findFirst({where:{id,userId}})`, `$transaction` for child rows,
  fire-and-forget `checkAndUpdateAchievements`). Reference routes `routes/ships.ts`
  / `routes/ports.ts` (`isUserAdded`, `invalidate*Cache`).
- **Parser:** `services/cruiseBookingParser.ts` (LLM + normalize) +
  `services/cruiseEntityResolver.ts` (fuzzy match + cache + hydrate) wired into
  `routes/emailParse.ts` / `routes/pdfParse.ts` via `parsed.domain === 'cruise'`.
- **Trip timeline:** cruises attach to a trip via the direct `Cruise.tripId` FK
  and `Trip.cruises` relation (NOT the generic `TripStop`); the frontend derives
  timeline entries.
- **Dashboard:** `frontend/src/types/dashboard.ts` (`DASHBOARD_TABS`,
  `TAB_MODE_REGISTRY` — `satisfies Record<DashboardTab,…>` forces a mode entry
  per tab) + `components/Dashboard/tabs/CruisesTab.tsx` + `MapContainer3D`.
- **Achievements:** `data/achievements.ts` (`AchievementDefinition.domain` union)
  + `data/achievementSeeds/partC.ts` (cruise) + `utils/achievementStats.ts` /
  `utils/cruiseStats.ts`.
- **Stats:** `routes/stats.ts` `GET /stats/cruise` + cross-domain union in
  `achievementStats.ts`.
- **Seeds:** `seedShipsFromCSV.ts` / `seedPortsFromCSV.ts` + `seedData/*.csv`,
  idempotent, `isUserAdded:false`.

## 3. Data model (Prisma migration)

**`Lodging`** — the place (user-scoped, reused across stays):
`id`, `userId→User(cascade)`, `type String @default("hotel")` (`hotel`|`campsite`),
`name`, `chainId Int?→LodgingChain(SetNull)`, `address?`, `city?`, `country?`,
`lat Float?`, `lon Float?`, `stars Int?` (1–5, official), `amenities String[]`,
`notes?`, `dataSource?` (parser|manual|enriched), timestamps.
Relation `stays LodgingStay[]`. `@@index([userId])`, `@@index([userId,type])`,
`@@map("lodgings")`. **Overall rating = derived** (avg of stays' `ratingOverall`),
computed on read, not stored.

**`LodgingStay`** — the event (mirrors `Cruise`):
`id`, `lodgingId→Lodging(cascade)`, `userId` (denormalized for query/ownership/stats),
`tripId String?→Trip(SetNull)`, `bookingId String?→Booking(SetNull)`,
`checkIn DateTime`, `checkOut DateTime` (**stored as hotel-local time**, like
flight airport-local times — do not normalize to UTC),
`status String @default("completed")`
(`scheduled`|`completed`|`cancelled` — **aligned with cruise/flight**, derived
from dates on create + auto-flipped, see §8.1), `roomNumber?`, `roomCategory?`,
`board?` (`none`|`breakfast`|`half`|`full`|`all_inclusive`),
`pricePerNight Float?`, `currency String? @default("EUR")`, `totalPrice Float?`,
`totalPriceBase Float?` (totalPrice converted to the user's base currency — **snapshot**,
computed once at write time from the check-in-day rate; see §7.1), `fxRate Float?`
(the historical rate used), `fxRateDate DateTime?` (the date the rate is for — the
check-in day), `fxBaseCurrency String?` (the base currency at conversion time),
`isAwardStay Boolean @default(false)` (paid with points/miles — for loyalty stats),
`ratingRoom/ratingBreakfast/ratingService/ratingOverall Float?` (1–5, half ok),
`roomAmenities String[]`, `bookingReference?`, `membershipId String?→LodgingMembership(SetNull)`,
`receiptUrl?` (attached confirmation, like `Flight.receiptUrl`), `companions String[]`,
`notes?`, parser provenance (`parserTemplate`, `parserConfidence`, `dataSource`),
timestamps. `@@index([userId])`, `@@index([lodgingId])`, `@@index([userId,checkIn])`,
`@@index([status])`, `@@map("lodging_stays")`. **`nights` derived** (checkOut−checkIn).

**`LodgingChain`** — shared reference data (mirrors `Ship`):
`id Int @id @default(autoincrement())`, `name`, `brandColor?`,
`loyaltyProgram?` (e.g. "Marriott Bonvoy"), `isUserAdded Boolean @default(false)`,
timestamp. `@@map("lodging_chains")`. CSV-seeded (Marriott, Hilton, IHG, Accor,
Wyndham, NH, Radisson, …).

**`LodgingMembership`** — user's loyalty enrollment (lean v1):
`id`, `userId`, `programName`, `chainId Int?→LodgingChain(SetNull)`,
`membershipNumber?`, `tier?` (Silver/Gold/Platinum…), timestamps.
`@@index([userId])`, `@@map("lodging_memberships")`.

**`Trip`** — add `lodgingStays LodgingStay[]` relation (direct FK, like
`Trip.cruises`). No `TripStop` schema change (already generic).

**`UserSettings`** — add `baseCurrency String? @default("EUR")`: the currency all
cross-currency spend rollups convert to. Per-user, editable in settings. Original
amount + per-stay `currency` are always preserved; the base value is derived on top
(see §7.1).

**`AchievementDefinition.domain`** — extend union to include `'lodging'`.

**Migration:** the prod schema drift that once blocked `prisma migrate dev` is
**already resolved on `main`** (migrations `20260419140000_schema_drift_fix` +
`20260430120000_post_v2_drift_fix`, guarded in CI by `npm run check:drift`). So the
lodging migration is generated the normal way — `npx prisma migrate dev --name
lodging_domain` — and `npm run check:drift` must stay green afterward (schema.prisma ↔
migrated DB agree). The old "hand-write additive migrations because of drift" caveat
no longer applies; the outdated gotcha in the worktree's CLAUDE.md disappears on the
next `git merge main`.

## 4. Domain registration

- `backend/src/shared/domains.ts`: rename the `hotel` entry key → `lodging`
  (`available:true`, i18nKey, icon 🏨, color, `routePrefix:"lodging"`); add
  `'lodging'` to `PARSER_SUPPORTED_DOMAINS` in Phase B.
- `frontend/src/shared/domains.ts`: mirror the rename manually.
- `frontend/src/types/dashboard.ts`: add `"lodging"` to `DASHBOARD_TABS`, define
  `LODGING_MODES` (e.g. `["map","nights","chains"]`), add
  `TAB_MODE_REGISTRY.lodging` (the `satisfies` constraint enforces it).
- i18n: `domain.lodging`, `dashboard:tabStrip.tabs.lodging`, plus lodging strings.

## 5. Backend architecture (cruise-parallel)

- `schemas/lodging.ts` — Zod `createLodgingSchema`/`updateLodgingSchema`,
  `createStaySchema`/`updateStaySchema`, `lodgingQuerySchema`, `membershipSchema`;
  `board`/`status`/`type` enums.
- `routes/lodging.ts` — Lodging CRUD + nested stays:
  `GET /` (filter by `type`/`chainId`/`tripId`/`year`/`country`, paginated),
  `GET /:id` (with stays + derived overall rating), `POST /`, `PATCH /:id`,
  `DELETE /:id`; stays: `POST /:id/stays`, `PATCH /:id/stays/:stayId`,
  `DELETE /:id/stays/:stayId`; `POST /:id/stays/:stayId/receipt` (upload, reuse
  the receipt upload middleware). Auth + `requireWriteScope`, ownership via
  `findFirst`, `$transaction` for stay writes, fire-and-forget achievements.
- `routes/lodgingChains.ts` — `GET /` (search) + `POST /` (manual add,
  `isUserAdded:true`, invalidate resolver cache). `routes/lodgingMemberships.ts`
  — user CRUD.
- `services/lodgingBookingParser.ts` — LLM (Ollama via `getAdminParserSettings`,
  the #129 lesson) with a lodging `SYSTEM_PROMPT` emitting `{"stays":[{hotel,…}]}`;
  normalize + `missing[]` tracking. Entry `parseLodgingBookingText()`.
- `services/lodgingEntityResolver.ts` — `resolveLodgingEntities(parsed, userId)`:
  fuzzy-match chain against cached `LodgingChain[]`; **dedup the hotel against the
  user's existing `Lodging` rows** (name + city/address fuzzy, like ship/port
  resolver) → reuse existing or flag new; **geocode** the address (§7). Cache +
  `invalidateLodgingCache()`.
- `services/geocoding/nominatim.ts` — OSM Nominatim `address → {lat,lon,country,city}`;
  respects the usage policy (≤1 req/s, descriptive `User-Agent`), result-cached.
- `services/fx/frankfurter.ts` — historical FX (§7.1): `getRate(from, to, date) →
  number` against Frankfurter.app (ECB reference rates, keyless, free), result-cached
  by `(from,to,date)`. Deliberately domain-neutral so cruise/flight spend can reuse it
  later. `convertToBase(amount, from, base, date) → {baseAmount, rate, rateDate}`;
  returns `null` on any failure — never throws into a save path.
- `routes/stats.ts` — `GET /stats/lodging` (nights, stays, spend, avg/night,
  chains, countries, per-year) + cross-domain union in `achievementStats.ts`
  (nights + spend + countries into the shared bag). `utils/lodgingStats.ts`
  `calculateLodgingStats`.
- `data/achievementSeeds/partD.ts` — lodging achievements (first hotel, N hotels,
  N nights, N chains, all star tiers, chain loyalty, N countries, longest stay,
  all-board-types, …); extend the domain union; `requirementType` keys +
  `utils/achievementStats.ts` wiring.
- `routes/emailParse.ts` + `pdfParse.ts` — add `if (parsed.domain === 'lodging')`
  branch → `parseLodgingBookingText` → `resolveLodgingEntities` → hydrate for
  preview (Phase B).
- Seed: `seedLodgingChainsFromCSV.ts` + `seedData/lodging_chains.csv`, idempotent,
  called at boot.

## 6. Frontend

- **Dashboard tab** `components/Dashboard/tabs/LodgingTab.tsx` — gated by
  `useEnabledDomains().isEnabled('lodging')`; list panel + `MapContainer3D` with a
  lodging-pin layer (override prop like `cruisesOverride`). Modes: map / nights /
  chains.
- **Lodging list + detail** — list (search, filter, sort by nights/rating/spend);
  detail shows the hotel (address, stars, amenities, chain, map) + its **stays**
  (each with dates, nights, room, ratings, price) + derived overall rating.
- **Stay editor** — modal: dates, room, board, ratings (1–5 star pickers), price
  + currency, room amenities (chips), booking ref, membership, trip link,
  receipt upload.
- **Membership manager** — CRUD of loyalty programs (program, chain, number, tier).
- **Chain picker** — search/select `LodgingChain`, add-new.
- **Trip timeline** — a stay linked to a trip renders **check-in + check-out**
  entries (title = hotel name, detail = date/time), derived from
  `Trip.lodgingStays` (mirrors how cruises appear).
- **Import preview** (Phase B) — the email/PDF import chooser gains a lodging path;
  the preview shows the parsed hotel(s) + stay(s), the dedup match ("existing
  hotel X" vs "new"), missing fields, geocode result; user confirms → persists.
- **Settings** (Phase C) — geocoding toggle + optional keyed-enricher config
  (Amadeus/Foursquare) via the API-key card pattern.
- `lib/api/lodging.ts` + `types/lodging.ts`; wiring in `DomainTabStrip`,
  `DashboardPage`, `MapContainer3D`; **i18n DE+EN together**.

## 7. Geocoding & enrichment

- **Free default — OSM Nominatim (Phase A)** (§5): address→coords for the map,
  run on lodging save (create/update) whenever the address changed and no manual
  coordinates were supplied. Keyless, works out of the box; the app is fully
  functional without any API key. A geocode failure never blocks the save — the
  lodging persists without coordinates and the user can pin it manually.
- **Optional keyed enrichers (Phase C)** — Amadeus Self-Service / Foursquare via
  the User→Admin→ENV resolver, to fill stars/amenities/photo/chain. Google Places
  is out (killed its free tier Feb 2025).
- The booking confirmation is the **primary** source; geocoding/enrichment only
  fills gaps (coordinates, missing stars/amenities/chain).

### 7.1 Currency & FX (Phase A)

Spend can be in any currency, so cross-currency rollups need a common denominator.

- **Base currency** — `UserSettings.baseCurrency` (default `EUR`), user-editable. Every
  cross-currency total (spend, avg/night, spend per year/chain/country) converts to it.
  The per-stay original `currency` + amount are **always kept** — nothing is destroyed.
- **Historical, snapshot conversion** — on stay create/update, if `currency !=
  baseCurrency` and a `totalPrice` exists, convert with the **ECB reference rate for the
  check-in day** via `services/fx/frankfurter.ts`, and store the result as a **snapshot**
  on the stay: `totalPriceBase`, `fxRate`, `fxRateDate` (= check-in day),
  `fxBaseCurrency`. The base value therefore reflects "what it cost me then" and does not
  drift with the daily rate. Same-currency stays set `totalPriceBase = totalPrice`,
  `fxRate = 1`.
- **Source** — Frankfurter.app / ECB: keyless, free, supports historical rates by date;
  results cached. Matches the keyless-by-default stance of OSM geocoding.
- **Re-conversion** — changing the base currency, or editing a stay's price/currency/
  check-in date, recomputes that stay's snapshot. A stay whose snapshot is stale relative
  to the current base (`fxBaseCurrency != baseCurrency`) is treated as unconverted for
  rollups (falls back to a lazy re-convert or is surfaced for a manual refresh — the
  Phase-A plan picks the exact trigger).
- **Error handling** — FX lookup failure never blocks a save: the stay persists with the
  original amount and **no** base value; rollups either skip it from the base total or
  show it under its own currency. A later successful conversion backfills the snapshot.
  (Same "never block the save" rule as geocoding, §11.)

## 8. Trip timeline integration

A `LodgingStay` with a `tripId` appears in that trip's timeline as two derived
entries: **Check-in** (title = lodging name, detail = check-in date/time) and
**Check-out** (title = lodging name, detail = check-out date/time) — interleaved
by date with flights/cruises. Mirrors the direct-FK approach cruises use
(`Trip.cruises`), not the manual `TripStop` list.

### 8.1 Status lifecycle & trip-planning integration

Lodging plugs into TravStats's plan→experience→retrospect lifecycle, using the
**existing cross-domain status vocabulary** (no new one):

- **Event status `scheduled | completed | cancelled`** (same as cruise; flight
  uses `scheduled|flown|cancelled`). On create, status is **derived from dates**
  (check-out in the past → `completed`, future → `scheduled`) — the same
  "status-from-dates" approach trips/cruise-import use — and maintained by the
  **auto-flip engine** (`scheduled` → `completed` once check-out passes,
  mirroring the flight `zombie_auto_flown` flip). Heed the zombie-flip lesson:
  don't let a future-dated `scheduled` stay fire "completed" stats early.
- **Reservation** = a `scheduled` `LodgingStay` **with a booking** (from import or
  manual) — a confirmed future stay, shown in the trip timeline.
- **Cancelled** = kept as a record, **excluded from stats/achievements**
  (`status != 'cancelled'`).
- **Tentative planning (not yet booked)** reuses the generic **`TripStop`**
  (`domain='hotel'`): while planning a trip you add a placeholder ("3 nights,
  hotel TBD, Bergen"); when you book it, it **promotes to a real `LodgingStay`**
  (`scheduled`). This keeps event status consistent across domains and reuses the
  existing timeline machinery instead of adding a `planned` event state.
- **Trip = the hub:** a `Trip` (`planned → in_progress → completed`, derived from
  its date range/contents) bundles flights + cruises + stays + TripStops + journal
  + photos chronologically; its status advances as its events' dates pass. Stats,
  achievements, the map, and cross-domain rollups ("Fly & Stay", "Grand Tour")
  only count `completed` events. Lodging is one more domain contributor into this
  container, not a standalone island.

## 9. Stats & achievements

`utils/lodgingStats.ts::calculateLodgingStats` builds the stats bag (mirrors
`cruiseStats.ts`), consumed by `GET /stats/lodging`, the dashboard, the
cross-domain scorecard, and the achievement checks. **Cancelled stays are
excluded** (like `status != 'cancelled'` for cruises).

### 9.1 Statistics catalog
- **Volume:** #lodgings, #stays, **total nights** (headline), nights/year +
  /month, avg nights/stay, longest stay, #chains, #cities, #countries.
- **Ratings:** overall avg; avg room/breakfast/service separately; best/worst
  hotel; rating distribution.
- **Spend:** headline total in the **base currency** (via each stay's `totalPriceBase`
  snapshot, §7.1), **plus** a per-currency breakdown of the originals (no information
  loss); avg/night, most/least expensive stay, spend per year/chain/country,
  award-vs-cash nights — all in base currency.
- **Loyalty/chains:** nights per chain (ranking), favorite chain, memberships +
  tier, chain-vs-independent ratio.
- **Geo:** countries (→ cross-domain "countries visited"), cities,
  most-visited hotel/city, map coverage.
- **Time:** seasonality (by month), weekend-vs-weekday, upcoming/planned stays.
- **Type (camping-ready):** hotel-vs-campsite nights.
- **Cross-domain (`achievementStats.ts` union):** nights + spend into the
  scorecard; countries union (flight+cruise+lodging); **"Fly & Stay"** (a trip
  with a flight + a stay); **"Grand Tour"** (flight + cruise + stay in one trip).

### 9.2 Achievements catalog (`data/achievementSeeds/partD.ts`, bronze→diamond)
Extend the `AchievementDefinition.domain` union with `'lodging'`. Fire-and-forget
`checkAndUpdateAchievements` on stay POST/PATCH; **pair stay DELETEs with
achievement cleanup** (engine is monotonic — see the orphaned-achievements
lesson). Requirement types feed a stats bag in `achievementStats.ts`
(`lodgingsCount`, `lodgingNights`, `lodgingChainsUnique`, `lodgingCountries`,
`lodgingChainLoyalty`, `lodgingStarTiersAll`, `lodgingSpendPerNight`,
`lodgingAwardNights`, `lodgingSameHotelRepeat`, `flyAndStay`, `grandTour`, …).

- **Volume:** First Check-in; Hotel Collector 5/10/25/50/100; Frequent Guest
  10/25/50/100 stays; Night Owl 10/50/100/**365 ("a year of nights")**/1000
  nights; Long Stay 7/14/30 nights in one stay.
- **Chains & loyalty:** Chain Explorer 3/5/10/20; Brand Loyalty 5/10/25 stays
  same chain; Collector (stayed at all major chains — like "Carnival
  Collector"); Status Seeker (reach Gold/Platinum in a program); Independent Fan.
- **Quality:** Five-Star Night; Star Collector (stayed 1★–5★ all tiers); Critic
  (rate N stays); Breakfast Gourmet (N × breakfast 5★).
- **Geography:** Border Crosser 3/5/10/25 countries; Continental (N continents);
  City Hopper (N cities).
- **Price/patterns:** Budget (stay under X/night); Luxury (over Y/night); Points
  Pro (N award nights); Returner (same hotel N×); New Year's Guest (check-in
  spanning Dec 31); Four Seasons (a stay in each season).
- **Board/amenities:** All-Inclusive; Spa Day (hotel with spa); Amenity
  Collector.
- **Cross-domain:** Fly & Stay (flight + stay in a trip); Grand Tour (flight +
  cruise + stay).
- **Camping (later):** First Campsite; camping-nights tiers; "Under the Stars".

Target ~40–50 achievements (cruise has ~30).

## 10. Import pipeline (Phase B)

Parse (LLM) → normalize (+`missing[]`) → resolve (chain fuzzy-match; **hotel
dedup** vs the user's existing lodgings by name+city; geocode address) → hydrate
for preview → user reviews/edits → confirm → persist: **create-or-reuse `Lodging`**
+ create `LodgingStay`. **Stay-level dedup:** re-importing the same confirmation
must not double the stay — match on lodging + check-in date + booking reference
(like the boarding-pass dedup) and offer update-vs-skip. Persist is an explicit
user action, not automatic (as with cruise). The 7
`test-samples/Hotel Buchungen/*.msg` are the regression fixtures
(multiple chains + independents, two platform formats); the existing `.msg`→text
extraction handles the binary format.

## 11. Error handling
Geocoding failure → stay saved without coords (map pin omitted), user can set it
manually; never block a save on geocoding. Parser/LLM unavailable → clear message,
manual entry always works. Dedup ambiguity → surface both options in the preview,
let the user pick reuse-vs-new. Never swallow errors (project convention).

## 12. Security
Ownership on every route (`findFirst({where:{id,userId}})`). Zod at all
boundaries. Receipt files validated (reuse `fileValidation`) + served
ownership-checked (like flight receipts). Geocoder/enricher keys encrypted at rest
and never sent to the frontend. Nominatim requests carry a descriptive User-Agent
and are rate-limited per its policy.

## 13. Testing
- **Unit:** Zod schemas; `lodgingEntityResolver` (chain fuzzy-match, hotel dedup,
  nights/overall-rating derivation); `lodgingBookingParser` normalize against
  fixtures; `nominatim` against mocked responses; `calculateLodgingStats`;
  achievement requirement checks.
- **Integration:** Lodging/Stay CRUD + ownership; stay→trip timeline; receipt
  upload/serve; import parse→resolve→persist against the 7 samples (mocked LLM
  output).
- **Frontend (Vitest):** list/detail, stay editor (star pickers, currency),
  membership manager, import preview (dedup match display), map layer data.
- No live Ollama/Nominatim in CI — fixtures + mocks; manual smoke during UAT.

## 14. Surface area — files to add/modify (from the cruise blueprint)

Backend: `shared/domains.ts` (rename+enable), `prisma/schema.prisma` + migration,
`schemas/lodging.ts`, `routes/lodging.ts`, `routes/lodgingChains.ts`,
`routes/lodgingMemberships.ts`, `services/lodgingBookingParser.ts`,
`services/lodgingEntityResolver.ts`, `services/geocoding/nominatim.ts`,
`services/fx/frankfurter.ts` + `UserSettings.baseCurrency` (migration + settings
route/schema), `routes/emailParse.ts` + `pdfParse.ts` (branch), `routes/stats.ts`
(`/stats/lodging`), `data/achievements.ts` (union) +
`data/achievementSeeds/partD.ts`, `utils/lodgingStats.ts` +
`utils/achievementStats.ts` wiring, `seedLodgingChainsFromCSV.ts` +
`seedData/lodging_chains.csv`, app route registration.
Frontend: `shared/domains.ts` mirror, `types/dashboard.ts`,
`components/Dashboard/tabs/LodgingTab.tsx`, `DomainTabStrip.tsx`,
`pages/DashboardPage.tsx`, `MapContainer3D.tsx` (lodging layer),
lodging list/detail pages + `components/lodging/*` (StayEditor, MembershipManager,
ChainPicker, LodgingMapLayer), `lib/api/lodging.ts`, `types/lodging.ts`, i18n de/en.

## 15. Constraints (inherited)
TS `strict`, `any` forbidden; Zod at boundaries; Pino logger; immutability;
files 200–400 ideal/800 max; code/comments/commits English, UI DE+EN;
domain-gating (iterate `AVAILABLE_DOMAINS`, register both `domains.ts` mirrors);
**never touch `backend/VERSION`/`CHANGELOG.md` on this branch**; sync-forward via
`git merge main` after each release.

## 16. Deferred / roadmap
POI domain (separate, shares the geo/map utilities built here); **camping**
(a new `type` value + a few campsite-specific fields — no schema surgery);
keyed enrichers (Amadeus/Foursquare); loyalty-tier progress ("N nights to next
tier"); spend analytics dashboard; **Immich photo linking per stay** (once the
Immich feature ships — cross-feature synergy).

## 17. Open questions / considerations
Confirmed: domain `lodging` (generic models + `type`), 1–5 star ratings,
standalone-or-trip stays, hotel + stay dedup on import, OSM geocoding free
default, POI/camping deferred, phased A/B/C. **Resolved 2026-07-10 in the
brainstorming review:**
- **Currency aggregation → base currency + historical FX, in Phase A.** Per-user
  `baseCurrency` (default EUR); mixed-currency spend converts via a snapshot at the
  ECB rate for the check-in day (Frankfurter.app, keyless); per-currency breakdown
  kept alongside. Full design in §7.1. (Supersedes the earlier "per-currency-only v1".)
- **Migration → normal `prisma migrate dev`.** The drift that once forced hand-written
  migrations is already fixed on `main` and CI-guarded (§3).
- **Rating scale storage:** `Float` (half-stars, e.g. 4.5); UI is a 5-star picker with
  half steps.

Still decide during Phase-A planning:
- **Nights across a year/month boundary:** a 30.12→02.01 stay must **allocate nights to
  the correct year/month** in `nights/year` + `nights/month` stats (not just count by
  check-in year).
- **Stale-snapshot trigger:** exact mechanism for recomputing `totalPriceBase` when the
  base currency changes (lazy re-convert on read vs. an explicit "refresh rates" action)
  — §7.1.
