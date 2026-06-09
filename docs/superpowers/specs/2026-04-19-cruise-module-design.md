# Cruise Module — Design

**Date:** 2026-04-19
**Status:** Draft (post-brainstorm)
**Companion spec:** [Multi-domain foundation design](2026-04-19-multi-domain-foundation-design.md)
**Depends on:** Foundation spec (DOMAIN registry, `enabledDomains`, Achievement `domain` column, generalized parser pipeline)

## Overview

Cruise is the first non-flight travel domain in the multi-domain TravStats. It covers ocean cruises (first target: the German market — AIDA, TUI "Mein Schiff", MSC, Costa, Hapag-Lloyd). River cruises are out of scope for V1 but the data model should not exclude them.

## Goals

- Let users log cruises with ship, route (port calls + sea days), cabin, booking details, price, and notes.
- Render cruises as a first-class layer on the shared map — visually distinct from flights.
- Provide a cruise-specific achievement catalog plus cross-domain (shared) achievements for countries and continents.
- Parse cruise booking confirmations (email/PDF/screenshot) via the existing parser stack, with seed templates for AIDA and TUI.
- Integrate with the existing Trip container so a single trip can combine flights and cruises.

## Non-goals (V1)

- Bord-Ausgaben (on-board expense tracking), excursion catalog, cabin-category pricing tiers. Deferred to V2 (the "rich" tier from the brainstorm).
- Live ship position tracking (MarineTraffic API). Out of scope.
- Realistic sea-route pathfinding that avoids continents. V1 uses curved Bézier arcs that approximate a sea look.
- River cruises. The schema accommodates them; dedicated UX deferred.

## Data model

Four new tables. All follow the project's existing Prisma conventions (`@map("snake_case")` columns, `@@map("snake_case")` table names, UUID primary keys for user-owned rows, integer PKs for seed catalogs).

Round-trip cruises (embark and disembark at the same port — typical for Med, Caribbean) are represented by `departurePortId == arrivalPortId`. No special flag is needed.

### `cruises`

```prisma
model Cruise {
  id               String    @id @default(uuid())
  userId           String    @map("user_id")
  shipId           Int?      @map("ship_id")           // → Ship (nullable for custom ships)
  shipNameOverride String?   @map("ship_name_override") // used when shipId is null
  cruiseLine       String?   @map("cruise_line")        // denormalized for search/achievements
  departurePortId  Int?      @map("departure_port_id")  // → Port
  arrivalPortId    Int?      @map("arrival_port_id")    // → Port
  startDate        DateTime? @map("start_date")
  endDate          DateTime? @map("end_date")
  status           String    @default("scheduled")      // scheduled | flown | cancelled | historical
  cabinNumber      String?   @map("cabin_number")
  cabinType        String?   @map("cabin_type")         // inside | oceanview | balcony | suite
  deck             Int?
  bookingReference String?   @map("booking_reference")
  price            Float?
  currency         String?   @default("EUR")
  notes            String?
  tags             String[]  @default([])
  companions       String[]  @default([])
  tripId           String?   @map("trip_id")
  bookingId        String?   @map("booking_id")
  parserTemplate   String?   @map("parser_template")
  parserConfidence Int?      @map("parser_confidence")
  dataSource       String?   @map("data_source")
  createdAt        DateTime  @default(now()) @map("created_at")

  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  ship    Ship?     @relation(fields: [shipId], references: [id], onDelete: SetNull)
  departurePort Port? @relation("CruiseDeparture", fields: [departurePortId], references: [id], onDelete: SetNull)
  arrivalPort   Port? @relation("CruiseArrival",   fields: [arrivalPortId],   references: [id], onDelete: SetNull)
  trip    Trip?     @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking Booking?  @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  stops   CruiseStop[]

  @@index([userId])
  @@index([startDate])
  @@index([status])
  @@index([cruiseLine])
  @@index([tripId])
  @@map("cruises")
}
```

### `cruise_stops`

```prisma
model CruiseStop {
  id            String    @id @default(uuid())
  cruiseId      String    @map("cruise_id")
  portId        Int?      @map("port_id")              // nullable for "at sea" days
  dayNumber     Int       @map("day_number")           // 1 = embarkation day
  isAtSea       Boolean   @default(false) @map("is_at_sea")
  arrivalTime   DateTime? @map("arrival_time")
  departureTime DateTime? @map("departure_time")
  excursionNote String?   @map("excursion_note")       // free text for V1; structured Excursion in V2

  cruise Cruise @relation(fields: [cruiseId], references: [id], onDelete: Cascade)
  port   Port?  @relation(fields: [portId], references: [id], onDelete: SetNull)

  @@index([cruiseId])
  @@index([portId])
  @@map("cruise_stops")
}
```

### `ships` (seed catalog)

```prisma
model Ship {
  id           Int      @id @default(autoincrement())
  name         String
  imo          String?  @unique  // IMO number, e.g. "9781865"
  cruiseLine   String   @map("cruise_line")  // AIDA Cruises, TUI Cruises, MSC, …
  yearBuilt    Int?     @map("year_built")
  grossTonnage Int?     @map("gross_tonnage")
  capacity     Int?     // passenger capacity
  status       String   @default("active")   // active | laid_up | scrapped
  isUserAdded  Boolean  @default(false) @map("is_user_added")

  cruises Cruise[]

  @@index([name])
  @@index([cruiseLine])
  @@index([imo])
  @@map("ships")
}
```

### `ports` (seed catalog)

```prisma
model Port {
  id       Int     @id @default(autoincrement())
  name     String
  city     String?
  country  String?
  unlocode String? @unique                      // e.g. "ESBCN" for Barcelona
  lat      Float
  lon      Float
  timezone String?
  region   String?                               // mediterranean | caribbean | baltic | norwegian_fjords | alaska | atlantic | pacific | polar | other
  isUserAdded Boolean @default(false) @map("is_user_added")

  cruisesDeparting Cruise[]     @relation("CruiseDeparture")
  cruisesArriving  Cruise[]     @relation("CruiseArrival")
  stops            CruiseStop[]

  @@index([name])
  @@index([city])
  @@index([unlocode])
  @@index([region])
  @@map("ports")
}
```

### Related changes

- `Trip.cruises: Cruise[]` relation added.
- `Booking.cruises: Cruise[]` relation added (parallel to `flights`).
- `User.cruises: Cruise[]` relation added.

## Seed strategy

CSV-based, identical pattern to `airports.csv`.

- `backend/src/seedData/ships.csv` — ~350 rows covering globally active cruise ships. Sources: CLIA directory + cruise-line Wikipedia lists (name, IMO, line, year built, tonnage, capacity). Curation is a one-shot human task done before V1 ships; incremental updates via PRs.
- `backend/src/seedData/ports.csv` — ~600 rows covering top cruise ports worldwide. Sources: UNLOCODE list + manual cruise-relevance filtering. Columns include `region` so revier-achievements work immediately.
- Seeding runs on fresh install and is idempotent (skip if row already exists by `imo` / `unlocode`).
- User can add custom ships/ports in-app via an "Add missing" dialog on the pickers. Custom rows get `isUserAdded = true` so they render with a subtle indicator and are not overwritten by seed refreshes.

## Parser templates

V1 ships two hand-authored `ParserTemplate` seeds (`domain = 'cruise'`):

1. **AIDA** — buchungsbestätigung / reiseunterlagen PDF + email. Covers ship, dates, cabin, deck, booking reference, ports.
2. **TUI "Mein Schiff"** — buchungsbestätigung email + PDF. Same fields.

Additional cruise lines (MSC, Costa, Hapag-Lloyd) are left to user-trained templates in V1. The existing training workflow in `/parser` applies unchanged.

A new `CruiseData` Zod schema lives in `backend/src/schemas/cruiseData.ts` and mirrors the shape of `FlightData` conceptually. The LLM system prompt branches on target schema (flight vs. cruise).

## Map layer (visualization tier B)

Cruise routes and ports render as a dedicated layer in the shared `/map` page.

- **Port markers** (deck.gl `ScatterplotLayer`): colored fill in the cruise-blue palette, thin white stroke, with a surrounding `ring` proportional to dwell time (clamped to a max radius).
- **Sea arcs** (deck.gl `LineLayer` or custom Bézier): curved from port to port, distinct from flight arcs by color (cyan-blue) and dash pattern. Curve control point offset from the great circle to give an "oceanic" feel without pathfinding.
- **Sea-day pills** (overlay text): rendered on long sea segments showing "Nd Sea" where N ≥ 1 consecutive at-sea days.
- **Globe mode** inherits the same arc geometries automatically.
- **Trips mode** (animated) is V2 — leaves the data model ready (per-port arrival/departure timestamps) but does not ship an animation in V1.

Layer toggle is labeled `🚢 Kreuzfahrten` and appears only when `'cruise' ∈ enabledDomains`.

## Achievement catalog

~27 cruise-only achievements across 8 categories, plus 5 shared achievements that cover both flights and cruises.

### Cruise-only (`domain = 'cruise'`)

| Category | Codes (tier progression) |
| --- | --- |
| Cruise count | first_cruise (B) · sea_explorer 5 (S) · cruise_enthusiast 10 (G) · seven_seas 25 (P) · neptunes_favorite 50 (D) |
| Ports | port_hopper 5 (B) · harbor_tour 25 (S) · harbor_master 50 (G) · mega_cruise 10+ ports in 1 cruise (P) |
| Ships | captains_log 1 (B) · fleet_sampler 5 (S) · naval_curator 15 (G) |
| Cruise line | loyal_sailor 3× same line (B) · line_hopper 5 lines (S) · carnival_collector all Carnival brands (G) |
| Sea days | sea_legs 1 (B) · salt_dog 30 total (S) · transatlantic 7+ in 1 cruise (G) |
| Regions | mediterranean (B) · caribbean (B) · baltic_or_fjords (S) · canal_transit Panama or Suez (G) · polar_explorer Antarctic or NW Passage (P) |
| Cabin | balcony_first (B) · suite_first (S) · top_deck deck ≥ 12 (G) |
| Special | birthday_at_sea (S) · new_years_at_sea (G) · cold_water_cruiser Iceland/Alaska/Antarctic (S) |

### Shared (`domain = 'shared'`)

Country count and continent count are upgraded to `'shared'` via the Foundation migration so that cruise ports contribute. New shared achievements:

| Code | Requirement |
| --- | --- |
| world_traveler | 25 distinct countries across flights + cruises (S) |
| globe_trekker | 50 distinct countries (G) |
| centurion | 100 distinct countries (D) |
| seven_continents_club | All 7 continents visited via any mode (P) |
| fly_and_sail | 1 Trip contains ≥1 flight AND ≥1 cruise (G) |

Achievement evaluation runs after any cruise insert/update, same mechanism as flights.

## Cruise detail page (hybrid B + C layout)

Route: `/cruises/:id`.

Layout (desktop):

- Ship-header strip (full width): ship icon (V1 uses a generic 🚢 glyph in a rounded tile tinted with the cruise-line accent color; per-ship photos deferred to V2), title, line, dates, cabin summary, stat pills (7 Tage · 5 Ports · 2 Seetage · 1.420 sm · Mediterranean · Status), Edit/Export actions.
- Two-column body:
  - **Left (≈60%)**: vertical port-call timeline. Each row = day + port + embark/disembark/at-sea marker + time window + excursion note (if any). Port calls are editable inline or via a modal.
  - **Right (≈40%, sticky)**: mini-map of the route (same visual as main map, scoped to this cruise) + info cards (Cabin, Costs, Notes/Tags/Companions).

Layout (mobile, below the Tailwind `md` breakpoint / 768 px):

- Ship header stacks.
- Map drops below the header, kompakt 16:10 aspect, tap to fullscreen.
- Timeline takes the full width.
- Info cards at the bottom.

Timeline component (`<TripTimeline />`) is built polymorphic (accepts flight + cruise event types) so the Trip detail view reuses it to render mixed flight + cruise schedules.

## Cruise list page

Route: `/cruises`.

- Table view equivalent to `/flights` but with cruise-native columns: Ship · Line · Dates · Ports count · Status · Cabin · Price.
- Sort selector: date · ship · line · ports · status.
- Filter: status, line, region, year.
- Row click → detail page.
- "Neue Kreuzfahrt" button triggers the create flow (form variant of the detail layout).

## Cruise edit / create

Single form with collapsible sections mirroring the detail-page layout:

1. Ship & Basics — ship picker (autocomplete against `Ship` table, with "Add new" for missing ships), line (auto-filled from ship, editable), dates, status.
2. Ports & Stops — embark/disembark port pickers (autocomplete against `Port` table), then a repeating list of stops (add/remove/reorder) with port picker, day number (auto-incremented), arrival/departure times, "At sea" toggle, optional excursion note.
3. Cabin — cabin number, type (select), deck.
4. Costs — booking reference, price, currency. Bord-Ausgaben/Trinkgelder deferred to V2.
5. Meta — tags, companions, notes, category.

Zod schema: `CruiseInput` in `backend/src/schemas/cruise.ts`. Mirrors the pattern of `FlightInput`. Null-coercion rules mirror flights (Prisma-nullable columns need `|| undefined`).

## Trip integration

`Trip.cruises: Cruise[]` added. Trip detail view lists flights + cruises + future hotels in a unified `<TripTimeline />` component, sorted by start date. The "Fly & Sail" shared achievement detects a trip with at least one flight and one cruise.

## Parser page changes

- Domain picker appears in the Parser page header when multiple domains are enabled. Default selects flight (existing behavior).
- When "Cruise" is selected, the template list filters to `domain = 'cruise'` templates.
- Upload zone accepts the same file types (.msg, .pdf, images) — the routing is based on the selected domain, not file type.

## i18n

German primary, English secondary (project language policy).

New i18n namespace: `cruise`. Keys include:

- `cruise.nav.link` → "Kreuzfahrten" / "Cruises"
- `cruise.list.new` → "Neue Kreuzfahrt" / "New cruise"
- `cruise.field.ship` → "Schiff" / "Ship"
- `cruise.field.cabin` → "Kabine" / "Cabin"
- `cruise.field.sea_days` → "Seetage" / "Sea days"
- `cruise.stops.at_sea` → "Auf See" / "At sea"
- Achievement names and descriptions for the ~27 cruise + 5 shared codes.

Achievement copy is bundled in `achievements` namespace alongside existing flight achievement strings.

## Dependencies on Foundation

This spec cannot ship without the Foundation spec delivering:

- DOMAIN registry including `cruise`.
- `UserSettings.enabledDomains` column and Settings UI toggle.
- Setup wizard domain step.
- `Achievement.domain` column.
- `ParserTemplate.domain` column.
- Cross-domain Trip timeline component.

Foundation can ship without Cruise (no-op feature flag until `AVAILABLE_DOMAINS` includes `cruise`), but the product value lands when both specs are implemented together.

## V2 candidates (deferred)

Parked for later, listed so the V1 schema leaves room:

- `CruiseLine` model (Reederei as a first-class entity with logo, brand color, parent company).
- `Excursion` model per `CruiseStop` (type, price, rating, photos).
- `CruiseExpense` model for on-board spending (drinks, spa, wifi, tips).
- Animated trips-layer mode for cruises (ship icon moving along route with time slider).
- Realistic sea-route pathfinding (pre-computed ocean grid).
- River cruises (dedicated UX + seeded river ports).
- MarineTraffic integration for live ship position + IMO-based auto-fill.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Ship / Port seeds stale over time | CSV files committed to repo; user can add custom rows; periodic refresh PR is a maintenance task, not a runtime dependency |
| AIDA / TUI template breaks on layout change | User can re-train via existing ParserTemplate workflow; template breakage is a soft failure (LLM still extracts) |
| Curved sea arcs cross continents | Accepted cosmetic flaw for V1; documented; pathfinding is V2 |
| Achievement re-computation is expensive on backfill | Run migration once per user as a background job, not inline on login |
| Cruise data imported into a disabled cruise module | Parser entry points are gated on `enabledDomains`; imports from API would be the risk but there is no cruise API integration in V1 |

## Branch strategy

Implemented on the same local dev branch as Foundation (`dev/multi-domain-v1` or equivalent). No commits to `main`, no deploy until the user promotes. Cruise spec work can be interleaved with Foundation work since the data layer changes are disjoint.
