# Rail — a fifth domain for train journeys

Date: 2026-09-25 · Branch: `dev/rail` · Status: phase 1 implemented behind the beta switch

## Why

Owner decision 2026-09-25: rail becomes its own domain. It was promised in
`#dev-talk` on 2026-09-20 as "individual train journeys like flights". A train
ride is a logged, dated, point-to-point movement with an operator, a number, a
seat and a price — the same shape as a flight, not the shape of a tour section.

**Not a roadtrip vehicle.** The roadtrip branch (another session, not touched
here) still carries `rail` in `ROADTRIP_VEHICLES`. When the two lines meet,
`rail` must leave that list, and the roadtrip migration has to decide what
happens to rows that already carry `vehicle = 'rail'` (they may exist on beta
instances). The options are: keep them readable as a legacy value, or offer a
one-way conversion of such a section into a `RailJourney`. That is listed below
as an owner question; the rail domain does not depend on the answer.

## How cruise did it — the model this follows

Cruise was the second domain and set the pattern rail copies:

| Concern | Cruise | Rail |
|---|---|---|
| Registry | `shared/domains.ts` (backend + frontend mirror) | `rail` added to `DOMAIN_KEYS` in both |
| Gating | `useEnabledDomains()`, `DomainRouteGuard` | same, **plus** the beta gate `railDomain` (see below) |
| Router | `routes/cruises.ts`, enveloped family | `routes/rail.ts`, enveloped family (ADR 0001: a new domain picks the enveloped family) |
| Schemas | `schemas/cruise.ts` | `schemas/rail.ts` |
| Companions | `companions String[]` + `CruiseCompanion` join, dual write | same: `RailJourneyCompanion` |
| FX | `fxColumnsFor` snapshot on the start day | same, dated by the departure |
| Trip link | own `tripId`, `assertReferencesOwned` | same |
| Status | stored cache of a date derivation + hourly sweep | same, lodging's vocabulary |
| Documents | `Document.cruiseId` + one-owner CHECK | phase 2 |
| Stats / dashboard tab / map layer | per-domain loaders, tab component, layer | phase 2 |
| Parser | `PARSER_SUPPORTED_DOMAINS` + templates | phase 3 |

## Data model

One row is **one train ride** — one vehicle, boarded at one station and left at
another. That is what "like flights" means: a flight row is one leg, and a
connection is several legs.

### `RailJourney`

| Column | Type | Notes |
|---|---|---|
| `operator` | text? | Free text in phase 1 ("DB Fernverkehr", "SBB", "Trenitalia"). An operator catalogue is phase 2. |
| `trainCategory` | text? | "ICE", "IC", "TGV", "RJX", "EC", "RE" — kept apart from the number because statistics group by it. |
| `trainNumber` | text? | "578". Text, because "9 578" and "TGV 9876/9877" exist. |
| `depStationName`, `arrStationName` | text | Required. |
| `depStationCode`, `arrStationCode` | text? | UIC/EVA code when known — empty in phase 1, filled by the catalogue in phase 2. |
| `depLat/depLon`, `arrLat/arrLon` | float | **Required**, as on `Flight`. A station without a position cannot be drawn, measured or put in a time zone, and every one of those is the point of logging it. |
| `depCountry`, `arrCountry` | text? | ISO 3166-1 alpha-2, from the geocoder. Null when unknown — never guessed. |
| `depTimezone`, `arrTimezone` | text? | IANA zone, **derived on the server from the coordinates** (`geo-tz/all`, the same function stays use). Not user input. |
| `departureTime` | timestamptz | Required. A real UTC instant. |
| `arrivalTime` | timestamptz? | A real UTC instant; may be unknown. Must not precede the departure. |
| `distanceKm` | float? | See "Geometry". |
| `distanceSource` | text? | `great_circle` \| `user` \| null. |
| `travelClass` | text? | `first` \| `second` \| `sleeper` \| `couchette`. |
| `coach`, `seat` | text? | "Wagen 7", "Platz 45". |
| `bookingReference` | text? | Auftragsnummer / PNR. |
| `price`, `currency` + FX snapshot | | Same five FX columns as `Cruise`/`Flight`. |
| `status` | text | `scheduled` \| `in_progress` \| `completed` \| `cancelled`. |
| `delayMinutes` | int? | Arrival delay as experienced. Null = not recorded, 0 = on time. Never collapsed (the abstention rule). |
| `notes`, `tags`, `companions` | | As on cruises. |
| `tripId`, `bookingId` | uuid? | Ownership-checked. |
| `externalRef`, `importBatchId` | | Reserved for imports (phase 3), same contract as cruises. |

**Times.** The form asks for the wall clock *at the station* ("08:15 ab
Frankfurt") — the one a ticket prints. The client sends `departureLocal` /
`arrivalLocal` as `YYYY-MM-DDTHH:mm` without an offset; the server finds the
station's zone and stores the real instant. This keeps geo-tz out of the
browser bundle and keeps one rule for "whose clock is it" — the same answer
`utils/stayInstant.ts` gives for hotels. A station in no zone (open sea is the
only real case, and a station cannot be there) abstains: the wall clock is
stored as UTC and the zone is null, exactly as for a stay without coordinates.

**Status.** Rail uses lodging's domain-neutral vocabulary rather than the
flight words — a train is not "flown". The owner's "planned / done / cancelled"
maps onto `scheduled` / `completed` / `cancelled`; `in_progress` is the derived
state while the train is running. `cancelled` is the only value a client sets;
the rest is derived from departure/arrival on write and converged by the hourly
status sweep. No slack band: unlike flights, no legacy writer ever set these.

**Multi-leg bookings with changes.** A connection (Frankfurt → Mannheim →
Basel) is two rows. What binds them is the existing `Booking` model — the same
thing that binds a flight's legs — via `bookingId`, which carries the PNR and a
price for the whole booking. Phase 1 accepts `bookingId` on the API and keeps
the per-leg `bookingReference`; the UI to add a "connecting train" (prefilled
from the previous leg's arrival and booking) is phase 2. A change of trains is
therefore visible as two consecutive rows whose stations meet, with no extra
table and no extra state to keep consistent.

## Station catalogue

Evaluated:

| Source | Licence | Coverage | Verdict |
|---|---|---|---|
| **Trainline `stations.csv`** (github.com/trainline-eu/stations) | ODbL 1.0 | ~Europe, tens of thousands of stations, with UIC code, coordinates, country, **IANA time zone**, `is_suggestable`, parent station, per-carrier ids (DB, SNCF, Trenitalia, …) | **Chosen** |
| DB InfraGO "Stationsdaten" | CC BY 4.0 | Germany only | Too narrow as the base; a possible top-up for German detail. |
| UIC / MERITS station list | Commercial | Europe | Not usable for an open project. |
| OSM `railway=station` via Overpass | ODbL | Worldwide | Live queries against a shared public service on a user's keystroke; no UIC codes in most of the world. Better as the fallback, which the app already has. |
| Photon (OSM) — `LocationInput`, already in the app | ODbL | Worldwide | Used in phase 1 as the station field. |

**Decision:** phase 2 vendors a filtered copy of Trainline's CSV (rows with
coordinates and `is_suggestable = t`, plus their parents) under
`backend/data/rail/stations.csv`, seeded into a `RailStation` table by an
idempotent seeder exactly like ports and ships (`isUserAdded` rows never
overwritten). Why this one: it is the only open source that carries the UIC
code **and** the time zone per station, which is what matching a ticket and
placing its times both need, and it is a file, not a service — no runtime
dependency on anybody's API. ODbL obligations: attribution in the README / about
page and in the data directory, and the filtered derivative is itself published
under ODbL (it is, by living in this public repository). The licence of the code
(AGPL) is unaffected — ODbL governs the database, not the program.

Outside Europe the station field keeps falling back to the geocoder search that
phase 1 uses, so nothing is lost where the catalogue is thin.

Phase 1 stores exactly the fields a catalogue row will later fill
(`name`, `code`, `lat/lon`, `country`, `timezone`), so phase 2 only adds an
optional `depStationId`/`arrStationId` foreign key; no row has to be migrated.

## Geometry

- **Phase 1: great-circle.** `distanceKm` is the haversine distance between the
  two stations (`utils/geo.calculateDistance`), stored with
  `distanceSource = 'great_circle'`, recomputed when a station moves. A user may
  type the real distance from the ticket; that is kept (`'user'`) until the user
  clears it. The map line (phase 2) is a straight chord.
- **Later: routed.** OSM rail routing (e.g. a vendored network in the manner of
  the marnet shipping lanes, or an external router such as signal.eu's
  OSRM-based rail profile) would give a real track length. Great-circle
  understates rail distance by roughly 10–30 %; the statistics must label it as
  straight-line until then rather than present it as track kilometres.

## Statistics (phase 2)

Kilometres by train (split by `distanceSource`), journeys, hours on board
(from instants — both zones are known), countries touched (dep/arr country;
transit countries only once routed), operators and train categories ranked,
delay distribution (only rows with a recorded delay, the abstention rule), and
the cross-domain overview (`crossDomainCounting`, `crossDomainPopulations`
currently answer an empty population for rail).

## Map

Colour: `domainColor.rail = #d4655c` in `design/tokens.json`, generated into
`--ts-domain-rail`, mirrored in both `DOMAINS.rail.color`. A brick red: far
from flight amber, cruise teal, hotel mint, the POI ink and the tour olive, and
the colour most European readers already associate with a train. Layers and
legend resolve it through the domain colour store like every other domain —
never a hardcoded arc colour. `--domain-train` stays what it is today: the
alias of the tour colour for tour sections by train.

## Imports (phase 3)

- DB booking confirmations (PDF "Ihre Fahrkarte", e-mail "Buchungsbestätigung"):
  a template parser first — the PDF has a stable layout with Auftragsnummer,
  Hin-/Rückfahrt, Halt/Datum/Zeit/Gleis tables per leg — then the generic LLM
  path. Rail joins `PARSER_SUPPORTED_DOMAINS` only when that exists.
- Trainline / SNCF Connect / ÖBB / SBB confirmations, Apple Wallet passes.
- The DB Navigator "Reisen" export and bahn.de "Meine Buchungen" have no
  documented export; not planned.
- Documents (`Document.railJourneyId` + extending the one-owner CHECK) in phase 2,
  so the kept ticket files with its journey before parsing exists.

## Gating

Two conditions, as Places had until 2026-09-05:

1. **Instance:** beta key `railDomain` in `frontend/src/config/betaFeatures.ts`.
   The module toggle (settings) and the setup domain picker offer rail only
   when the flag is on — the flag ALONE there, because those are where the user
   switches the domain on.
2. **User:** `useEnabledDomains().isEnabled("rail")`.

`useRailVisible` / `useRailAccess` combine both and are the rule's one home
(nav, logbook tabs, the route guard). The backend endpoints stay reachable, as
for every beta feature — this is a visibility gate, not a boundary.

`DOMAINS.rail.available = true`, so shared code iterating `AVAILABLE_DOMAINS`
sees rail. Where that code would draw something rail cannot yet fill (the
dashboard tab strip), rail is excluded explicitly with a pointer to phase 2.

## Phases

**Phase 1 (this branch):** model + migration, Zod, CRUD router with list
paging, OpenAPI with response schemas, ratchet family, status derivation +
sweep, companions (join table + dual write), trip link (write + ownership),
FX snapshot, both registries, beta gate, logbook list page + create/edit/delete
modal (station via `LocationInput`, `CurrencySelect`, `CompanionPicker`, the
comma tag field), i18n DE+EN, tests.

**Phase 2:** station catalogue (Trainline CSV) + station picker, connecting-train
UI via `Booking`, trip timeline and trip status bounds including rail, detail
page, documents, map layer + dashboard tab, statistics, achievements, CSV/XLSX
import, backup/export coverage, demo seed.

**Phase 3:** DB/Trainline/SNCF parser templates, routed geometry, delay lookup.

## Open questions for the owner

1. **Existing roadtrip rows with `vehicle = 'rail'`:** keep as legacy, or offer
   a conversion into rail journeys when the roadtrip branch drops the value?
2. **Tours by train:** tour sections can still be "by train" (the tour icon).
   Should a tour section by train be offered as a rail journey instead, or do
   the two coexist (a tour is a route, a rail journey is a ticket)?
3. **Achievements for rail** (km by train, countries by train, night trains):
   wanted in 2.8, or later?
4. **Colour:** `#d4655c` brick red — acceptable, or does the Companion app need
   to pick first (the rule is one colour per domain across web and phone)?
5. **Companion app:** does the phone app get rail in the same release, or does
   the web ship rail first?
6. **Trip bounds:** should a train ride extend a trip's start/end dates and
   status like flights and cruises do (proposed: yes, phase 2)?
7. **Distance in the statistics before routing exists:** show straight-line km
   labelled as such (proposed), or hide the kilometre figure until routed?
