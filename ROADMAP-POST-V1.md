# TravStats Post-V1 Roadmap

> Features planned after the v1.0 stable release.
> TravStats evolves from a flight tracker into a **travel tracker**.
> Ordered by priority and user value.

---

## V1.1 — Cruises Module

A complete parallel to flights — own data model, forms, map, stats,
and achievements. Accessible via a new **"Kreuzfahrten"** nav tab.
This is the first step toward making TravStats a full travel platform.

### Core Concepts

| Flights | Cruises |
|---------|---------|
| Airport | Port (Hafen) |
| Airline | Cruise Line (Reederei) |
| Aircraft type | Ship (Schiff) |
| Flight number | Voyage number |
| Departure → Arrival | Embarkation → Disembarkation |
| Route (A → B) | Itinerary (multi-stop, 5–20 ports) |
| Seat class | Cabin category |
| Flight duration (hours) | Cruise duration (days) + sea days |

### Data Model
```
Cruise {
  id                   String   @id
  userId               String   → User
  cruiseLine           String   // "AIDA", "TUI Cruises", "MSC", ...
  shipName             String   // "AIDAcosma", "Mein Schiff 4"
  voyageNumber         String?
  embarkationPort      String   // port name
  embarkationLat       Float
  embarkationLon       Float
  disembarkationPort   String
  disembarkationLat    Float
  disembarkationLon    Float
  departureDate        DateTime
  returnDate           DateTime
  cabinNumber          String?
  cabinCategory        String?  // inside/ocean_view/balcony/suite/penthouse
  deckNumber           Int?
  theme                String?  // "Transatlantic", "Nordland", "Caribbean"
  status               String   // booked/completed/cancelled
  price                Float?
  currency             String?  @default("EUR")
  notes                String?
  tags                 String[]
  photoUrl             String?  // ship or trip photo
  createdAt            DateTime @default(now())
}

CruisePort {
  id            String   @id
  cruiseId      String   → Cruise
  portName      String
  portCode      String?  // UN/LOCODE (e.g. "ESMAJ" for Mallorca)
  country       String?
  lat           Float
  lon           Float
  arrivalDate   DateTime?
  departureDate DateTime?
  isSeaDay      Boolean  @default(false)
  sortOrder     Int
  notes         String?
}
```

### Seed Data
- **Cruise Lines** (~30): AIDA, TUI Cruises, MSC, Costa, Royal
  Caribbean, Celebrity, Norwegian, Carnival, Princess, Holland
  America, Cunard, Disney Cruise, Viking, Hapag-Lloyd, Hurtigruten,
  Ponant, Seabourn, Silversea, Regent, Oceania, Windstar, etc.
- **Ships** (~100): major ships per cruise line with capacity/year
- **Ports** (~200): major cruise ports with coordinates
  (use existing airports table pattern — separate `cruise_ports`
  table seeded from public port databases)

### Frontend: `/cruises` Page
- **List view**: all cruises with ship, dates, route preview
- **Map view**: polyline through all ports per cruise, colored by
  cruise line
- **Add cruise form**: multi-step like flights
  1. Select cruise line + ship (autocomplete from seed + history)
  2. Set dates, embarkation/disembarkation ports
  3. Add itinerary ports (drag-and-drop reorder, add sea days)
  4. Cabin details, price, tags, notes
- **Cruise detail view**: itinerary timeline, port map, stats

### Statistics (`/stats` integration)
- Total sea days, total nautical miles
- Ports visited (unique count + map)
- Ships sailed (collection)
- Cruise lines tried
- Longest cruise, most ports in one trip
- Cabin category distribution
- Spending per cruise / per day

### Achievements: "Seafarer" Category
- **First Voyage** (1 cruise completed)
- **Sea Dog** (5 cruises)
- **Admiral** (25 cruises)
- **Port Collector** (10 / 25 / 50 / 100 unique ports)
- **Fleet Commander** (5 / 10 different ships)
- **World Cruise** (cruise with 20+ ports)
- **Transatlantic** (cruise crossing the Atlantic)
- **Polar Explorer** (cruise above Arctic Circle)
- **Sea Day Lover** (cruise with 5+ consecutive sea days)
- **Loyalty Captain** (10 cruises with the same line)

### Implementation Plan
1. Prisma migration: `cruises`, `cruise_ports`
2. Backend: seed data for cruise lines, ships, ports
3. Backend: CRUD routes `/api/v1/cruises`, `/api/v1/cruises/:id/ports`
4. Backend: cruise stats calculator (parallel to flight stats)
5. Backend: cruise achievement types + seed achievements
6. Frontend: `/cruises` page with list + map views
7. Frontend: add/edit cruise form (multi-step)
8. Frontend: cruise detail view with itinerary timeline
9. Frontend: integrate cruise stats into `/stats` page
10. Frontend: nav tab "Kreuzfahrten"

---

## V1.2 — Special Flights & Collections

### Flight Highlights System

Flights can be tagged with special attributes that go beyond normal tags.
Two new dimensions: **Event Type** and **Livery / Special Aircraft**.

#### Event Types (predefined + custom)
Selectable in the flight form, multiple per flight:
- Solar eclipse flight
- Inaugural / first flight (new route or aircraft)
- Final / farewell flight (route/aircraft retirement)
- Charter / VIP flight
- Air show / demonstration flight
- Scenic / sightseeing flight
- Diversion / emergency landing
- Go-around / missed approach
- Record flight (personal longest, fastest, etc.)
- Custom event (free text)

#### Livery / Special Aircraft
New optional field on flights:
- Airline special livery name (e.g. "Star Alliance", "Fanhansa",
  "OneWorld", "Retro Livery", "Disney Planes")
- Special registration (e.g. "D-AIQA — Fanhansa")
- Photo upload for the livery (stored alongside the flight)
- Flag: "Rare aircraft" (e.g. A380, Concorde, AN-225)

#### Cruise Highlights (same pattern)
- Maiden voyage, repositioning cruise, theme cruise
- Ship christening, farewell voyage
- Hull art / special paint
- Photo upload

#### New Achievement Category: "Collector"
- **Livery Hunter** (5 / 10 / 25 different liveries)
- **Event Chaser** (3 / 10 event flights)
- **Inaugural Flyer** (first flight on a new route)
- **Farewell Tour** (fly a retiring aircraft type)
- **Planespotter** (10 rare aircraft types)
- **Eclipse Chaser** (solar eclipse flight)
- **Full Livery Set** (all liveries of one airline)

#### Collections Gallery (`/collections`)
Unified gallery for flight AND cruise highlights:
- Grid/gallery view with photos
- Filter by type (flight event / livery / cruise event)
- Statistics: liveries collected, event types, ships sailed
- Timeline view: special moments in chronological order

#### Data Model
```
Highlight {
  id             String
  flightId       String?  → Flight  (one of these two)
  cruiseId       String?  → Cruise  (must be set)
  eventType      String?  // predefined enum or custom text
  liveryName     String?
  registration   String?
  photoUrl       String?
  isRareAircraft Boolean  @default(false)
  notes          String?
}
```

#### Implementation Plan
1. Prisma migration: add `highlights` table (polymorphic)
2. Backend: CRUD routes `/api/v1/highlights`
3. Backend: new achievement `requirementType` values
4. Frontend: highlight section in flight + cruise edit forms
5. Frontend: `/collections` gallery page
6. Frontend: photo upload component (reuse receipt upload pattern)
7. Seed achievements for collector category

---

## V1.3 — CO2 Footprint & Sustainability

- CO2 calculation per flight (based on aircraft type, distance, class)
- CO2 calculation per cruise (based on ship type, duration, cabin)
- Total CO2 dashboard with equivalents (car km, trees needed)
- Class comparison (Economy vs Business vs First / Inside vs Suite)
- Monthly/yearly CO2 trend chart
- Offset suggestions with links to providers
- CO2 badge achievements (carbon-conscious traveler)

---

## V1.4 — Trip Planner & Itineraries

- Group flights AND cruises into trips with drag-and-drop
- Trip timeline with layovers, connections, and sea days
- MCT (Minimum Connection Time) warnings
- Trip cost summary
- Trip sharing (public link with map + itinerary)
- Trip notes and photos
- Print-ready trip itinerary

---

## V1.5 — Social & Sharing

### Travel Map Generator
- Beautiful share graphics (year-in-review cards)
- Animated route replay video (WebM/GIF export)
- Social media templates (Instagram story, Twitter card)
- Download as PNG/SVG
- Customizable themes and color schemes

### Friends & Comparison
- Friend invites via link
- Compare travel stats side by side
- Common airports/ports and routes
- Monthly/yearly challenges
- Shared trip planning

---

## V1.6 — Smart Analytics & Insights

### AI-Powered Insights
- Pattern detection (your most active travel month is...)
- Route recommendations based on history
- Price trend analysis (if cost data available)
- Jetlag score and recovery time estimation
- Travel habit changes over time

### Advanced Seat Analytics
- Window vs aisle preference over time
- Seat map visualization per aircraft type
- Best seat recommendations per route
- Seat class upgrade tracking

---

## V1.7 — PWA & Mobile

- Service worker for offline access
- Install as native app (manifest.json)
- Push notifications (check-in reminders, gate changes)
- Offline flight/cruise entry (sync when back online)
- Camera-first boarding pass scan on mobile
- Responsive touch gestures for map navigation

---

## V1.8 — Advanced Import & Automation

### Two-Stage Multi-Flight Parser (Hybrid)

Current problem: emails with multiple flights (round-trip, multi-leg)
cause the parser to mix up data between flights. Solution: a two-stage
approach that splits first, then extracts per flight.

**Stage 1 — Block Identification (Splitting)**
- Parser scans the email and identifies text blocks per flight
- Each block is color-coded in a review UI (Flug 1 blue, Flug 2 green, ...)
- Natural delimiters: flight number lines, blank lines, "durchgeführt von:"
- Shared data (PNR, passenger name) extracted once and inherited by all flights
- User can: confirm auto-split, adjust boundaries, or manually mark blocks
- Single-flight emails skip this stage entirely

**Stage 2 — Per-Block Extraction (Parsing)**
- Each confirmed block is parsed independently (1 block = 1 flight)
- Existing parsers (LLM, templates, regex) work on isolated text
- Review card per flight with extracted fields, confidence badge
- No more positional matching across the entire email

**UI: Annotation-style interaction**
- Click on paragraphs to assign them to a flight (like the annotation tab)
- Step-by-step: "Select text for Flight 1" → "Select text for Flight 2" → ...
- Works on desktop (click) and mobile (tap on paragraph)
- Auto-detect proposes blocks, user confirms or overrides

**Template-based splitting patterns (per airline)**

Each GitHub airline template gets a `splitting` section that describes how
to identify block boundaries for that airline's email format:

```json
{
  "iata": "LH",
  "splitting": {
    "blockStart": "([A-Z]{2}\\s?\\d{1,4})\\n",
    "blockEnd": "durchgeführt von:",
    "sharedFields": ["pnr", "passengerName"]
  }
}
```

Different airlines need different splitting rules:
- **Lufthansa**: flight number line as block start, "durchgeführt von:" as end
- **Ryanair**: typically 1 flight per email, no splitting needed
- **easyJet**: HTML table rows, each row = one flight
- **Eurowings**: similar to LH with different labels

**Multi-version template scoring**

Airlines change their email format over time (e.g. LH, LH-old, LH-v1).
Instead of picking one upfront, all matching templates run in parallel
and compete on extraction quality:

```
Email from @lufthansa.com → Airline: LH → 3 templates found

  "LH":     4 blocks, 8/10 fields extracted → Score 80  ← winner
  "LH-old": 0 blocks                        → Score 0
  "LH-v1":  4 blocks, 5/10 fields extracted → Score 50
```

Scoring criteria:
- Splitting found blocks? (+points)
- Mandatory fields extracted? (flight number, airports, times)
- Values plausible? (IATA 3 chars, time format valid)
- Tie-breaker: higher template `version` wins

The `index.json` on GitHub groups templates per airline:

```json
{
  "airlines": [
    {
      "iata": "LH",
      "templates": [
        { "id": "LH",     "version": "2025-04", "label": "Buchungsdetails (current)" },
        { "id": "LH-old", "version": "2025-04", "label": "Buchungsdetails (pre-2024)" },
        { "id": "LH-v1",  "version": "2025-06", "label": "Reiseplan format" }
      ]
    }
  ]
}
```

User sees only the result — which template won is shown as info badge
in the review card (e.g. `parserTemplate: "LH"`).

**Why this works:**
- Tested against real Lufthansa 4-leg booking (MUC→YVR→LAS→LAX→MUC):
  clear block boundaries with flight number as anchor
- With LLM: both stages run automatically, user just confirms
- Without LLM: templates/regex work much better on isolated blocks
- Worst case: user marks blocks manually, parser extracts per block
- Template versioning handles airline format changes gracefully

### Batch Import v2
- CSV/JSON drag-and-drop import with column mapping
- Import from TripIt, MyFlightradar24, FlightAware
- Airline CSV export compatibility (LH, EK, QR, etc.)
- Automatic duplicate detection and merge

### Email Automation
- IMAP polling for booking confirmations
- Email forwarding webhook
- Automatic parsing and pending-review queue
- Multi-airline template library

### URL Boarding Pass Decoder
- Lufthansa Web-BP, Ryanair, easyJet, Wizz Air URLs
- Headless browser fallback for JS-rendered passes

---

## V2.0 — Multi-User & Platform

- Public profiles with privacy controls
- Global travel statistics (anonymized)
- API for third-party integrations
- Plugin/extension system
- White-label deployment support
- Multi-language expansion (FR, ES, IT, JA)

---

## Technical Debt (continuous)

- [ ] CI/CD pipeline (GitHub Actions) with automated deploy
- [ ] E2E test suite (Playwright) with 80%+ coverage
- [ ] Redis caching for stats and suggestions
- [ ] Server-side pagination for large datasets
- [ ] Error tracking (Sentry)
- [ ] Database automated backups with retention
- [ ] Performance monitoring dashboard
- [ ] Security: 2FA backend, session management, GDPR export

---

*Created: 2026-04-13*
*Current version: 0.20.0-beta — targeting V1.0 by end of April 2026*
