# TravStats Feature Roadmap

> Note: This document is UTF-8 encoded. If special characters render incorrectly, open it in a UTF-8 editor or run `chcp 65001` in your terminal.

## Phase 0: Quality Assurance & Delivery (before Week 1)
*Lays the foundation for reliable releases and security standards*

### 🧪 0. CI/CD Pipeline & Security Scans
- [ ] Pipeline with linting, tests, type checks, and Docker build
- [ ] Dependency scanning and vulnerability alerts
- [ ] Secret and JWT config checks (e.g. via Trivy/Gitleaks)
- [ ] Automated preview deployments for PRs


### Hotfixes (ASAP)
- [x] Backend won't start: clean up merge conflicts in `backend/src/routes/flights.ts` and `backend/src/services/flightLookup.ts`, unify the flight lookup endpoint (Aviationstack vs. AirLabs), and re-enable the rate limiter.
- [ ] Auth on mobile: make the API base URL configurable/relative for LAN access (`frontend/src/lib/api.ts`) and adjust CORS/SameSite for mobile clients. (Base URL/CORS/SameSite implemented, on-device live test still pending)
- [x] Achievements: adjust `checkAndUpdateAchievements` so that only unlocked achievements create persistence (otherwise new users start with everything unlocked).
- [ ] Add-flight flow: build the Simplified Form components without conflicts, test the lookup flow (V2) against the active endpoint, and add an automated happy-path test. (Conflicts fixed, lookup/E2E tests still missing)
- [x] 3D markers: deduplicate primarily via IATA/ICAO (with coordinates as fallback) and filter 0/0 coordinates to avoid stacked markers (`frontend/src/components/GlobeView.tsx`).
- [x] Build smoke test: add a short `npm run build`/`npm run test` smoke check to README/CI so backend/frontend breakage is caught immediately.
- [ ] OpenSky OAuth: the flight endpoint returns 404 despite a valid token (client credentials). Research the correct OAuth flight URL or build a states/tracks fallback so OpenSky works as a free fallback.
## Phase 1: Core Visualizations (Weeks 1-2)
*Extends the statistics page with key metrics*

### ✅ 1. Distance Visualization
- [x] Calculate total distance flown
- [x] Show equivalents (Earth circumnavigations, distance to the Moon, etc.)
- [x] Average distance per flight
- [x] Distance ranking of the longest routes
- [x] Visual presentation with icons

### ✅ 2. Time-Based Charts
- [x] Flights per month/year as a bar chart
- [x] Trend analysis with line chart
- [x] Visualize seasonal patterns
- [x] Weekday analysis (which day flies the most?)
- [x] Integration with Chart.js or Recharts

### ✅ 3. Calendar View
- [x] Monthly calendar with flight markers
- [x] Yearly overview calendar
- [x] Heatmap for travel intensity
- [x] Clickable days with flight details

## Phase 2: Gamification & Achievements (Weeks 3-4)
*Makes the app more entertaining and motivating*

### ✅ 4. Badges & Achievements System
- [x] Create achievement data model
- [x] Define 20+ different badges:
  - Globetrotter (5+ continents)
  - Frequent Flyer (100+ flights)
  - Night Flight King (10+ night flights)
  - Business Traveler (50+ Business Class)
  - Marathon Flyer (10+ hour flight)
  - Weekend Warrior (Fri-Sun flights)
- [x] Badge unlock animation
- [x] Badge gallery page

### ✅ 5. Airport Collection
- [x] Collect visited airports
- [x] Progress towards collections (e.g. "All German airports")
- [x] Highlight rare airports
- [x] Airport detail page with all visits

## Phase 3: Practical Tools (Weeks 5-6)
*Increases the practical usefulness of the app*

### 💰 6. Travel Cost Tracker
- [x] Add ticket price field
- [x] Total spending dashboard
- [x] Analyze costs per airline/route
- [ ] Budget tracking and forecasts
- [ ] Currency conversion
- [ ] Receipt upload (photos/PDF) with OCR for amounts
- [ ] Automatic detection of currency and tax category

### ✅ 7. Automatic Flight Data Lookup (AirLabs API)
- [x] AirLabs API integration (Free Tier: 1000 req/month)
- [x] Flight number lookup service
- [x] API endpoint for flight number queries
- [x] Smart Flight-First UX in the Add Flight dialog
- [x] Auto-fill all flight details
- [x] Boarding pass scanner with online validation
- [x] Dark mode support for the flight form
- [x] Step-by-step guided input process
- [x] **Hybrid Time Estimation System** (Historical Data + Heuristics)
- [ ] **AI-assisted data improvement (optional):**
  - [ ] OpenAI/Claude API integration for intelligent time estimation
  - [ ] ML-based prediction of flight times based on route/airline
  - [ ] Automatic validation and correction of boarding pass data
  - [ ] Confidence score for AI-generated suggestions
  - [ ] User feedback loop to improve AI accuracy
  - [ ] Cost-benefit analysis (API costs vs. time saved)
- [ ] Frequent flyer mile tracking (future feature)

### ✅ 8. Flight Tags & Categories
- [x] Implement tag system
- [x] **Business vs. private tracking:**
  - Dropdown field in the flight form (Business/Private/Vacation)
  - Statistics page split between business/private
  - Separate distance statistics per category
  - Cost tracking per category (for taxes)
- [ ] Predefined tags (conference, family visit, weekend trip, etc.)
- [x] Custom tags
- [x] Color coding on the map (Business = Blue, Private = Green)
- [x] Filter by tags and categories

### ✅ 9. Settings Page
- [x] **User profile:**
  - Change username
  - Manage email address
  - Upload profile picture
  - Change password (UI present, backend pending)
  - Delete account (with confirmation - UI present)
- [x] **Display settings:**
  - Dark/Light mode toggle (already implemented, centrally controllable here)
  - Choose language (German/English - UI present)
  - Set time zone
  - Date format (DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD)
  - Time format (24h / 12h AM/PM)
- [x] **Units & formats:**
  - Distance units (Kilometers / Miles / Nautical Miles)
  - Currency for cost tracking
  - Temperature unit (Celsius / Fahrenheit)
- [x] **Defaults:**
  - Default status for new flights (scheduled/flown)
  - Default seat class
  - Pre-select favorite airline
  - Default flight category (Business/Private)
- [x] **Map settings:**
  - Default map view (OpenStreetMap / Satellite)
  - Zoom level at startup
  - Marker style (Pin / Circle / Custom)
  - Color scheme for routes
- [x] **Notifications:**
  - Enable/disable email notifications (UI)
  - Flight reminders (24h/48h before - UI)
  - Check-in reminder (UI)
  - New feature updates (UI)
- [x] **Privacy & security:**
  - Two-factor authentication (2FA - UI present)
  - Show active sessions (UI present)
  - Login history (UI present)
  - Request data export (GDPR - UI present)
  - Fully delete data (UI present)
- [x] **Backup & sync:**
  - Enable automatic backup (UI)
  - Set backup interval (UI)
  - Export format preferences (UI)
  - Cloud sync settings (UI)

## Phase 4: Environment & Analysis (Weeks 7-8)
*Focus on sustainability and deeper analysis*

### 🌱 10. CO2 Footprint Tracker
- [ ] CO2 calculation per flight (by aircraft type & class)
- [ ] Total CO2 balance
- [ ] Comparison of different classes
- [ ] Offset suggestions
- [ ] Monthly CO2 trends

### 📊 11. Advanced Route Analysis
- [x] Identify most frequent routes
- [x] Route statistics (average duration)
- [ ] Best travel time for routes
- [ ] Suggest alternative routes
- [ ] Multi-leg and open-jaw trips with minimum connection time (MCT) check

### ✅ 12. Heatmap & Intensity Visualization
- [x] Yearly heatmap (like GitHub Contributions)
- [x] Monthly activity heatmap
- [x] Geographic heatmap (where you flew the most) — deck.gl HeatmapLayer

## Phase 5: Import & Export (Weeks 9-10)
*Simplifies data entry and management*

### ✅ 13. Boarding Pass Scanner (OCR)
- [x] Camera integration
- [x] QR/barcode scanner (PDF417, QR, Aztec, Data Matrix)
- [x] OCR for text extraction (jsQR, @zxing)
- [x] **Multi-format parser with fallback chain:**
  - [x] Standard IATA BCBP format (starts with 'M')
  - [x] Intelligent fallback parser (regex-based extraction)
  - [ ] URL-based boarding passes (Lufthansa Web-BP, Ryanair, etc.)
  - [ ] Airline-specific parsers (Lufthansa, Ryanair, easyJet, etc.)
- [x] **Debug mode:**
  - [x] Show raw scanned text
  - [x] Format detection and parsing method
  - [x] Step-by-step parsing log
- [x] Online validation with Flight Lookup API (if a flight number is recognized)
- [x] **OCR integration for visual boarding pass data:**
  - [x] Tesseract.js for text recognition
  - [x] Dual scan: barcode (flight data) + OCR (gate/terminal/times)
  - [x] Pattern matching for gate, terminal, boarding time
  - [x] Smart field extraction with regex patterns
  - [x] Timeout-based OCR (max 8s) so it doesn't block UX
- [ ] PDF import for e-tickets
- [x] Auto-fill the form

### 📄 14. Advanced Export Features
- [x] CSV export
- [x] GeoJSON export
- [x] KML export for Google Earth
- [ ] PDF report generator (currently only HTML export as .pdf)
- [ ] Excel export with pivot tables

### 📥 15. Batch Import System
- [ ] **CSV/JSON bulk import:**
  - File upload with drag & drop support
  - Template download for CSV format
  - Column mapping UI (flexible mapping of CSV columns)
  - Preview of the data to be imported (first 10 rows)
  - Progress bar during import
- [ ] **Validation & error handling:**
  - Strict schema validation with Zod
  - Duplicate detection (same flight number + date + route)
  - Error report with row number and error description
  - Partial import (import successful rows, skip faulty ones)
  - Download faulty rows as CSV for correction
- [ ] **Automatic data enrichment:**
  - IATA/ICAO autocomplete for airports
  - Automatic airport enrichment (coordinates, names)
  - Optional: flight number lookup for missing details
  - Automatic currency conversion
- [ ] **Import sources:**
  - Import from other apps (TripIt, MyFlightRadar24, etc.)
  - Compatible with airline CSV exports (Lufthansa, Emirates, etc.)
  - Custom format with flexible mapper
- [ ] **Post-import:**
  - Import summary dashboard (X flights added, Y skipped)
  - Undo function for last import
  - Import history with rollback option

### 💾 16. Backup & Sync
- [ ] Automatic backups (backend logic missing)
- [x] Import/export of all data (CSV, GeoJSON, KML)
- [ ] Versioning
- [ ] Cloud sync (optional)

### ✅ New Import Source: Booking Confirmation Email (Implemented)
- [x] **Manual Email Upload Page** (`/import` route)
  - [x] Paste text option (copy & paste email content)
  - [x] File upload option (.eml, .txt files)
  - [x] Automatic parsing with `parseBookingEmail` service
  - [x] User-friendly instructions on the page
- [x] **Backend endpoint** `/api/v1/imports/upload`
  - [x] Authenticated (uses JWT token, no secret needed)
  - [x] Creates `pending_review` import for the user
  - [x] Uses the existing email parser
- [x] **UI preview & review flow**
  - [x] Show pending imports on the dashboard
  - [x] Accept/reject functionality
  - [x] Duplicate detection on accept
- [ ] **IMAP polling (optional alternative)**
  - [x] Backend service `runImapPoller.ts` exists
  - [x] Admin UI configuration exists
  - [ ] App-specific password setup guide
  - [ ] Documentation for IMAP setup
- [ ] **Email forwarding via webhook** (future enhancement)
  - [ ] Webhook endpoint with secret authentication (already exists: `/imports/email`)
  - [ ] Email provider forwarding rules setup guide
  - [ ] User-specific webhook URLs

### 🔗 17. Backend Integration for URL-Based Boarding Passes
- [ ] **URL decoder service:**
  - [ ] Lufthansa Web-BP URL parser (https://lh.de/bp/...)
  - [ ] Ryanair boarding pass decoder
  - [ ] easyJet/Wizz Air URL patterns
  - [ ] British Airways/Eurowings formats
- [ ] **Web scraping/API integration:**
  - [ ] Headless browser for JavaScript-rendered boarding passes
  - [ ] Session management for authenticated requests
  - [ ] Screenshot fallback when parsing fails
- [ ] **Security & rate limiting:**
  - [ ] Request validation (only known airline domains)
  - [ ] Rate limiting per user (max 10 URL requests/day)
  - [ ] Timeout handling (max 10s per request)
  - [ ] User-agent rotation against blocking




## Phase 5.5: Data Enrichment & Validation 🆕
*Automatically improve data quality with free sources*

### ✅ 17. OpenFlights Airport Database
- [x] OpenFlights database import (~14,000 airports)
- [x] Automatic coordinate lookup for IATA/ICAO
- [x] Automatic IATA/ICAO lookup for coordinates
- [x] Nearest-airport search (radius-based)
- [x] Airport enrichment on flight creation
- [x] API endpoints for airport search and lookup
- [x] Duplicate avoidance through consistent data

**Benefits:**
- Solves the duplicate marker problem on the map
- Auto-fills missing airport data
- Consistent IATA/ICAO codes for all airports
- Completely free (no external API calls)
- Fast local lookups instead of slow external queries

**Usage:**
```bash
# Einmalig: OpenFlights-Datenbank importieren
npm run seed:airports:openflights

# Danach werden alle neuen Flüge automatisch angereichert
```

### 📊 18. Data Validation & Correction
- [x] Automatic enrichment pipeline in flight creation
- [x] Coordinate-to-airport matching (5 km radius)
- [x] IATA/ICAO normalization
- [ ] Batch update for existing flights
- [ ] Duplicate detection on import
- [ ] Fuzzy matching for airport names
- [ ] Validation report for inconsistent data

## Phase 6: Sharing & Social (Weeks 11-12)
*Share and compare with others*

### 🎨 19. Flight Map Generator
- [ ] Create beautiful share graphics
- [ ] Year-in-review cards
- [ ] Animated route videos
- [ ] Social media templates
- [ ] Download as PNG/SVG

### 🌐 20. Trip Summary
- [ ] Group multiple flights into trips
- [ ] Trip timeline
- [ ] Notes and photos for trips
- [ ] Create trip reports
- [ ] Multi-leg chains with segment details and realistic connection times
- [ ] Subscription notifications for new route trends or price alerts

### 👥 21. Friends Comparison (optional)
- [ ] Add friends
- [x] Leaderboards (present in achievement system)
- [ ] Common visited places
- [ ] Competitions/challenges

## Phase 7: Mobile & PWA (Weeks 13-14)
*Mobile optimization and offline capability*

### 📱 22. Progressive Web App
- [ ] Service worker for offline functionality
- [ ] Enable app installation (manifest.json)
- [ ] Push notifications
- [x] Mobile-optimized UI (responsive design present)

### 🔔 23. Notifications & Countdown
- [ ] Countdown to the next flight
- [ ] Check-in reminders (24h before)
- [ ] Gate change notifications
- [ ] Flight status updates

## Phase 8: Quality, Performance & Insights (continuous)
*Cross-cutting topics for stability, growth, and user feedback*

### 🧭 24. Onboarding & Guided Tour
- [ ] Guided tutorial with tooltips on the map and statistics pages
- [x] Onboarding checklist with first actions (add flight, use filter, test export)
- [ ] Demo data toggle for new users

### 📈 25. Usage Analytics
- [x] Event tracking for maps, filters, exports, and route analyses
- [ ] Dashboard with feature usage to prioritize the roadmap
- [x] Opt-in and anonymization for privacy-compliant tracking

### 🚀 26. Performance & Scaling
- [ ] Server-side pagination or streaming for large flight volumes
- [ ] Caching for frequent route/statistics queries (Redis - backend)
- [ ] Map layer clustering and lazy loading for charts/modules
- [ ] Performance regression checks in the CI/CD pipeline
- [ ] Stress tests for import/export to avoid conflicts and inconsistencies

#### 🗺️ Map Performance Optimizations
**Phase 1: Quick Wins** ✅ (implemented)
- [x] Route aggregation (one polyline per route instead of per flight)
- [x] Heatmap colors based on flight frequency (green→yellow→orange→red)
- [x] Enable canvas renderer (`preferCanvas` for faster rendering)
- [x] React.memo() for Map and AirportMarkers
- [x] useMemo() for route calculations and color logic
- [x] useCallback() for event handlers

**Phase 2: Clustering & Aggregation** (planned)
- [ ] Marker clustering for airports (react-leaflet-cluster)
- [ ] Polyline simplification with the Douglas-Peucker algorithm (simplify-js)
- [ ] Adaptive levels of detail based on zoom level
- [ ] Cluster statistics in popups

**Phase 3: Virtualization** (planned)
- [ ] Viewport culling (only render visible routes)
- [ ] Debouncing for map updates (lodash debounce)
- [ ] Lazy loading for AirportMarkers outside the viewport
- [ ] Progressive route loading (important routes first)

**Phase 4: WebGL Rendering** ✅ (implemented)
- [x] deck.gl 9.x + MapLibre GL 5.x integration for WebGL-accelerated rendering
- [x] ArcLayer for flight routes (Routes mode)
- [x] ScatterplotLayer for airports (Routes mode)
- [x] HeatmapLayer for frequency heatmap
- [x] HexagonLayer for 3D hexagon visualization
- [x] ColumnLayer for 3D columns per airport
- [x] TripsLayer with animated TimeSlider
- [x] Interactive layer controls (VisModeSelector)

**Expected performance gains:**
- Phase 1: 60-80% fewer DOM elements, 50% faster re-renders
- Phase 2: 70% fewer markers with many airports
- Phase 3: 80% fewer elements when zoomed out
- Phase 4: 10x performance with 1000+ flights

### 🛡️ 27. Security & Compliance Extensions
- [x] Rate limiting in the Express backend (100 req/15min)
- [ ] Log redaction for sensitive data
- [ ] Early planning for 2FA backend, session overview, and GDPR export/deletion
- [ ] Recurring dependency and secret scans (building on Phase 0)
- [x] End-to-end frontend and backend validation including schema hardening (Zod)
- [ ] Consistency checks on imports (e.g. duplicate routes/flights)

## Phase 9: Advanced Features (Week 15+)
*Nice-to-have features for power users*

### 🔍 28. Smart Search & Advanced Filters
- [ ] Full-text search across all fields
- [x] Combined filters (airline, date, status, tags)
- [ ] Saved searches
- [x] Quick filter chips

### 💺 29. Seat Preference Tracker
- [ ] Window vs. aisle statistics
- [ ] Best seats per aircraft type
- [ ] Seat map integration
- [ ] Preference recommendations

### 🎯 30. Goals & Bucket List
- [ ] Mark dream destinations
- [ ] Progress towards goals
- [ ] Inspiration for new destinations
- [ ] Price alerts (external integration)

### 🩺 31. Wellbeing & Jetlag Insights
- [ ] Jetlag and sleep score based on time zone changes
- [ ] Recommendations for sleep/hydration windows before and after flights
- [ ] Integration with existing time and distance statistics
- [ ] Optional logging for rest periods and workouts

---

## Technical Improvements (in parallel)

### Backend
- [x] PostgreSQL optimizations (indexes, relations)
- [ ] Caching layer (Redis)
- [x] API performance optimization (pagination)
- [x] Rate limiting (100 req/15min)
- [ ] Database backups (automated)

### Frontend
- [x] Performance optimization (Vite, code splitting)
- [x] Lazy loading for components (React.lazy in part)
- [ ] Optimistic UI updates
- [x] Improve error boundaries
- [x] Improve accessibility (A11y) (basics in place)

### Testing
- [x] Unit tests (Jest for backend)
- [x] Integration tests (Supertest)
- [ ] E2E tests (Playwright)
- [ ] Test coverage >80%
- [ ] **Boarding pass testing tools:**
  - [ ] Barcode generator for test data (IATA BCBP format)
  - [ ] Mock boarding pass generator (various airlines)
  - [ ] Automated scanner tests with generated barcodes

### DevOps
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Automated deployments
- [ ] Monitoring & logging (Winston/Pino)
- [ ] Error tracking (Sentry)

---

## Prioritization

**Must Have (MVP+):**
0, 1, 2, 3, 6, 8, 9, 13, 14, 15, 17, 18, 24, 25, 27

**Should Have:**
4, 5, 11, 12, 16, 26

**Could Have:**
7, 10, 19, 20, 21, 23, 28, 29, 30, 31

**Won't Have (for now):**
PWA (22), Social Features (19-21)

---

## Implementation Status

### ✅ Fully implemented:
- Phase 1: Core Visualizations (100%)
- Phase 2: Gamification & Achievements (100%)
- **Phase 5.5: Data Enrichment (100%)** 🎉
- **Map Performance Phase 4: WebGL Rendering (100%)** 🎉 — deck.gl 9.x with 6 visualization modes

### 🟡 Partially implemented:
- Phase 3: Practical Tools (~70% - settings UI present, backend partially)
- Phase 4: Environment & Analysis (~40% - route analysis and heatmap)
- **Phase 5: Import & Export (~75% - email upload, scanner, export without PDF)** 🆕
- Phase 8: Quality & Analytics (~40% - basics in place)

### ❌ Not implemented:
- Phase 0: CI/CD pipeline (0%)
- Phase 6: Sharing & Social (0%, except leaderboard)
- Phase 7: Mobile & PWA (0%, only responsive design)
- Phase 9: Advanced Features (10% - filters only)

---

*Last updated: 2026-03-10*
*Roadmap status based on actual code analysis*
### Add Flight UX Polish (Backlog)
- [ ] Further enrich boarding pass scan (gate/terminal/seat class/times) and clearly indicate API fallback
- [ ] Lookup error states (no backend/no API key) with clear hints in the dialog
- [ ] Consistently test dark mode for all Add Flight dialog parts including the scanner overlay
- [ ] Ergonomically scale input fields (width/height) and check responsiveness
- [ ] Add validation/tests for the new Add Flight flow (V2)
