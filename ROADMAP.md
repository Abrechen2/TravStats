# Roadmap

TravStats is a solo-maintained side project. This roadmap is a direction,
not a commitment — features land when they're ready and the maintainer has time.

---

## ✈️ v1.0 — What's in the box

Everything below ships with the first stable release.

**Core tracking**
- Manual flight entry with categories, tags, travel companions, costs
- Boarding-pass scanner (QR, barcode, OCR)
- Email import (plain text, HTML, `.msg`/`.eml`) with local LLM parsing via Ollama
- Duplicate detection with a "save anyway" escape hatch
- 5 flight states: flown, scheduled, cancelled, historical, duplicated

**Visualisation**
- Six map modes: Routes · Heatmap · Hexagon (3D) · 3D Columns · Trips · Globe
- Flight timeline + calendar view with travel-intensity heatmap
- Year-over-year statistics, seat/zone/class distribution, top routes

**Automation**
- Automatic flight-data lookup via AirLabs, Aviationstack, OpenSky
- Automatic pending-update flow during active flights
- Historical enrichment scheduler
- 24h/2h email reminders before departure (SMTP)
- Automated database backups with retention + optional WebDAV sync

**Gamification**
- 58 Battlefield-style achievements across 5 categories
- Downloadable vintage-passport flight certificate (PNG export)
- Optional small-group leaderboard

**Admin & ops**
- Invite-only user management (1–10 users by default)
- SMTP, API-key, historical-enrichment and backup configuration in-app
- Anonymised diagnostic-export bundle for bug reports
- Export to CSV, GeoJSON, KML (Google Earth)

---

## 🚢 v1.1 — Cruises module

TravStats grows from a flight-only logbook into a full travel logbook.

- First-class cruise data model (ship, voyage, itinerary, cabin, sea days)
- `/cruises` page parallel to flights with own forms, map view, stats
- Port-to-port map visualisation alongside flight routes
- "Seafarer" achievement category
- Combined travel statistics across flights + cruises

---

## 🏆 v1.2 — Special flights & collections

- Flight highlights (first flight, jubilee flight, storm flight, longest layover, livery spots, retro cabins)
- Collections gallery with photo uploads per highlight
- "Collector" achievement category (livery hunter, route completionist, …)
- Same pattern for cruise highlights (maiden voyage, formal night, …)

---

## 🌱 v1.3 — CO₂ footprint & sustainability

- Per-flight CO₂ calculation based on aircraft type, distance, cabin class
- Per-cruise CO₂ estimation (ship class, duration, cabin category)
- Dashboard with equivalents (car km, trees needed, trips avoided)
- Class comparison (Economy vs Business vs First, Inside vs Suite)
- Carbon-conscious achievement tier

---

## 🧭 v1.4 — Trip planner & itineraries

- Group flights + cruises into **trips** with drag-and-drop
- Timeline with layovers, connections, sea days
- Minimum-connection-time warnings
- Shareable public trip pages with map + itinerary

---

## 📦 v1.5 — Full provider field capture

A schema rounding pass for the existing flight-lookup providers. Today
only a subset of the available API fields is persisted; the rest is
either re-derivable per flight or thrown away. v1.5 stores everything
cheap-to-keep so future features (block-time analytics, cargo flag,
freshness debugging, quality-tag interpretation) don't need a follow-up
provider re-fetch.

- **AeroDataBox**: persist `runwayTime` (off-block / on-block) on both
  ends, `isCargo`, `lastUpdatedUtc`, `quality` tags (`string[]`),
  `baggageBelt`, `checkInDesk`, plus per-airport `timeZone` /
  `shortName` / `municipalityName`
- **Backfill** via the existing historical-enrichment scheduler — no
  manual refresh needed for users on AeroDataBox
- **Skipped on purpose**:
  - `aircraft.image` (CC-BY-SA attribution requirement — defer until
    the v1.6 hull-gallery UI exists; storing the URL without rendering
    creates a legal display obligation we can't satisfy)
  - `distance.{meter,mile,nm,feet}` (redundant — derive from `km` on
    read instead of duplicating four columns)

No UI changes — fields land silently in the schema and start
populating in the background. Consuming UI features (block-time
analytics, hull gallery, quality badges) are scheduled into v1.6+.

---

## 📥 v1.6 — Importers & onboarding

A pluggable import pipeline so existing logbooks can seed TravStats
on day one without requiring users to write code or do manual
timezone math. Same skeleton across providers; new sources slot in
as parser plug-ins.

**Sources (initial set)**

- **Flightradar24 logbook** (Issue #99) — first-class importer for
  the `my.flightradar24.com` CSV export. Handles column mapping,
  in-app TZ conversion via the existing airport-lookup service,
  preview screen with per-row validation, funnels into the existing
  `POST /flights/batch`. The most common pre-existing logbook,
  especially Silver/Gold subscribers
- **OpenFlights** — flat CSV per-flight export, one of the oldest
  free flight-logbook formats
- **App in the Air** — JSON export from the iOS/Android app
- **FlightAware "My Flights"** — CSV export from FlightAware accounts
- **Generic logbook CSV** with a column-mapping wizard — covers
  custom Excel sheets and niche apps; users drag their columns onto
  TravStats fields, TZ conversion still server-side

**Shared skeleton**

- Provider-specific parser plug-in (column mapping, type coercion,
  format detection)
- Centralised airport lookup + TZ conversion (reuses
  `enrichFlightAirports` already used by `flightsBatch.ts`)
- Preview screen with per-row validation, edit / drop per row
- Bulk dispatch through `POST /flights/batch` (existing chunking,
  dedup, PNR-based trip auto-grouping for free)
- Source attribution via `dataSource: 'imported_<provider>'` so the
  origin stays visible in dashboard filters and analytics
- Status defaulting: rows with `dep_utc` in the past → `flown`,
  future → `scheduled`

**Cruise-side equivalent** (Cruisemapper, MyShipTracking exports)
deferred to a follow-up — the parser skeleton + bulk-route are
flight-specific today; cruise needs its own batch endpoint first.

---

## 👥 v1.7 — Social & sharing

- Year-in-review share graphics (Instagram story, Twitter card, animated WebM)
- Friend invites with side-by-side stat comparison
- Shared route-map images (PNG/SVG, customisable themes)

---

## 🧠 v1.8 — Smart insights

- Pattern detection ("your most active month is …")
- Route recommendations based on history
- Seat-preference analytics over time
- Jetlag score and recovery estimation

---

## 📱 v1.9 — PWA & mobile

- Service worker, offline access, install-as-app manifest
- Camera-first boarding-pass scan on mobile
- Push notifications (gate changes, check-in reminders)
- Touch-friendly map gestures

---

## 🤖 v2.0 — Advanced import & automation

- Two-stage multi-flight email parser (block-split + per-flight extraction)
- Community-shared airline templates via GitHub
- Multi-version template scoring (pick the best parse automatically)
- **Cloud-mode parser** — Groq (Llama 3) and Gemini Flash adapters as
  fallbacks for users without a self-hosted Ollama; same template
  engine, GPU-less option

---

## 💱 v2.1 — Multi-source data enrichment

Layered free-tier integrations to broaden travel-data coverage. All
sources chosen to keep TravStats hostable as a SaaS without
non-commercial licence traps.

- **Multi-currency trip costs** — record costs in any of 200+
  currencies; backend normalises to the user's display currency using
  historical FX rates from the Frankfurter / ECB pipeline
- **Weather at departure & arrival** — METAR / TAF history (NOAA AWC
  for the last 96 h, IEM Mesonet for everything older) layered into
  the flight detail page: wind, visibility, temperature, conditions.
  Lazy-fetched per flight, cached per airport-day
- **Live ship tracking** *(extends v1.1 Cruises)* — opt-in AIS-stream
  layer (AISStream.io) showing your booked or current ship's
  real-time position on the cruise map, fed by a single backend
  WebSocket subscription fanned out to clients

---

## 💰 v2.2 — Cost & expense overhaul

Refactor the cost data model. Today, prices live as scalar columns on
`Flight` (`price`, `taxes`, `fees`, the dead `ticketPrice`) and
duplicated on `Booking` (`price`), with a `seenBookingIds` dedup hack
in the stats layer to avoid double-counting. Cruises have no cost
fields at all, and the dashboard `totalCost` blindly sums values
across currencies. The v2.1 Frankfurter pipeline is the prerequisite;
v2.0 is the structural rewrite that makes use of it.

- **Unified `Expense` model** — one row per cost line, polymorphically
  attached to a Flight, Booking, Trip, Cruise, or CruiseStop. Each row
  carries the original amount + currency plus a snapshot
  `amountInBase` / `fxRate` / `fxDate` captured at entry time, so
  historical stats stay stable when FX moves later
- **Cost categories** — ticket, tax, fee, ancillary (parking, baggage,
  lounge, transfer), hotel, excursion, gratuity. Replaces the implicit
  taxes/fees split
- **Payment metadata** — payment method, paid-by (self vs employer),
  reimbursement status, optional companion split
- **Cruise costs** — solved for free by the polymorphic `Expense`:
  attach to `Cruise` for the booking, `CruiseStop` for shore
  excursions and onboard charges
- **Trip-level budget & default currency** — each Trip can carry a
  base currency that pre-fills new flights/cruises within it; falls
  back to the user-level setting otherwise
- **Stats overhaul** — `totalCost`, `costPerKm`, `costPerHour` move
  from raw float sums to `SUM(amountInBase) GROUP BY category`, plus
  category breakdown (how much of last year's $12k was actually
  ancillaries?), reimbursement-aware filters, and per-trip P&L
- **Migration** — backfill existing `Flight.price/taxes/fees` and
  `Booking.price` rows into `Expense`, FX-snapshot via the v2.1
  Frankfurter pipeline, then drop the legacy columns including the
  long-dead `ticketPrice`

---

## 🧰 Continuous improvements

Running in parallel across versions.

- E2E test coverage expansion
- Performance: Redis caching, server-side pagination for large datasets
- Error tracking, performance dashboard
- Route-aggregation clustering (replace median for multi-corridor routes)
- Confidence-score calibration via user feedback loop
- Optional 2FA for admins
- OurAirports CSV as fallback / cross-check source for the airport seed

---

## 🤝 Contributing

Feedback, bug reports and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes or report issues.

*This roadmap is reviewed with each release. Priority shifts based on real-world use and community feedback.*
