# Rich map details — route cards, hover profiles, stop info

Owner, 2026-10-21: "Die Details und Hover sind zu wenig, Fähren und Mietwagen
sieht so wenig aus." This note fixes what each map card and tooltip shows for
rail, bus, ferry and rental (the flight route card is the reference), where
every figure comes from, and the rules that keep it honest.

## 1. Click — route card (rail, bus, ferry, rental)

Built client-side from the rows the map already holds (the user's own rows,
nothing else), in `journeys/journeyRouteFigures.ts`, pure and unit-tested.
Every row is printed only when it can be derived; otherwise the row is
omitted, never shown as 0.

| Row | Rule |
|---|---|
| How often | travelled / planned tally, as today |
| First / last | oldest and newest **travelled** journey, each on its departure place's clock (`MapJourney.departure`, a `TimeValue`) |
| Ø duration, fastest, slowest | travelled journeys whose departure AND arrival are known to the minute (`precision === "minute"`, the `railDurationMinutes` rule): a date-only ride measures nothing. Fastest/slowest only from two measured journeys up |
| Ø delay | rail/bus/ferry journeys with a recorded `delayMinutes`, an arrival and both clocks — the rule of `railStats.delayBuckets`; says over how many journeys |
| Total km | sum over travelled journeys with a recorded distance, labelled with what it measures (`distanceSource`: Luftlinie, Straße, Seeweg (Schätzung), laut Ticket, …); journeys without one are named, never added as 0 |
| Arrival day | a journey whose arrival falls on another local day shows "10.08. → 11.08." |
| Rental: Ø rental length | `rentalDays` of travelled rentals |
| Rental: km/day | Σ driven km / Σ days over travelled rentals with a driven-km figure (`rentalDrivenKm`) — the rule of `rentalStatsExtra.kmPerDay` |
| Rental: cost/day, cost/km | **per currency**, from the row's `cost` (final, else booked; a cancellation fee never counts), exactly as the rental statistics do (`rentalStats.costPerDay`, `rentalStatsExtra.costPerKm`): amounts in different currencies are never added. Cost/km only from rentals with both a cost and driven km > 0 |

Every route card (rental included) keeps the "Letzte öffnen / Nächste öffnen"
action; a same-station rental opens as a stop card and gets the action there.

## 2. Hover — route tooltip

Renders immediately from precomputed figures (hover fires at 60–120 Hz):
both ends with flags, the tally, distance (with its source), Ø duration, last
date. Two async parts fill in AFTER render and are omitted on any miss or
failure — the tooltip never waits for them:

- the operator logo — `GET /operators/mark` (existing, cached per page load);
- a small picture of the subject — ferry: the vessel; rental: the vehicle
  model; rail: the train category (e.g. "ICE"); bus: none (no field records a
  coach type — abstain).

The tooltip HTML carries placeholders (`data-hover-operator`,
`data-hover-subject`, `data-hover-stop`); `hoverEnrichment.ts` fills them
from client caches once the box is drawn, and only while the same tooltip is
still shown. An image that errors is removed.

## 3. Points — stations, terminals, ports, rental branches

Hover and click show: kind, tally, how often visited, last visit, departures
from here, destinations from here (top three with counts), and — where the
instance allows open data — a photo and the opening sentences of the Wikipedia
article about the place.

## 4. Endpoints (enveloped family, ADR 0001)

`GET /api/v1/map-details/subject?kind=vessel|vehicle|train&name=` →
`{ available, pending, credit }`; `GET /api/v1/map-details/subject/image?…`
→ the picture bytes or 404. Same machinery as the operator logos:

- only a name the user's OWN rows record (`vesselName`, `vehicleExample` /
  `vehicleClass`, `trainCategory`) is ever looked up — an arbitrary string
  costs no request;
- Wikidata item whose label/alias IS the name AND whose description names the
  right kind of thing (a ship, a car model, a train) — "ICE" the agency is
  refused; its P18 image from Commons, **free licences only**, Commons'
  raster thumbnail (≤ 320 px, ≤ 512 KiB), credit (licence, author, file page)
  returned and shown;
- the single polite Wikimedia queue, per-user cold-lookup window, instance
  cap, a 3 s wait then `pending`; hits cached on disk 30 days, misses in a
  bounded in-memory LRU (a day; an outage an hour);
- gated by the instance switch that already governs operator logos (its copy
  now names pictures too); `Cache-Control: private`.

`GET /api/v1/map-details/stop?domain=&lat=&lon=&name=&lang=` →
`{ summary | null, unavailable }`:

- 409 `openDataDisabled` while the instance's open-data switch is off (the
  card shows nothing — an admin's choice, not a failure);
- only for a point within ~250 m of an end of one of the user's own
  journeys of that domain — otherwise `summary: null` without a request;
- Wikipedia `geosearch` around the point (≤ 500 m, ≤ 10 hits), then a hit
  whose title shares a distinctive word with the stop's name AND names a
  transport place (Bahnhof, station, Hafen, terminal, …) or equals the name;
  no match → null. Then the REST summary (CC BY-SA, credited, linked);
- `unavailable: true` when Wikipedia did not answer — the card says so;
  results cached in memory a day, outages not cached; `openDataLimiter`.

## 5. Privacy

Stats come only from the rows the user's map already loaded. The server sends
Wikimedia a vessel / car / train name (subject pictures) and, with open data
on, a stop's coordinates (Wikipedia geosearch) — both behind the admin's
switches, never from the browser. The Wikipedia thumbnail is shown the way
`WikipediaCard` does (`referrerPolicy="no-referrer"`).

## 6. iPad

The card stays inside its existing width; list rows and toggles keep the
pointer-coarse touch minimum. Images are fixed boxes (no layout jump beyond
the box appearing).
