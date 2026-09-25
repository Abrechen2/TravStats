# Rail — a fifth domain for train journeys

Date: 2026-09-25 · Branch: `dev/rail` · Status: phases 1, 2a and 2b implemented behind the beta switch

## Why

Owner decision 2026-09-25: rail becomes its own domain. It was promised in
`#dev-talk` on 2026-09-20 as "individual train journeys like flights", after a
tester suggested rail as a domain of its own — because open APIs exist that can
show a train journey properly, including the route the train actually took. A train
ride is a logged, dated, point-to-point movement with an operator, a number, a
seat and a price — the same shape as a flight, not the shape of a tour section.

**Not a roadtrip vehicle.** The roadtrip branch (another session, not touched
here) still carries `rail` in `ROADTRIP_VEHICLES`. When the two lines meet,
`rail` must leave that list, and the roadtrip migration has to decide what
happens to rows that already carry `vehicle = 'rail'` (they may exist on beta
instances). Owner decision (below): offer a one-way conversion of such a
section into a `RailJourney` when the roadtrip branch drops the value. The rail
domain itself does not depend on it.

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
| `geometry` | jsonb? | `[[lon, lat], …]`, fetched ONCE when the journey is logged and frozen with it. Null = the chord between the stations. |
| `geometrySource` | text | `none` \| `straight` \| `transitous` \| `openrailrouting` \| `manual`; default `straight`. Phase 1 writes only `straight`. |
| `actualDepartureTime`, `actualArrivalTime` | timestamptz? | What happened, when known (captured on the day or typed). Null for a past journey nobody recorded. |
| `lookupProvider`, `lookupRef` | text? | The timetable trip a lookup matched (phase 2) and the provider's id for it. Separate from `externalRef`, the per-user unique IMPORT key — two journeys may match the same trip. |
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

Three sources, in this order, and the map always says which one it shows
(`geometrySource`), because a line routed over the TRACKS may not be the line
the train took:

1. **Transitous / MOTIS** (api.transitous.org), phase 2. A matched trip's leg
   geometry follows the real train. Fetched **once** when the journey is logged,
   stored in `geometry` and **frozen** — a timetable changes, the ride that
   happened does not, and a re-fetch would also be a request against a service
   that asks to be cached. Terms to honour: open-source and non-commercial use
   only, a User-Agent with contact details, caching, a link to its sources page,
   asking first before using heavy endpoints, no SLA. Feeds without shapes come
   back as straight segments; a leg whose "geometry" is a straight segment over
   roughly 35 km is stored as `straight`, not as `transitous`.
2. **OpenRailRouting** (Geofabrik; GraphHopper, Apache-2.0; OSM data ODbL),
   phase 3, as an **admin-configurable URL to a self-hosted instance** — for
   journeys Transitous cannot match. It routes over the tracks and may pick
   another line than the train used, hence its own source label. The public
   demo is experimental and is never a default.
3. **Straight line** (great-circle chord), always — the fallback, and the whole
   of phase 1. Stored as `geometry = null`, `geometrySource = 'straight'`.

Considered and not used: BRouter's rail profile (lighter, known wrong turns at
switches — Träwelling uses it), signal.eu.org (no API), OSRM rail (stale), raw
GTFS shapes (only reachable through MOTIS anyway).

**Distance** follows the geometry: great-circle in phase 1
(`utils/geo.calculateDistance`, `distanceSource = 'great_circle'`, recomputed
when a station moves). A user may type the real distance from the ticket; that
is kept (`'user'`) until cleared. Once a Transitous or OpenRailRouting line
exists, its length is the better figure; until then great-circle understates
the track by roughly 10–30 %, and the statistics label it as straight-line
(owner decision 7).

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

## Lookup by train number and date (phase 2)

A chain like the flight lookup, each step falling through on a miss:

1. **Transitous** — primary, no key.
2. **db-rest** (`v6.db.transport.rest`, Germany; unofficial, built on
   db-vendo-client since DB's HAFAS was shut down; ~100 requests/min).
3. Country plug-ins, later: Entur (Norway, `ET-Client-Name` header),
   SNCF/Navitia (key), Trafiklab (Sweden, key), transport.opendata.ch
   (Switzerland).
4. Manual entry — always available.

A hit fills stations, times and `lookupProvider`/`lookupRef`, and fetches the
geometry once. Avoided: DB RIS::Journeys (contract), HAFAS scraping. DB
Timetables (free key, CC BY 4.0, 60/min) only reaches hours ahead, so it is no
lookup for a past journey.

**Honest limits.** No free API reliably answers a PAST date's timetable, and
none answers past actual times at all. A journey logged the same day can
capture actual times and the delay; an older one stores `null` unless the user
types the delay — never 0, never a guess (the abstention rule). The only route
to German past delays is the piebro/deutsche-bahn-data archive (CC BY 4.0), an
offline bulk import at most, later. Unverified so far: OpenRailRouting's memory
needs for a Europe import, BRouter's licence and server policy, Transitous'
rate limits and how far back it keeps timetables, SNCF and opendata.ch quotas.

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

**Phase 1 (this branch):** model + migration (including the geometry, actuals
and lookup columns, so phase 2 needs no second migration for them), Zod, CRUD
router with list paging, OpenAPI with response schemas, ratchet family, status
derivation + sweep, companions (join table + dual write), trip link (write +
ownership), FX snapshot, both registries, beta gate, logbook list page +
create/edit/delete modal (station via `LocationInput`, `CurrencySelect`,
`CompanionPicker`, the comma tag field), i18n DE+EN, tests.

**Phase 2:** station catalogue (Trainline CSV) + station picker; train-number
lookup chain (Transitous → db-rest → manual); Transitous trip geometry, fetched
once, frozen, labelled, straight line as fallback; connecting-train UI via
`Booking`; trip timeline and trip status bounds including rail; detail page;
documents; map layer + dashboard tab; statistics with straight-line km labelled
as such; CSV/XLSX import; backup/export coverage; demo seed; the roadtrip
conversion offer.

**Phase 3:** admin-configurable self-hosted OpenRailRouting URL; delay data
(same-day capture of actual times; the German archive as an optional bulk
import); DB/Trainline/SNCF parser templates; country lookup plug-ins.

**2.8 or later:** rail achievements (owner decision 3).

## Owner decisions 2026-09-25

The owner took every proposal ("nimm die Vorschläge"):

1. **Existing roadtrip rows with `vehicle = 'rail'`:** offer a one-way
   conversion into rail journeys when the roadtrip branch drops the value.
2. **Tours by train:** tour sections by train and rail journeys coexist — a
   tour is a route, a rail journey is a ticket.
3. **Achievements for rail:** later, 2.8.
4. **Colour:** `#d4655c` brick red, accepted.
5. **Companion app:** web first, the Companion follows later.
6. **Trip bounds:** a train ride extends a trip's dates and status like flights
   and cruises — in phase 2.
7. **Distance in the statistics before routing exists:** show straight-line km,
   labelled as such.

## Phase 2a — as built (2026-09-25)

Station catalogue, train-number lookup and Transitous geometry. What the
implementation settled, and what was measured on the way:

- **Catalogue file.** `backend/data/rail/stations.csv.gz`, built by
  `backend/scripts/build-rail-stations.mjs` from Trainline `stations.csv`
  (commit `a3e44375`): 52 808 stations (suggestable with a position, plus
  their parents), 3.5 MB of CSV, **1.16 MB gzipped**; `*.gz` is binary in
  `.gitattributes`. Nine columns — the eight named above plus `db_id`, because
  db-rest addresses stops by DB's EVA number, which is not the UIC code
  (Frankfurt (Main) Hbf: UIC 8011068, EVA 8000105). 21 k of the rows are
  Swiss bus stops without a rail code; search ranks coded rows first rather
  than dropping them. Seeding a fresh database takes ~6 s, a seeded boot
  ~0.2 s. Licence and provenance: `backend/data/rail/LICENSE.txt`; credited in
  the README and under Settings → About.
- **Search.** `GET /rail/stations?q=` — a `search_name` column (lower case,
  diacritics folded, punctuation to spaces) with a `pg_trgm` GIN index; every
  query word must start a word of the name ("hb" finds Zürich HB, not
  Frohburg); seven or eight digits match UIC or EVA exactly.
- **Journeys.** `depStationId`/`arrStationId` (FK, `SET NULL`). With an id the
  server takes position, code and country from the catalogue; the name stays
  the client's.
- **Lookup.** `GET /rail/lookup` needs a boarding station: MOTIS has no
  search by train number, so the lookup reads that station's departures of the
  day (four-hour windows, stopping at the first match) and picks the train by
  its label. Transitous, then db-rest for German stations. Each provider's
  outcome is reported (`matched`, `noMatch`, `unavailable`, `disabled`,
  `notApplicable`). Admin switches `admin_settings.rail_transitous_enabled` /
  `rail_db_rest_enabled`, both on by default; `RAIL_LOOKUP_CONTACT` goes into
  the User-Agent Transitous asks for. Answers are cached for six hours by URL
  (the validated, stripped value — a four-hour stoptimes page at Frankfurt Hbf
  is ~270 kB on the wire).
- **Past days, measured against the live service.** Asked for any day before
  its timetable begins (2024-06-01, 2025-12-01, 2026-06-01, 2026-09-01),
  Transitous answers with the departures of **the first day it has
  (2026-08-25)**, not with nothing. The lookup therefore drops every departure
  that is not on the asked day in the station's zone; without that guard it
  would have filled a 2024 journey with a 2026 train. A day beyond the feed
  (2027-03-01) comes back empty. db-rest answered 503 on every request that
  day. The form says before the lookup that a past day rarely finds anything.
- **Geometry.** Saving with a Transitous match fetches the trip once (usually
  from the lookup's cache), cuts the line to the two stations (each within
  2 km of it, in order), and stores it frozen with `geometrySource =
  transitous` and the distance along it (`distanceSource = route`). A line
  with any segment over 35 km, an unreachable Transitous, a station off the
  line or a switched-off provider stores `straight`. The line is fetched again
  only when a station or the match changes. ICE 696 Frankfurt → Berlin
  Gesundbrunnen came back with 9 750 points, 547 km.

Phase 2b followed the same day; see below.

## Phase 2b — as built (2026-09-25)

Rail stays behind the `railDomain` beta gate after phase 2 (owner rule,
2026-09-25): every surface below is hidden with the gate off, each with its
own test, and the gate comes off only when the owner explicitly takes rail
out of beta.

- **Detail page, documents, connecting trains** (`/rail/:id`,
  `Document.railJourneyId`, the connection read through `Booking`).
- **Trip bounds and timeline.** A ride widens its trip's dates and status
  like a flight or a cruise (`tripStatusBounds`); the trip timeline and the
  logistics tab list it on its stations' clocks.
- **Dashboard tab and map layer.** A `rail` tab (globe and flat map, the globe
  first) and a rail chip on the "Alle" map, one layer module for all of them:
  the frozen Transitous line where there is one, else the great circle drawn
  lighter; the colour from the domain colour store, the key naming only the
  kinds of line drawn.
- **Statistics.** `GET /rail/stats` and a rail tab on the statistics page:
  rides, kilometres **per source** (straight line, traced line, ticket — never
  one undifferentiated number, owner decision 7), hours on board and delays
  with their sample size, countries, operators, train categories, top
  stations, the longest ride, rides per year. "Does a ride count, and on which
  day" lives in `shared/railCounting.ts` (mirrored): completed only, filed
  under the year it left on its departure station's calendar, active on the
  arrival station's day too. The cross-domain overview and its evidence
  population both ask it — `crossDomainPopulations` no longer answers an empty
  population for rail.
- **Export.** A "Train rides" sheet in the Excel export, times on each
  station's clock, the distance with its source. **Export-only:** the
  spreadsheet importer is being reworked on another line that is merging into
  main; rail import (`importableSpecs` + a server-side rail sheet) follows
  after this branch merges main, not before. The JSON data export carries each
  user's rail journeys and the user-added rail stations; the pg_dump backup
  already covered both tables.
- **Demo seed.** Four rides (ICE, RJX, a Nightjet across New Year, an
  upcoming TGV) in both demo seeders, through the router's wall-clock
  conversion and status derivation.
- **Roadtrip conversion — contract only.** The roadtrip code is on main, not
  here. `services/rail/roadtripConversion.ts` states the conversion against
  structural types that mirror main's `TripRoute` / `TripStop` /
  `TripRouteLeg` columns by name and plans it purely: one LEG becomes one
  journey (a section is a route, a journey a ticket — decision 2); a leg
  without a date or a position is skipped with its reason; a day-only date
  becomes noon UTC and the notes say so; a routed or drawn leg keeps its line
  and distance (`route` / `manual`), a straight one becomes a straight ride.
  **When this branch merges main:** remove `rail` from `ROADTRIP_VEHICLES`
  (`shared/tour/roadtrip.ts`) in the merge, replace the structural types with
  the Prisma ones, and add the offer — an endpoint per `vehicle = 'rail'`
  section that writes the drafts through the rail write path (station
  matching, FX, status) and deletes the section in the same transaction, only
  once every ride was written.

**Map check in the production bundle (2026-09-25).** `vite build` + `vite
preview`, backend against a seeded dev database, beta switch and rail domain
on, the four demo rides plus ICE 597 Frankfurt → München logged through the
Transitous lookup (7 188 points, 420 km, `route`). On both the globe and the
flat map the traced line and the straight chords draw in `#d4655c`; setting a
different rail colour in the domain colour store turned the lines AND both
legend rows to it, so neither is hardcoded. With the switch off,
`/dashboard/rail` redirects to the dashboard, the Bahn tab, legend rows and
next-up entry are gone, and `/stats?tab=rail` shows the overview. The check
found one defect, fixed with it: the statistics page parsed `?tab=` against a
hand-written list of the four older domains, so the Bahn tab reset itself to
the overview on every click. Noted, not changed: every dashboard tab opens on
the whole world rather than the rides' extent, which on a Europe-only rail
logbook makes the lines small until one zooms.

## Merged with main — as built (2026-09-25)

`dev/rail` took main in at `c6277fd3` (roadtrips and tours as their own
domain, open data, entry suggestions, the reworked spreadsheet importer). What
the merge settled and what it made possible:

- **Registries.** `rail` sits after `roadtrip` in `DOMAIN_KEYS` on both sides;
  the beta registry carries both `roadtrips` and `railDomain`, and every picker
  asks each gate for its own domain.
- **Migrations.** The three rail migrations were renamed to
  `20260925190000`–`190200`, after main's photo migrations of the same
  afternoon. They had not left the branch; a fresh database migrates cleanly
  and `check:drift` reports no difference.
- **Rail left the roadtrip vehicles.** `ROADTRIP_VEHICLES` no longer lists
  it; `STORED_ROADTRIP_VEHICLES` keeps it as a legacy value, so a roadtrip
  stored by rail loads with its label, and nothing rewrites it except the user
  or the conversion below.
- **Roadtrip conversion.** `GET/POST /rail/roadtrip-conversion/:routeId`
  and "Als Bahnfahrt übernehmen" on a roadtrip by rail (behind the rail gate).
  One leg is one ride, written through the rail write rules; the departure is
  noon on the boarding station's clock and says so, the arrival stays unknown
  (a day-only arrival would put a length nobody measured into the hours
  statistic — a deviation from the contract above, which had noon UTC and an
  arrival day). `externalRef = roadtrip:<section>:<leg>` makes it idempotent.
  The roadtrip goes only with `removeSection: true`, only when every leg
  converted, in the same transaction.
- **Spreadsheet import.** `services/xlsxImport/rail.ts` on the importer's
  rules (own id updates, foreign or missing id creates, natural key train
  number + departure day on the boarding clock + both stations, unchanged rows
  not written, unknown class/status dropped with a warning, real row numbers,
  `replace` prunes). The sheet now carries each station's position. The
  browser reads the sheet only where rail is visible.
- **Shared surfaces.** `GET /tags` counts rail tags, the rail form uses
  `TagInput` and `useTripPreselection`, and the rail detail page shows the
  trip's photos taken on board (`GET /rail/:id/trip-photos`).
