# TravStats Post-V1 Roadmap

> Features planned after the v1.0 stable release.
> Ordered by priority and user value.

---

## V1.1 — Special Flights & Collections

### Core: "Flight Highlights" System
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

#### Collection & Gallery Page (`/collections`)
- Grid/gallery view of all special flights with photos
- Filter by event type, livery, aircraft
- Statistics: how many liveries collected, how many event types
- Timeline view: special moments in chronological order

#### New Achievement Category: "Collector"
- **Livery Hunter** (5 / 10 / 25 different liveries)
- **Event Chaser** (3 / 10 event flights)
- **Inaugural Flyer** (first flight on a new route)
- **Farewell Tour** (fly a retiring aircraft type)
- **Planespotter** (10 rare aircraft types)
- **Eclipse Chaser** (solar eclipse flight)
- **Full Livery Set** (all liveries of one airline)

#### Data Model
```
FlightHighlight {
  id            String
  flightId      String   → Flight
  eventType     String?  // enum or custom
  liveryName    String?
  registration  String?
  photoUrl      String?
  isRareAircraft Boolean
  notes         String?
}
```
One-to-many: a flight can have multiple highlights.

#### Implementation Plan
1. Prisma migration: add `flight_highlights` table
2. Backend: CRUD routes `/api/v1/flights/:id/highlights`
3. Backend: new achievement `requirementType` values
4. Frontend: highlight section in FlightEditModal + FlightCompleteStep
5. Frontend: `/collections` gallery page
6. Frontend: photo upload component (reuse receipt upload pattern)
7. Seed achievements for collector category

---

## V1.2 — CO2 Footprint & Sustainability

- CO2 calculation per flight (based on aircraft type, distance, class)
- Total CO2 dashboard with equivalents (car km, trees needed)
- Class comparison (Economy vs Business vs First)
- Monthly/yearly CO2 trend chart
- Offset suggestions with links to providers
- CO2 badge achievements (carbon-conscious traveler)

---

## V1.3 — Trip Planner & Itineraries

- Group flights into trips with drag-and-drop
- Trip timeline with layovers and connection times
- MCT (Minimum Connection Time) warnings
- Trip cost summary
- Trip sharing (public link with map + itinerary)
- Trip notes and photos
- Print-ready trip itinerary

---

## V1.4 — Social & Sharing

### Flight Map Generator
- Beautiful share graphics (year-in-review cards)
- Animated route replay video (WebM/GIF export)
- Social media templates (Instagram story, Twitter card)
- Download as PNG/SVG
- Customizable themes and color schemes

### Friends & Comparison
- Friend invites via link
- Compare flight stats side by side
- Common airports and routes
- Monthly/yearly challenges
- Shared trip planning

---

## V1.5 — Smart Analytics & Insights

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

## V1.6 — PWA & Mobile

- Service worker for offline access
- Install as native app (manifest.json)
- Push notifications (check-in reminders, gate changes)
- Offline flight entry (sync when back online)
- Camera-first boarding pass scan on mobile
- Responsive touch gestures for map navigation

---

## V1.7 — Advanced Import & Automation

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
- Global flight statistics (anonymized)
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
