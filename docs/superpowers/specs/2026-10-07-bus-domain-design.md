# Bus — an eighth domain for long-distance coach rides

Date: 2026-10-07 · Branch: `docs/bus-domain-spec` · Status: **B1 built on `dev/bus-domain` (2026-10-07/08); B2 next**

## Why

Owner wish of 2026-10-03, after the Korea trip (board item `fj-180`, Forgejo
`dennis/TravStats` forgejo#180): bus becomes its **own domain**. Three rides
(Seoul–Sokcho, Sokcho–Seoul, Jeonju–Busan) exist today only as journal
entries of that trip — prose, not rows: no kilometres, no hours on board, no
terminal on the map, nothing the statistics or the passport can count.

The owner's two rulings, taken verbatim:

1. **Not inside the rail domain.** "Bewusst NICHT in die Bahn-Domäne
   gequetscht (Statistik, Haltestellen, Linie)" — a bus ride has its own
   statistics, its own stops and its own kind of line on the map. The
   alternative the board had floated (bus as a `vehicle` of the rail domain)
   is closed by this ruling.
2. **Not for city buses** (owner, 2026-10-07): the domain logs the
   long-distance coach, the intercity express, the airport or hotel shuttle —
   a ticketed ride between two named terminals. A tram, a metro and the 14
   bus to the office are not what this is for, and the form says so.

A coach ride has the shape of a train ride, not of a tour section: a dated,
point-to-point movement with an operator, a line, a seat and a price, boarded
at one terminal and left at another. That is why rail's spec is the template
here, concern by concern — and why, unlike rail and rental, this domain
copies as little code as it can get away with (§2).

### What the owner said, and what this spec assumes

| Said | Assumed (correct me in §12) |
|---|---|
| Own domain, beside rail | Own table, own router, own page, own colour, own beta key, own stats — the full domain contract of `shared/domains.ts` |
| Not city buses | One row = one ticketed ride between two terminals. No line network, no stop sequence, no timetable of a city. A ride may still be short (an airport shuttle). A guided coach tour is a tour, not a ride (§11b) |
| Korea rides are the first use | Worldwide from day one: terminals come from the geocoder, not from a European catalogue; no provider lookup is required to log a ride |
| — | Web first, the Companion follows (rail owner decision 5, rental §8) |
| — | Behind the beta switch until the owner takes it out, like rail and rental |
| — | No parser in the first packages: the repository holds **zero** bus booking mails (`test-samples/emails` has none), and the Korean tickets were app purchases with no mail at all |

## 1. Measured: what exists to build on

Rail (2026-09-25) and rental (2026-10-01) are the two domains built since the
registry settled, and their footprints are the size of this job:

| | Rail (phases 1–2b + merge) | Rental (R1–R5) |
|---|---|---|
| Source files named after the domain | ~190 (incl. tests) | ~65 |
| First package | 20 files, 1 640 lines (backend only) | 86 files, 5 437 lines (full stack) |
| Shared surfaces touched outside the domain's own files | ~80 | ~40 |

Of rail's ~190 files, most belong to things a coach ride does not have: a UIC
station catalogue with DB codes, a train-number lookup chain, Transitous trip
tracing, OpenRailRouting, reservations, connecting-train bookings, five DB
parser templates, a roadtrip conversion. Strip those and rail's **core** — the
row, its clock rules, the write path, the list page, the form — is what a bus
needs, nearly unchanged.

**The one new idea of this spec:** rail's clock and status helpers are
structurally typed. `shared/railClock.ts` reads `departureTime`,
`arrivalTime`, `depTimezone`, `arrTimezone`, `depPrecision`, `arrPrecision`
and nothing rail-specific; `tripDateBounds`, `flightEnds`, `rideStatusSpan`,
`withRailTimes` (`services/rail/timesDto.ts`), `railListSummary`,
`stationColumns`, `wallClockToInstant`, `instantToWallClock` and
`greatCircleKm` (`services/rail/railJourneyWrite.ts`) all read the same
column names. **A bus row that keeps those column names uses every one of
them as-is** — no copy, no rename, no third `timesDto.ts`. Rental could not do
this because a rental has a pick-up and a return, not a departure and an
arrival; a bus has exactly rail's two ends. The plan therefore spends its
lines on what is genuinely new (the statistics, the pages, the copy) and
imports the rest.

Three things were measured and found NOT usable without further work:

- **Transitous** (`services/rail/lookup/transitous.ts`) asks for
  `HIGHSPEED_RAIL, …, RAIL` only. MOTIS also knows `BUS` and `COACH`, and
  **it carries FlixBus — measured live on 2026-10-07**: `stoptimes` at
  "Berlin ZOB" (stop `al-ShowMeBus_station-191`, modes `COACH, SUBURBAN, BUS`)
  with `mode=COACH` answered 31 departures for the morning of 2026-10-08, all
  agency `FlixBus-eu` (260 → Budapest Népliget, N1329 → Oldenburg, 057 →
  Szczecin, 060 → Vienna Erdberg, 1381 → Gdynia, 032 → Malmö, …), and
  `trip` for the Budapest coach came back as ONE `COACH` leg with six
  intermediate stops and a 64 kB polyline — a real road shape, not chords.
  BlaBlaCar Bus stops are in the index too (`eu-blablacar-bus_BZO`). Without
  the mode filter the same stop lists BVG city buses (`BUS`, lines 143, M49,
  349) — the `COACH` filter is what keeps city transit out, which is the
  owner's rule in data form. FlixBus's own GTFS (`gtfs.gis.flix.tech/
  gtfs_generic_eu.zip`, 30 MB, publisher FlixMobility Tech GmbH, valid
  2026-10-04 → 2027-04-04, agencies `FLIXBUS-eu` and `FLIXTRAIN-eu`) has
  2 126 stop rows (some are "Pre Waypoint" routing helpers, not terminals),
  a `stop_timezone` per stop and a 147 MB `shapes.txt`; its `feed_info` names
  no licence. Korea has no open intercity feed (Kobus, BusTago and T-money are
  apps; data.go.kr's terminal APIs need a Korean key and are not planned). So
  the lookup and the traced line are **feasible for Europe through the client
  rail already has**, and are package B3; nothing in B1–B2 depends on them.
- **Road routing** (`services/tour/routing/`) exists with three providers
  (OpenRouteService, GraphHopper, a self-hosted OSRM) behind
  `resolveRouteProvider()`, and `routeLegGeometry()` answers a `road` leg
  with a line, a distance and a named failure (`ROUTE_FALLBACK_REASONS`). A
  coach drives roads, so this is the bus line on the map — package B3,
  frozen once like rail's Transitous trace, and labelled `road`: a line routed
  over the road network may not be the road the bus took.
- **No tour leg mode `bus`** (`LEG_MODES` = road, ferry, rail, foot, bike) and
  no roadtrip vehicle `bus`. Nothing has to be taken out of another domain,
  and no legacy rows need a conversion offer — the one piece of rail's story
  this domain is spared.

## 2. Principles

1. **Copy the contract, import the mechanism.** The API shape, the beta
   gate, the counting rule and the page follow rail; the clock, status and
   trip-bound rules are the SAME functions, reached by the same column names.
   A helper that would have to be copied because its name says "rail" gets a
   one-line generic alias in the same file, not a second implementation.
2. **Abstention is a result** (CLAUDE.md). No arrival → no duration. No
   recorded delay → null, never 0. A terminal the geocoder cannot place →
   refused, not stored at 0/0 and not read as UTC.
3. **A failure reaches the user as itself.** The geocoder down, a stop off
   the road network, a routing provider's 429 — each has a reason code the UI
   words in DE and EN (`services/tour/routing/types.ts` already names them).
4. **One counting rule, one home**: `shared/busCounting.ts`, mirrored, the
   sibling of `railCounting.ts`. Statistics, cross-domain overview and the
   evidence panel all ask it.
5. **Every behaviour change ships with a test that fails without it**; every
   silent-failure class (picker subset, choice without its data, provider
   failure as success, re-derivation destroying data) gets a failure-path test.
6. **The web build is drawn for iPads**; touch sizes follow the pointer.

## 3. Data model

### 3.1 `BusJourney` (`bus_journeys`) — one row per coach ride

One row is one vehicle boarded at one terminal and left at another. A
connection with a change of coach is two rows bound by the existing `Booking`
(as rail's connections are); the UI for that is B3, the column is B1.

| Column | Type | Notes |
|---|---|---|
| `operator` | text? | "FlixBus", "Kobus", "Kumho Express", "Lux Express". Free text with entry suggestions from the user's own earlier rows; no catalogue. |
| `lineName` | text? | What the ticket calls the service: "N17", "Linie 004", "Premium". Kept apart from the operator because the statistics rank operators, not lines. |
| `rideKind` | text? | `intercity` \| `shuttle` \| `other`. The split a reader cares about (a 2 h 20 coach vs a 15 min airport shuttle); null when unstated. No `charter`: a chartered coach is the vehicle of a guided tour, not a ride (§11b). The form copy names what the domain is NOT for (city transit, excursions). §13 D1. |
| `depStationName`, `arrStationName` | text | Required. **Rail's column names on purpose** (§1): a bus terminal is a station in the generic sense, and this is what lets the shared clock helpers read a bus row. |
| `depAddress`, `arrAddress` | text? | As printed — coach stops are often an address ("ZOB Berlin, Masurenallee 4–6"), not a named building. |
| `depLat/depLon`, `arrLat/arrLon` | float | **Required**, as on `RailJourney`: a terminal without a position has no zone, no country and no map point. |
| `depCountry`, `arrCountry` | text? | ISO 3166-1 alpha-2 from the geocoder; null when unknown, never guessed. |
| `depTimezone`, `arrTimezone` | text? | IANA zone, derived on the server from the coordinates (`zoneOf`, coordinates only — there is no catalogue zone). Never user input. |
| `departureTime` | timestamptz | A real UTC instant. The client sends the terminal's wall clock (`departureLocal`, `YYYY-MM-DDTHH:mm` or a day) and the server converts it in the terminal's zone — rail's rule, rail's code. |
| `arrivalTime` | timestamptz? | May be unknown. Must not precede the departure, checked on the INSTANTS after both zones are known. |
| `depPrecision`, `arrPrecision` | text | `minute` \| `day` \| `unknown` (ADR 0002). A day-only ride is stored at the start of its day with precision `day`, and every clock reader abstains on it (`shared/railClock.ts`). |
| `actualDepartureTime`, `actualArrivalTime` | timestamptz? | What happened, when known. Null for a past ride nobody recorded. |
| `delayMinutes` | int? | Arrival delay as experienced. Null = not recorded, 0 = on time. Never collapsed. |
| `distanceKm` | float? | See §5. |
| `distanceSource` | text? | `great_circle` \| `user` \| `route` (along the routed road line) \| null. |
| `geometry` | jsonb? | `[[lon, lat], …]`, fetched once (B3) and frozen. Null = the chord. |
| `geometrySource` | text | `straight` \| `road` \| `manual`; default `straight`. B1 writes only `straight`. |
| `fareClass` | text? | Free text, max 40: Korean express buses sell 일반 / 우등 / 프리미엄, Lux Express sells "Lounge"; FlixBus sells none. Not an enum — the vocabulary is the operator's. |
| `seat` | text? | "12A". |
| `bookingReference` | text? | Order or ticket number. |
| `price`, `currency` + the five FX columns | | As `RailJourney`; the snapshot dated by the departure. |
| `status` | text | `scheduled` \| `in_progress` \| `completed` \| `cancelled` — rail's vocabulary, a cache of `deriveRailStatus` (aliased `deriveBusStatus`), only `cancelled` client-settable; converged by the hourly sweep. |
| `notes`, `tags`, `companions` | | As rail; `BusJourneyCompanion` join, dual write. |
| `tripId`, `bookingId` | uuid? | SetNull, ownership-checked (`assertReferencesOwned`). |
| `externalRef`, `importBatchId` | | `@@unique([userId, externalRef])`; reserved for the spreadsheet import (B2) and a parser (B4). |

Indexes as rail: `(userId, departureTime)`, `status`, `tripId`, `bookingId`,
`importBatchId`. `Document.busJourneyId` joins the one-owner CHECK
(`num_nonnulls(...) <= 1`, now eight owners), so a ticket PDF can be filed
with its ride before any parser exists. `Companion` gains `bus BusJourney[]`
and the usage count in `routes/companions.ts` adds it.

**Not stored, on purpose:** a stop sequence (the ride is terminal to
terminal; intermediate stops are a timetable's business), a vehicle plate, the
driver, a platform/bay (notes, if anyone cares), a loyalty programme
(`LOYALTY_DOMAINS` unchanged — no coach operator the owner uses runs one;
§13 D6 if that changes).

### 3.2 Terminal resolution — no catalogue

There is no worldwide open catalogue of coach terminals, and the first use is
Korea. Resolution, each step falling through on a miss:

1. **The user's own earlier terminals and operators** — entry suggestions
   from past rows (rail's `GET /rail/entry-suggestions` idiom, offered as
   chips, never written): the second Seoul ride offers "Seoul Express Bus
   Terminal" with its position and address, and "Kobus" as the operator.
   Alex asked for exactly this list on rentals (forgejo#196); here it is in
   B1, because without it every terminal is typed twice.
2. **The geocoder** the lodging and rail forms use (`LocationInput`, Photon):
   a search hit brings name, position and country; the name stays editable
   afterwards ("Dong Seoul Bus Terminal" rather than what OSM calls it).
3. **Nothing resolves** → the form will not submit (`isStationComplete`
   false), and the API refuses a station without `lat`/`lon` with
   `BUS_INVALID_INPUT` naming the field. Never the user's home, never the
   trip's first airport.

Later, if useful (B3, §13 D3): airports (airport shuttles) and the rail
catalogue (a coach station at a railway station) as further picker sources.
Rail's catalogue already carries 21 000 Swiss bus stops it cannot tell apart
from stations — a bus picker that read it would surface them; this spec does
not, for now.

## 4. Times, status, counting

**Times** are rail's rule and rail's code: the form asks for the wall clock at
the terminal as the ticket prints it; the server converts with the terminal's
zone, refuses a wall clock in a spring-forward gap (`LOCAL_TIME_NONEXISTENT`,
`shared/wallClockExistence.ts`), accepts a fold choice for the repeated autumn
hour, and stores a real instant plus the zone. A day-only ride is allowed
("Fahrkarte ohne Uhrzeit", forgejo#132 item 17 applied to coaches, where an
open ticket is common). The DTO adds `times` through `withRailTimes`,
registered a second time under the OpenAPI name `BusTimes` (same shape).

**Status** is derived: `scheduled` until departure, `in_progress` on board,
`completed` once the ride is over (`rideEndsAt` — a clockless end is over
when its DAY is), `cancelled` only by the client. The hourly sweep gets a bus
block identical to rail's.

**Counting** (`shared/busCounting.ts`, mirrored): completed rides only; a
ride is filed under the year it LEFT on the departure terminal's calendar;
it is active on the arrival terminal's day too; it proves both terminals'
countries when known. The same truth table as rail's, tested on both mirrors.

## 5. Geometry and distance

Three sources, and the map always says which it shows:

1. **Straight line** — the whole of B1 and B2. `geometry = null`,
   `geometrySource = straight`, `distanceKm` = great circle,
   `distanceSource = great_circle`, recomputed when a terminal moves. The
   statistics label it "Luftlinie" / "straight line" (rail owner decision 7).
2. **Road** (B3) — `routeLegGeometry()` with mode `road` through the
   instance's routing provider, fetched **once** when the ride is saved and
   frozen; its length becomes `distanceKm` with `distanceSource = route`. A
   failure stores `straight` and the save answers `meta.geometry {outcome,
   geometrySource, fallback}` with the provider's reason
   (`no_provider | provider_error | no_route | point_not_near_road |
   rate_limited | auth | untrustworthy`), which the form words. An instance
   without a routing provider keeps the chord and says so once in the form.
   An edit re-fetches only when a terminal's coordinates changed, and a
   re-fetch that fails keeps the stored line (rail review finding 1).
3. **Manual** — reserved for a line a later editor draws; no UI planned.

A user-typed distance from the ticket (`user`) is kept until cleared,
whichever line exists. Great-circle understates a road by 10–40 % (a coach
follows valleys and motorways); the statistics show kilometres **per
source**, never one undifferentiated number.

## 6. Statistics (B2)

`GET /bus/stats`, a bus tab on the statistics page, built on
`busCounting`: rides, kilometres per source, hours on board (rides with both
clocks only, sample size shown), countries touched, operators ranked, ride
kinds, top terminals, the longest ride, rides per year, delay distribution
over rides with a recorded delay. The cross-domain overview and the evidence
population (`crossDomainPopulations.loadBus`) count rides and countries like
rail's loader does — a coach across a border is evidence of the country as a
train is (§13 D4). Passport provenance (`metricEvidencePassport`) lists it.

Rail's `railStats.ts` / `RailStatsSection.tsx` / `railStatsAdapter.ts` are
the templates, minus train categories and plus ride kinds.

## 7. Map and colour

- **Colour:** a new token `domainColor.bus` in `design/tokens.json`,
  generated into `--ts-domain-bus` and mirrored in both `DOMAINS.bus.color`.
  **Provisional**, as rental's: the domain colour table belongs to the
  Companion / Claude Design. Candidate: sandstone `#c49a6c` — an earth tone
  beside the road moss, which reads as "road" without being it. It clears the
  status-colour test (`domainColorsNotStatus.test.ts`: ≥ 40 RGB from `info`,
  `warn`, `bad`): 64 from `warn`, 78 from `bad`, 136 from `info`, and 59 from
  the flight amber, 50 from the road moss. §13 D7.
- **Icon:** 🚌. **Route prefix:** `/bus`. **API:** `/api/v1/bus`, enveloped
  family (ADR 0001), a new line in `apiResponseShape.baseline.json`.
- **Layer (B2):** one module (`busPathsLayer.ts`, from `railPathsLayer.ts`)
  for the bus dashboard tab and the "Alle" chip: the frozen road line where
  there is one, else the chord drawn lighter; colour from the domain colour
  store; legend rows name only the kinds of line drawn. A single-domain
  `/dashboard/bus` tab (globe and flat), a row in the six-row domain filter.

## 8. Trip, timeline, Companion, export (B2)

- **Trip status** lands in **B1** already (the write path calls
  `recomputeTripStatus`; `tripStatusService.ts` gets `busJourneys` in its select
  and spreads `rideStatusSpan` over them — the rail line, one more array). A ride
  re-derives its trip's status; it fills the trip's dates only when the trip has
  none, as rail does (`fillTripDatesFromSegments`) — it does not widen dates
  that are already set.
- **Timeline and logistics tab:** `lib/timelineRail.ts` → a bus twin; trip
  detail select (`TRIP_BUS_SELECT`), `TripCard` counts, attachable entries,
  trip suggestions' `loadTransport`, trip photo windows, the trip delete
  confirm's "what goes with it" list.
- **Upcoming / next-up:** `routes/upcoming.ts` gains `nextBus`; e-mail
  reminders (`railReminders.ts` twin) are B3.
- **Companion:** sync entity `bus_journey` (`services/sync/entities.ts`,
  `guardedRoutes.ts`, omit `geometry`, visible `inDomain("bus")`), so the
  phone reads rides as soon as it wants to. Web first; the owner opens the
  Companion issue.
- **Export/backup:** a "Bus rides" sheet in the Excel export with each
  terminal's position and the distance with its source; the spreadsheet
  importer's bus spec on the importer's rules (own id updates, natural key
  operator + departure day on the boarding clock + both terminals); the JSON
  all-data export (`busJourneys` with companion links); `diagnosticExport`.
- **Demo seed:** three rides modelled on the Korea trip's shape (synthetic
  values, not the owner's), through the router's wall-clock conversion.

## 9. Lookup and line tracing (B3)

A chain like rail's, **optional** in every sense — a ride is logged in full
without it:

1. **Transitous** `stoptimes` at the boarding terminal with mode `COACH`
   (not `BUS` — that is the city network, §1), matched by operator + line
   label; a match brings the trip's polyline (cut to the two terminals,
   frozen) as rail does. **Measured 2026-10-07 (§1): works for FlixBus at
   Berlin ZOB, with a real road shape.** Same terms as rail (User-Agent with
   contact, caching, non-commercial), same provider switch in the admin
   settings, same six-hour cache, same "a past day rarely finds anything"
   notice — the feed window is about six months. Unmeasured: coverage outside
   the FlixBus/BlaBlaCar networks, and whether a coach's `stoptimes` row names
   the line the ticket prints (the Budapest coach is "FlixBus 260").
2. **Road routing** (§5) — the fallback line for every ride, the only line
   outside Europe.
3. **Manual entry** — always.

No provider answers a past day's timetable or any past actuals; a delay is
typed or null (rail's "honest limits" hold verbatim).

## 10. Parser (B4 — only with a corpus)

Not before a real corpus exists. `test-samples/emails` holds no coach
booking; the Korean rides had none. When the owner adds FlixBus (or other)
confirmations to a gitignored `test-samples/Bus/` with an `expectations.json`
(rental R2's shape), B4 adds `bus` to `PARSER_SUPPORTED_DOMAINS`, to the
template envelope's `TemplateDomain` (parser design §5.1, in
`Abrechen2/travstats-templates` — new layouts go through the template repo,
owner 2026-10-03), a FlixBus template, the LLM fallback with the value check,
and a review modal (`RailImportPreviewModal` twin). Until then the import hub
shows no bus adapter, and a bus document uploaded to the hub is filed, not
parsed.

## 11. Gating

```ts
busDomain: Object.freeze({
  why: "Long-distance coach rides are a new domain (spec 2026-10-07-bus-domain-design), built in packages; the Companion app does not handle them yet and no release candidate has carried them.",
  returnsWhen: "The owner explicitly takes bus out of beta. Packages being done is not that event.",
  reason: "beta",
}),
```

Two conditions, as rail and rental: the instance flag (`busDomain`) and the
user's `enabledDomains`. `useBusVisible` / `useBusOffered` are the rule's one
home (nav, logbook tabs, colour settings, route guard, trip card, attachable
domains, dashboard filter); the setup picker and the module toggle offer bus
on the flag alone. The backend endpoints stay reachable — a visibility gate,
not a boundary. `DOMAINS.bus.available = true`, so shared code iterating
`AVAILABLE_DOMAINS` sees it; where a `Record<DomainKey, …>` would draw
something B1 cannot yet fill (the cross-domain loader, the dashboard tab
registry, the stats adapter), bus is wired to an explicit empty answer with a
pointer to the package that fills it — the compiler lists every such site.

### Relations deliberately NOT built

- **Tours and roadtrips:** no `bus` leg mode, no `bus` roadtrip vehicle. A
  coach ride is a ticket, not a route; a roadtrip is driven. Nothing to
  convert.
- **Journal entries → rides:** the three Korea entries are retyped by hand
  (three rides). A "make a ride from this entry" offer would parse prose;
  not worth a feature for three rows.
- **Flights operated by bus** (board item `surface-segments-as-flights`:
  Lufthansa Express Bus, equipment code BUS): once this domain exists, the
  proposal "offer such a segment as a bus ride" becomes buildable. Out of
  scope here; the board item stays open and gains a pointer to this spec.

## 11a. Alex's feedback on rail and rental, applied here

Alex tested rail and rental on the RC between 2026-09-20 and 2026-10-05; the
board carries his points as forgejo#184–#209, companion#56 and the Beta-13
list. Every one that is about a domain's SHAPE rather than a single defect is
a rule this domain starts with, instead of learning it again:

| Alex said (where) | Bus does |
|---|---|
| Rail and rental lists in the shared logbook layout, same header (forgejo#197) | The bus page is the shared layout from day one: title + add button, summary strip, filter bar, server-paged table, measured column widths (236 px time, 112 px duration/distance — the fix for the wrapping he found on flights, forgejo#185), rows-per-page above AND below (Beta-13) |
| Operator logos for rail (forgejo#197) | The leading mark is `OperatorTile`'s monogram on the domain colour. No logo source is chosen — that is the open owner question the tile's comment records; when it is decided, bus gets it with rail |
| A ride with changes is ONE list entry, three levels (forgejo#187) | A coach connection (B3) is one entry through `Booking`, rail's `/connections` idiom; B1 already stores `bookingId` so no row moves later. The Companion keeps flat rides (companion#56) — the sync entity (B2) is per ride |
| Rental: plate, provider list, logos (forgejo#196) | Operator and terminal suggestions from the user's own rows in B1 (§3.2). No plate: a coach's registration is nobody's record of a ride |
| Dashboard map settings per domain; rental shows stations only (forgejo#198) | B2 adds a `bus` section to the map's appearance panel with a line toggle (rental's `RentalLineToggle` shape). Unlike a rental, a ride IS a route, so the default is the line (D5) |
| Web settings (colours, map, domain filter) lived only in the browser (forgejo#200) | Bus's colour and its filter row ride on `app_prefs` (merged `feat/web-prefs-sync`); B2's filter row must be added to that synced shape, not to `localStorage` |
| Assign existing entries from the trip editor (forgejo#188) | Bus rides are attachable from B1 (`attachableEntries` loader) |
| Switching the map mode on "Alle" did not carry to the other tabs (Beta-13) | Inherited: the bus tab (B2) is registered in `TAB_MODE_REGISTRY` like rail's, so the fix applies |
| His new DB ticket layout needed a release (parser templates item) | B4 ships a FlixBus template through `travstats-templates`, never as TypeScript in a release |
| Dialogs closed when a text selection ended outside (forgejo#184) | Inherited: the bus form uses the shared `Modal`/`Dialog` |
| bahn.de share links blocked server-side (forgejo#204) | Not attempted for FlixBus; there is no share-link API to try |

## 11b. Not a bus ride: the guided coach tour

The owner's Korea itinerary (day 3, 06.10.2026) reads: pick-up at the hotel
lobby by a shared transfer, a join-in DMZ tour with a guide in a coach of
30–40 people (Freedom Bridge, 3rd Infiltration Tunnel, Imjingak Park, Dora
Observatory), back to Seoul by bus, out at City Hall Station. A GetYourGuide
day, in other words — and the thing to settle before B1 is that **it is not a
bus ride**. It has no ticket between two terminals, no line, no operator the
rider chose; the coach is how the tour moves, the way a ferry is how a hiking
tour reaches the island. What the owner would want to count from that day is
the tour (the places, the hours, the route on the map, the guide's company),
not a kilometre figure under "Bus".

What the repository has for it today, measured:

- **Day tours** (`TripRoute`, `kind = tour`, spec 2026-09-24) are one domain
  with one colour; the activity picks the icon. `TOUR_ACTIVITIES` is `hike,
  walk, run, bike, mtb, ski, paddle, climb, other` — nothing for a guided
  excursion, so today this day is `other`. Leg modes are `road, ferry, rail,
  foot, bike`; `road` routes a coach's way over the road network exactly as
  it routes a car's.
- **Cruise excursions** (`CruiseExcursion`, spec 2026-08-16 §4.5) are the same
  idea bound to a port call: title, notes, a place, deliberately no price,
  provider or duration. There is no trip-level twin.
- **Trip import** (spec 2026-08-21) lists "day programs" as a non-goal: an
  itinerary line like this one lands in `rejectedRows`, shown and not
  imported.

**Decision for the owner (D10):** where a guided coach tour is recorded.
Recommendation: as a **day tour with a new activity `excursion`** ("Geführter
Ausflug" / "Guided tour", icon 🚌 when the vehicle is a coach), legs by `road`
from the pick-up to the sites to the drop-off, the operator/guide in the
tour's `vehicleName`-style free text. That is one activity value, one icon
and two i18n strings — no table, no domain, and the tour statistics, map and
trip timeline already know what to do with it. The alternatives cost more and
say less: a bus ride with a `charter` kind would count the DMZ coach beside a
FlixBus to Prague, and a trip-level excursion entity would be `CruiseExcursion`
a second time. Reading such itineraries into tour proposals is a trip-import
follow-up (the one its spec declined), not a bus package. The bus form's copy
says this in one line: "Kein Stadtverkehr, kein Ausflug — eine Fahrt ist ein
Ticket zwischen zwei Terminals."

Two rental points do not transfer: the invoice-kilometre rule (forgejo#206)
has no counterpart (a coach ride's distance is the route's, §5), and the
"single point or a dashed line" question he was asked about rentals is
answered for buses by D5 — a ride has two ends and a road between them.

## 12. Packages, order, and how each is measured

| # | Package | Measured by |
|---|---|---|
| **B1** | Model + migration (`BusJourney`, companion join, `Document.busJourneyId` + CHECK), Zod, CRUD router with list paging, OpenAPI with response schemas, ratchet family, registries (both mirrors), beta key, colour token, status derivation alias + sweep, counting rule (both mirrors), FX snapshot, companions, trip link **and trip status** (the write path already re-derives the trip, one more array in `tripStatusService`; a ride fills the trip's dates only when it has none, as rail does), entry suggestions (own operators and terminals, as chips), list page in the shared logbook layout + create/edit/delete form + simple detail page with documents, DE/EN — **manual entry only**, straight line only, every other shared surface wired to an explicit empty answer | route tests incl. a time-model suite (DST gap refused, far-off zones, arrival before departure refused, day-only ride stored at precision `day`), ownership tests (another user's trip/booking refused), counting truth table on both mirrors, OpenAPI coverage + response-schema + time-shape guards, response-shape ratchet, locale parity, `check:drift`, odd-zone CI runs, the colour test, the beta-registry test, a browser look at the form on an iPad viewport |
| **B2** | Trip timeline/logistics/card/attachable/suggestions/photo windows; dashboard tab + map layer + "Alle" chip + filter row; `/bus/stats` + stats tab + cross-domain + evidence + passport provenance; upcoming; sync entity; Excel sheet + importer spec + JSON export + diagnostic export; demo seed | trip-status tests (a ride re-derives its trip's status), timeline tests, stats tests with the sample-size rule, cross-domain population test, sync feed test (visible/omit), export round trip, a production-build browser look at both maps with the colour store changed |
| **B3** | Transitous `COACH` lookup + traced line (measured, §1) through rail's client with a mode parameter; road line via the routing provider as the fallback, frozen, labelled, with reasons; connecting-coach UI through `Booking` as ONE list entry (Alex, forgejo#187); e-mail reminders; optional airport picker source | lookup tests against recorded Transitous answers (a `COACH` match, a `BUS`-only stop answering "no coach here", a past day), geometry tests per fallback reason (each named, none silent), edit-keeps-line test, reminder tests |
| **B4** | Parser (template + LLM fallback + review modal) **once `test-samples/Bus/` exists**; achievements and Wrapped (2.8, as rail) | the corpus harness with `expectations.json`; 0 candidates from non-bus mails |

B1 is one branch (`dev/bus-domain`), merged on the owner's release decision;
B2 the next. Each package's plan is written when the one before it has landed.

## 13. Open decisions for the owner

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Ride kind | (a) none — operator only; (b) `intercity \| shuttle \| other`, optional; (c) a longer list (night coach, sightseeing, …) | **(b)** — one optional column, the one split a statistic reader asks for; (c) is a list nobody will fill, and "sightseeing" is a tour (D10) |
| D2 | Day-only rides allowed? | (a) yes, as rail (precision `day`, clock readers abstain); (b) a clock is required | **(a)** — open tickets are common on coaches; the abstention rules already exist |
| D3 | Terminal picker sources beyond the geocoder | (a) own past terminals + geocoder only; (b) also airports (shuttles); (c) also the rail catalogue | **(a)** in B1, **(b)** in B3 if a shuttle ride turns up; (c) not until the catalogue can tell a bus stop from a station |
| D4 | Do a ride's countries count in the cross-domain overview and the passport? | (a) yes, both terminals' countries, as rail; (b) only in bus stats | **(a)** — a coach across a border is the same evidence a train is |
| D5 | Map line before routing exists | (a) chord drawn lighter, labelled straight; (b) two points only | **(a)** — two pins read as two rides (rental D1 reasoning) |
| D6 | Loyalty | (a) no bus loyalty domain; (b) add `bus` to `LOYALTY_DOMAINS` (a DB CHECK migration) | **(a)** — none of the operators in sight runs a programme; one migration when one does |
| D7 | Colour | sandstone `#c49a6c`, provisional | decide with Design / the Companion; must keep clearing the status-colour test |
| D8 | Routing profile for the road line (B3) | (a) the car profile; (b) the heavy-vehicle profile where a provider has one (ORS `driving-hgv`, GraphHopper `truck`) | **(a)** — a coach is not a lorry on most roads a provider restricts for HGVs, and (b) would route around low bridges the coach took; the label `road` says it is a routed line either way |
| D9 | Shall B1 already carry the sync entity so the Companion can read rides early? | (a) B2, with the rest of the shared surfaces; (b) B1 | **(a)** — the Companion has no bus screen; an entity nobody reads is a contract to keep for nothing |
| D10 | Where does a guided coach tour (DMZ day, GetYourGuide) live? (§11b) | (a) a day tour with a new activity `excursion`; (b) a bus ride with a `charter` kind; (c) a trip-level excursion entity like `CruiseExcursion` | **(a)** — one activity value and an icon; the bus logbook stays tickets between terminals. If (a), it is a small tour-domain change outside the bus packages, done before B1 so the two forms' copy can point at each other |

## B1 — as built (2026-10-08)

B1 landed on `dev/bus-domain` as written in §12, with the rulings and deviations
below. Each was decided while building, with the reason; none reopens a §13
decision. D1 (`rideKind`), D2 (day-only), D5 (the chord, stored in B1 and drawn in
B2), D6 (no loyalty), D7 (colour) and D9 (sync in B2) stand as recommended.

**Rulings and deviations**

- **Trip dates.** §8 and §12 said a ride widens its trip's dates. It does not, and
  rail never did: the write path re-derives the trip's **status**
  (`tripStatusService` spreads `rideStatusSpan` over `busJourneys`) and fills the
  trip's dates **only when the trip has none** (`fillTripDatesFromSegments`). The
  affected sentences in §8 and §12 are corrected.
- **`rideKind` has no `charter`.** The column carries `intercity | shuttle |
  other`; the guided coach tour went to the tour domain (D10, branch
  `feat/tour-activity-excursion`, built first, not merged). The brief expected an
  activity block in `trips.json`; there is none — the labels live in
  `roadtrips.json`, and the implementer's placement stands.
- **Bus counting is its own module, not an alias of rail's.** `shared/busCounting.ts`
  (and its frontend mirror) duplicates rail's rule on purpose — the plan mandated it
  and §4 says "own small module" — so that the two domains can rule independently.
  It is deliberate, not accidental duplication; the status derivation, by contrast,
  is a one-line alias of rail's.
- **One home for the ride-generic end rules.** `services/rides/rideEnds.ts` holds
  "resolve the end", "the arrival is not before the departure" and "typed distance
  or the measured line", parameterised by the refusal code; rail and bus both import
  it, while `pickStation` / `pickTerminal` stay per domain (§2 principle 1). The
  first bus draft had copied rail's three private functions. The move changed two
  things in rail, both reviewed and accepted: a moved end whose zone cannot be
  resolved is refused (`TZ_UNRESOLVED`) instead of falling back to UTC, and a typed
  distance of 0 km is kept rather than replaced by the measured one. The `stop`
  wording in the `TzUnresolved` message is the same in both.
- **Two small edits to shared code,** allowed under the same principle:
  `sentWallClockToInstant` is exported from `services/rail/railJourneyWrite.ts` (it
  was module-private), and the `ApiErrorCode` union in `middleware/errorHandler.ts`
  gained the bus codes (`BUS_INVALID_INPUT`, `BUS_ARRIVAL_BEFORE_DEPARTURE`).
- **`TZ_UNRESOLVED` guards the write path, not a reachable input.** `geo-tz` answers
  every point on the globe, so the test fixture is latitude 91 (refused first by the
  coordinate schema); the guard exists so a wall clock can never be stored as UTC if
  the lookup is ever replaced.
- **`rateLimit.ts` split.** The bus creation limiter pushed the file over the size
  ratchet; the skip predicate moved, unchanged and re-exported, to
  `middleware/globalRateLimitSkip.ts`.
- **Registry edits the compiler forced.** `ENTRY_LIST_PATHS` (the route and the
  OpenAPI one) gained `busJourney` because their `Record` demanded it;
  `openapi/paths/misc.ts` was deliberately left alone — its enum is the `/upcoming`
  domain list, which gains `bus` in B2 with the upcoming entry. `tokenName` was added
  to backend `domains.test.ts` (the test's own `Record`). Task 1 left `tsc` red in
  both trees by design until the sites were wired in Task 7.
- **Entry suggestions** search **both** station columns (a typed name offers the
  outbound arrival when entering the ride home), and the `LIKE` wildcards in the
  typed text are escaped — the first escape in the codebase; `places/suggestions`
  still passes raw `contains` (follow-up outside this work). The form shows one mixed
  chip row per terminal field (`BusTerminalChips.tsx`, with its own narrowing — beyond
  the brief, stands); the limiter's comment promises a debounce the form must deliver.
- **PATCH and FX.** The PATCH handler mirrors `routes/rail.ts` for the FX snapshot
  rather than a sketch in the plan.
- **Attachable entries.** `ATTACHABLE_DOMAINS` excluded bus (a stub loader that throws
  loudly) until the frontend API existed; the loader was filled in with it.
- **Locale details.** The DE quotes in the beta note are closed with “ (the brief's
  ASCII quote was invalid JSON); the EN kind list has three labels (the brief listed
  a stale "Charter"); `bus.json` carries extra keys beyond the brief (114 of 114,
  DE and EN in parity); `filters.domainBus` had been added twice in the achievements
  files and was de-duplicated.
- **The day-only toggle** is built from the server contract. Rail's form has none and
  opens a stored day-precision ride as a midnight clock, saving it back as a clock
  (`railFormModel.ts`) — a follow-up for rail (a Forgejo issue to open after B1). In
  the bus form the toggle applies to both ends, and un-ticking it yields `T00:00`
  rather than the earlier clock. `depValid` starts true, as in rail; a reviewer's
  suggestion to start it false was judged wrong.
- **Form save.** `onSaved` runs outside the `try` with a `saved` flag, so a parent
  refetch that fails is not read as "save failed" (a retry would duplicate the ride);
  a refusal stays on screen until the next edit.
- **Year options** come from one bounded list request (`limit: 500`); a years endpoint
  belongs to B2 with the statistics. The pages load the `rail` namespace for
  `formatRailDuration` (`rail:detail.durationHm`) — accepted; moving the string to
  `common` is a follow-up.
- **Documents.** `/bus/:id/documents` is served by the documents router;
  `Document.busJourneyId` is in the `OWNER_COLUMN` map, the CHECK and the
  `lib/api/documents.ts` entry list (necessary there, so it stands).
- **The all-data export carries the rides** (`busJourneys` with companion links); the
  schema-coverage test caught the omission in the full run (its test sits below the
  new "carries the bus rides" test, as the comment says). The Excel sheet and importer
  stay B2.
- **`times.*.local` carries seconds** (`2026-09-20T09:00:00`), as the shared clock
  emits and rail asserts; the web fixtures use that form and the real `TimeValue`
  member names.
- **The What's New 2.7.0 line** ("Fernbusfahrten als eigener Bereich" / "coach rides as
  a domain of their own") was forced by the beta-key test, on the rental precedent;
  the wording is the implementer's and the owner may reword it. The admin copy for
  `busDomain` and the `"#c49a6c bus"` exclusion in `listColor._excluded` went in with
  the final task.

**Gates (measured 2026-10-08 on the branch; tsc and lint re-run on the final HEAD)**

- Backend Jest, under coverage: 952 of 955 suites passed (3 skipped), 8472 of 8494
  tests (22 skipped), no failure, no deadlock. Frontend Vitest: 899 files, 6997 tests;
  a plain run and a `--testTimeout=30000` run each had one or two timing failures that
  pass alone (`CruiseEditModal.suggestions`, `StayEditor.tripPreselection`,
  `SettingsPage.adminScope`) — not bus code.
- `npx tsc --noEmit` and `npm run lint` exit 0 in `backend` and in `frontend`
  (`eslint src`; `eslint . --max-warnings 0`). `prettier --check .`, `check:size` (13
  baselined files, none grown) and `check:drift` were green in the controller's run
  before the two documentation and baseline commits.
- Coverage, against the baseline of 2026-09-16 (forgejo#62): frontend lines 56.21 to
  74.05 %, statements 55.66 to 73.00 %, functions 52.19 to 70.07 %, branches 51.19
  to 68.95 %; backend lines 76.35 to 87.90 %, statements 75.14 to 86.34 %, functions
  76.63 to 89.50 %, branches 61.82 to 72.93 %. The baseline was tightened to these
  figures (commit `3f06e766c`, whose body says the rise is mostly not bus). **Provenance:**
  the frontend figure was measured with `--coverage.reportOnFailure=true
  --testTimeout=30000`, because vitest writes no summary when any test fails; that
  run had one flaky failure (`CruiseEditModal.suggestions`, passes alone), which can
  only lower the figure. **The size of the rise is an inference:** the baseline dates
  from 2026-09-16 and `main` has since gained rail, rental, parser and time-model
  tests; bus alone cannot plausibly add 11 to 18 points. CI confirms the figure on this
  branch's first run; if CI's merged backend figure is lower, the baseline is set to
  CI's figure before merge.
- Odd zones: the bus and shared-ride suites (backend: route, entry suggestions, trip
  status, write service, `rideEnds`, counting — 6 suites, 56 tests; frontend: counting,
  form model and modal, both pages — 5 files, 53 tests) give the same verdict under
  `Pacific/Kiritimati` and `America/St_Johns` as in the default zone; so do the rail
  suites that share `rideEnds` (44 passed, 1 skipped; 357 tests).

**Browser look (headless Chromium, production build, admin account with the beta
switch on and `bus` enabled, German UI).** The form, the list at 1024 × 1366 portrait,
the detail page and the gate were taken at the specified iPad portrait viewport; the
duration and distance cells of the list row were read at **1366 × 1024 landscape**,
because at 1024 px the shared Table hides them. The form (typed coordinates
`37.5048, 127.0046` and `38.1911, 128.5918` into the terminal searches, names typed
as on the ticket, 2026-09-20 09:00 to 11:20, 23000 KRW) saved with the toast
"Busfahrt gespeichert". The list row shows the operator's monogram tile "KO" (the name
"Kobus" is the tile's title text; the detail page shows "Kobus" as text), "Seoul
Express Bus Terminal → Sokcho Express Bus Terminal", "20.09.2026, 09:00 – 11:20" and
the pill "Gefahren". At 1366 px the row also reads "2 h 20 min" and "159 km
Luftlinie". The detail page (`/bus/:id`) shows "Abfahrt · Asia/Seoul 09:00", "Ankunft
· Asia/Seoul 11:20", "2 h 20 min", "159 km Luftlinie", "23.000 ₩", the status pill
and the empty documents section. With the beta switch off, `/bus` redirected to
`/dashboard` and the Bus tab left the logbook strip. The only 5xx seen were
airline-logo requests on the flights page (no network in the sandbox), unrelated. Not
looked at: a phone width (not a target), the map (B2), and a real geocoder search
(offline; coordinates typed). **For the owner:** at 1024 px the shared Table hides
duration, distance and trip ("3 columns hidden", with a note under the table). That is
not bus code, but it touches the "web build is drawn for iPads" rule and decides what
an iPad portrait sees in every logbook.

**Deferred minors (from the task reviews, none blocking):**

- Task 0: the backend mirror test's regex is anchored on `as const` (fragile if the
  frontend array gains quoted comments); the frontend label test has a redundant
  second assertion.
- EN `settings.modules.sub.bus` lacks the article ("a logbook …").
- A hook comment names `/api/v1/bus` before the route existed.
- The migration test's title promises a refusal it does not exercise (rename it or add
  a 23514 insert test).
- `assertEntryOwned`'s final `else` has no exhaustiveness check (pre-existing style).
- The companions usage count was untested until the route test.
- Uneven wrap of the clockless doc comment in `statusSweep.ts`, and a missing blank
  line before `describe("bus rides")` in its test.
- The clockless sweep test covers the no-arrival branch only; rail has no clockless
  sweep test of its own (follow-up outside this work).
- `wallClockInput.ts`'s doc comment points at `shared/railClock.ts` (say "the domain's
  clock readers"); `foldField` lacks a doc comment.
- `isLocalDayInput` is still duplicated in `rail.ts`.
- `rideKind: "charter"` is not pinned as rejected by a test.
- The FX test cannot fail on "dated by departure" or "PATCH keeps the snapshot" (stub
  fetch); no PATCH/DELETE cross-user or PATCH invalid-body tests.
- The OpenAPI query block duplicates `busQuerySchema` (the status array is
  undocumented, as in rail).
- `railListSummary` is the name used for bus list rows.
- The comment in `index.ts` still names `rateLimit.ts` (true through the re-export).
- The escape test lacks a positive control ("100% Bus"); "position from the newest" is
  unpinned (identical coordinates in the fixture).
- The collation comment overstates; the `terminalRows` mapping uses a cast; a stray
  comment follows an assertion.
- `tripEntryCount` answers 0 for bus (pointed at B2): trip-card chips hide bus rides
  until then.
- The emoji tile in `MapNextUpCard` / `NextUpEntry` (consistent with its neighbours);
  the lucide `bus` entry is not strictly alphabetical.
- `listAll` multi-page and a mid-loop rejection are untested; `BusListQuery.status` is
  a `string`; the placeholder "Udeung, Lounge …" may want another example.
- Mixed precision (day departure, minute arrival) loses the arrival clock on save —
  documented, because the toggle applies to both ends.
- The generic-sentence test asserts only an alert; the form hook has no test of its
  own.
- After a save whose parent `onSaved` rejects, the dialog shows no notice (a "saved,
  but the list could not be refreshed" line would be better).
- The year scan is capped at 500 rides and refetched after each save.
- The gating tests cover three of seven surfaces.
- A detail reload remounts `DocumentsSection`.
- `addPerTab.bus` copy is absent (unreachable until B2's tab).
- Follow-ups outside this plan: `places/suggestions` escaping, `durationHm` into
  `common`, rail's day-precision form (Forgejo issue after B1).
