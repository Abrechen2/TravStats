# Cruise Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Cruise domain end-to-end on top of the multi-domain foundation — data model, seed catalogs (ships + ports), CRUD API, list / detail / edit UI, shared-map layer, parser templates (AIDA, TUI), and achievement catalog. After the final task, flipping `cruise.available = true` surfaces the domain to users who enable it.

**Architecture:** Four new Prisma tables (`Cruise`, `CruiseStop`, `Ship`, `Port`), each following the existing conventions (UUID PKs for user data, integer PKs for seed catalogs, `@map("snake_case")`). Seeds are CSV-backed and idempotent, mirroring `airports.csv`. Cruise API is a standard Express+Zod router. Frontend adds cruise pages + a `CruiseArcsLayer` / `CruisePortsLayer` to the shared deck.gl map. Achievements extend the existing seed pipeline with a new Part C file. Parser infra reuses the generalized Foundation pipeline with a new `CruiseData` schema.

**Tech Stack:** Prisma + PostgreSQL, Express + TypeScript, Zod, React + Vite + Tailwind, Zustand, react-i18next, deck.gl 9.x + MapLibre, Vitest (frontend) + Jest (backend) + Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-04-19-cruise-module-design.md`](../specs/2026-04-19-cruise-module-design.md)

**Companion spec:** [`docs/superpowers/specs/2026-04-19-multi-domain-foundation-design.md`](../specs/2026-04-19-multi-domain-foundation-design.md)

**Depends on:** Multi-domain foundation plan (already executed — commits through `ccecaec`).

**Branch:** `dev/multi-domain-v1` (local only, do not push, do not deploy until the user promotes).

---

## Implementation Status — 2026-04-21

This plan was written prospectively on 2026-04-19 (170 unchecked tasks)
but execution happened in parallel with other work, so the per-task
checkboxes in Phases 1–8 below are not maintained. The actual state,
verified against the codebase on 2026-04-21:

| Phase | Status | Evidence |
|---|---|---|
| 1. Data model | **DONE** | `Cruise`/`CruiseStop`/`Ship`/`Port` in schema.prisma + migrations landed |
| 2. Seed catalogs | **DONE** | ships.csv + ports.csv + idempotent seeders wired in `backend/src/index.ts` |
| 3. Lookup APIs | **DONE** | `/api/v1/cruises`, `/api/v1/ships`, `/api/v1/ports` all registered |
| 4. Cruise CRUD API | **DONE** | `routes/cruises.ts` + `schemas/cruise.ts` complete, tests present |
| 5. Frontend types + API client | **DONE** | `lib/api/cruise.ts`, `types/cruise.ts`, `i18n/resources/{de,en}/cruise.json` |
| 6. Frontend pages | **DONE** | CruisesPage, CruiseDetailPage, CruiseEditModal, ShipPicker, PortPicker, CruiseStopsEditor |
| 7. Map layer | **DONE** | Cruise arcs + ports layers; sea-router migrated to Hybrid v2 in commit `caf9a33` |
| 8. Achievements | **DONE** | `achievementSeeds/partC.ts` (32 cruise + shared); partA/B tagged with domain |
| 9. Parser integration | **OPEN** | CruiseData schema exists; no `cruiseTemplates/` dir, no AIDA/TUI templates, no LLM branching |
| 10. Trip + Activation | **MOSTLY** | Domain is already `cruise.available = true`; trips include cruises; AdvancedStats has CruiseStatsSection. **Missing:** DashboardPage cruise KPI card, CLAUDE.md gotchas paragraph |

**The app is functionally shippable today** — a user who enables the
cruise domain gets the full CRUD + map + achievements + stats
experience. What's genuinely still open:

1. **Phase 9.2** — Parser templates for AIDA + TUI booking confirmations
2. **Phase 9.3** — LLM prompt branching on `domain=cruise`
3. **Phase 10.2a** — DashboardPage cruise KPI card (count + next upcoming)
4. **Phase 10.2b** — Smoke-test the parser-page domain picker once cruise templates exist
5. **Phase 10.4** — Add the cruise gotchas paragraph to CLAUDE.md (stop union, idempotent seeds, Bezier arcs — partially already there, verify + round out)

Per-phase checkboxes below preserve the original plan shape for
reference; treat them as historic intent, not a live worklist.

---

## File Structure

### New backend files

- `backend/src/schemas/cruise.ts` — Zod `createCruiseSchema`, `updateCruiseSchema`, `cruiseQuerySchema`, `CruiseInput` type
- `backend/src/schemas/cruiseData.ts` — Zod `CruiseData` (parser output shape), analogous to `FlightData`
- `backend/src/schemas/__tests__/cruise.test.ts`
- `backend/src/routes/cruises.ts` — CRUD router
- `backend/src/routes/ships.ts` — ship lookup + add-custom endpoint
- `backend/src/routes/ports.ts` — port lookup + add-custom endpoint
- `backend/src/routes/__tests__/cruises.test.ts`
- `backend/src/routes/__tests__/ports.test.ts`
- `backend/src/routes/__tests__/ships.test.ts`
- `backend/src/seedData/ships.csv` — curated ~350-row ship catalog
- `backend/src/seedData/ports.csv` — curated ~600-row port catalog
- `backend/src/seedShipsFromCSV.ts` — idempotent seeder
- `backend/src/seedPortsFromCSV.ts` — idempotent seeder
- `backend/src/__tests__/seedShipsFromCSV.test.ts`
- `backend/src/__tests__/seedPortsFromCSV.test.ts`
- `backend/src/services/parsers/cruiseTemplates/aida.ts` — seed template
- `backend/src/services/parsers/cruiseTemplates/tui.ts` — seed template
- `backend/src/services/parsers/cruiseTemplates/index.ts` — registry
- `backend/src/utils/cruiseStats.ts` — computes cruise-specific stats for achievements
- `backend/src/utils/__tests__/cruiseStats.test.ts`
- `backend/src/data/achievementSeeds/partC.ts` — cruise + new shared achievements
- `backend/src/data/__tests__/partC.test.ts`
- `backend/prisma/migrations/<timestamp>_cruise_module/migration.sql` — generated

### Modified backend files

- `backend/prisma/schema.prisma` — add `Cruise`, `CruiseStop`, `Ship`, `Port` models; add relations on `User`, `Trip`, `Booking`
- `backend/src/index.ts` — register `/api/v1/cruises`, `/api/v1/ships`, `/api/v1/ports` routers; run new seeders on boot
- `backend/src/shared/domains.ts` — flip `cruise.available` to `true` (last task of this plan)
- `backend/src/data/achievements.ts` — compose `seedsPartC` into the exported list
- `backend/src/data/achievementSeeds/partA.ts` and `partB.ts` — add `domain` field to each definition (default `'flight'`), upgrade country/continent achievements to `domain: 'shared'`
- `backend/src/utils/achievementStats.ts` — extend `UserStats` + `calculateUserStats` with cruise stats; accept `CruiseData[]` alongside `FlightData[]`
- `backend/src/utils/achievementChecks.ts` — add cases for new `requirementType` values (`cruises_count`, `cruise_ports`, `sea_days`, …)
- `backend/src/utils/achievements.ts` — fetch cruises alongside flights before calling `calculateUserStats`
- `backend/src/services/parsers/registry.ts` (or equivalent — match the file that Foundation's parser work produced) — wire cruise templates
- `backend/src/routes/trips.ts` — include `cruises` in trip responses

### New frontend files

- `frontend/src/pages/CruisesPage.tsx` — cruise list table
- `frontend/src/pages/CruiseDetailPage.tsx` — detail (ship header + timeline + map + info cards)
- `frontend/src/components/Cruise/CruiseEditModal.tsx` — create / edit form
- `frontend/src/components/Cruise/CruiseRow.tsx` — list row component
- `frontend/src/components/Cruise/ShipPicker.tsx` — autocomplete + "add custom"
- `frontend/src/components/Cruise/PortPicker.tsx` — autocomplete + "add custom"
- `frontend/src/components/Cruise/CruiseStopsEditor.tsx` — stops list with add / remove / reorder
- `frontend/src/components/Map/CruiseArcsLayer.ts` — deck.gl `LineLayer` wrapper
- `frontend/src/components/Map/CruisePortsLayer.ts` — deck.gl `ScatterplotLayer` wrapper
- `frontend/src/components/Map/cruiseArc.ts` — curved-arc geometry helper (Bézier)
- `frontend/src/lib/cruiseApi.ts` — API client
- `frontend/src/types/cruise.ts` — `Cruise`, `CruiseStop`, `Ship`, `Port` TS types
- `frontend/src/i18n/resources/de/cruise.json`
- `frontend/src/i18n/resources/en/cruise.json`
- `frontend/src/__tests__/components/CruiseEditModal.test.tsx`
- `frontend/src/__tests__/components/ShipPicker.test.tsx`
- `frontend/src/__tests__/components/PortPicker.test.tsx`
- `frontend/src/__tests__/components/CruiseStopsEditor.test.tsx`
- `frontend/src/__tests__/lib/cruiseApi.test.ts`
- `frontend/src/__tests__/map/cruiseArc.test.ts`

### Modified frontend files

- `frontend/src/App.tsx` — add `/cruises` and `/cruises/:id` routes, gated by `useEnabledDomains`
- `frontend/src/components/NavigationBar.tsx` — add Cruise nav link (already domain-gated by Foundation)
- `frontend/src/i18n/config.ts` — register `cruise` namespace
- `frontend/src/shared/domains.ts` — flip `cruise.available` to `true` (last task of this plan)
- `frontend/src/components/Map/MapContainer3D.tsx` — mount cruise layers + cruise toggle
- `frontend/src/components/Map/VisModeSelector.tsx` — add "Kreuzfahrten" layer toggle (domain-gated)
- `frontend/src/pages/AdvancedStatsPage.tsx` — add cruise KPI cards when `cruise` enabled
- `frontend/src/pages/DashboardPage.tsx` — add cruise section when `cruise` enabled
- `frontend/src/pages/AchievementsPage.tsx` — pick up cruise + new shared achievements via existing domain filter
- `frontend/src/pages/ParserPage.tsx` — domain picker (already wired by Foundation) filters cruise templates
- `frontend/src/pages/SettingsPage.tsx` — no change needed; ModuleSection already exists

---

## Phase 1 — Data model

Four Prisma tables + Zod schemas. Migration is non-destructive (pure adds). No code consumes the new models yet.

### Task 1.1: Prisma models

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Append the `Cruise` model after `Booking` (end of file)**

```prisma
model Cruise {
  id               String    @id @default(uuid())
  userId           String    @map("user_id")
  shipId           Int?      @map("ship_id")
  shipNameOverride String?   @map("ship_name_override")
  cruiseLine       String?   @map("cruise_line")
  departurePortId  Int?      @map("departure_port_id")
  arrivalPortId    Int?      @map("arrival_port_id")
  startDate        DateTime? @map("start_date")
  endDate          DateTime? @map("end_date")
  status           String    @default("scheduled")
  cabinNumber      String?   @map("cabin_number")
  cabinType        String?   @map("cabin_type")
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

  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  ship          Ship?        @relation(fields: [shipId], references: [id], onDelete: SetNull)
  departurePort Port?        @relation("CruiseDeparture", fields: [departurePortId], references: [id], onDelete: SetNull)
  arrivalPort   Port?        @relation("CruiseArrival",   fields: [arrivalPortId],   references: [id], onDelete: SetNull)
  trip          Trip?        @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking       Booking?     @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  stops         CruiseStop[]

  @@index([userId])
  @@index([startDate])
  @@index([status])
  @@index([cruiseLine])
  @@index([tripId])
  @@map("cruises")
}
```

- [ ] **Step 2: Append the `CruiseStop` model**

```prisma
model CruiseStop {
  id            String    @id @default(uuid())
  cruiseId      String    @map("cruise_id")
  portId        Int?      @map("port_id")
  dayNumber     Int       @map("day_number")
  isAtSea       Boolean   @default(false) @map("is_at_sea")
  arrivalTime   DateTime? @map("arrival_time")
  departureTime DateTime? @map("departure_time")
  excursionNote String?   @map("excursion_note")

  cruise Cruise @relation(fields: [cruiseId], references: [id], onDelete: Cascade)
  port   Port?  @relation(fields: [portId], references: [id], onDelete: SetNull)

  @@index([cruiseId])
  @@index([portId])
  @@map("cruise_stops")
}
```

- [ ] **Step 3: Append the `Ship` seed-catalog model**

```prisma
model Ship {
  id           Int      @id @default(autoincrement())
  name         String
  imo          String?  @unique
  cruiseLine   String   @map("cruise_line")
  yearBuilt    Int?     @map("year_built")
  grossTonnage Int?     @map("gross_tonnage")
  capacity     Int?
  status       String   @default("active")
  isUserAdded  Boolean  @default(false) @map("is_user_added")

  cruises Cruise[]

  @@index([name])
  @@index([cruiseLine])
  @@index([imo])
  @@map("ships")
}
```

- [ ] **Step 4: Append the `Port` seed-catalog model**

```prisma
model Port {
  id          Int     @id @default(autoincrement())
  name        String
  city        String?
  country     String?
  unlocode    String? @unique
  lat         Float
  lon         Float
  timezone    String?
  region      String?
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

- [ ] **Step 5: Add reverse relations to `User`, `Trip`, `Booking`**

In `model User { ... }`, append inside the relations block:

```prisma
  cruises Cruise[]
```

In `model Trip { ... }`, append:

```prisma
  cruises Cruise[]
```

In `model Booking { ... }`, append:

```prisma
  cruises Cruise[]
```

- [ ] **Step 6: Generate migration**

Run:

```bash
cd backend && npx prisma migrate dev --name cruise_module --create-only
```

Expected: a new folder `backend/prisma/migrations/<timestamp>_cruise_module/migration.sql` is created. Review the generated SQL — it should contain four `CREATE TABLE` statements (cruises, cruise_stops, ships, ports), the indexes declared above, and no destructive ops.

- [ ] **Step 7: Apply migration**

Run:

```bash
cd backend && npx prisma migrate dev
```

Expected: migration applies cleanly against the local dev DB; `npx prisma generate` runs automatically.

- [ ] **Step 8: Verify compilation**

Run:

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors. Prisma Client now exposes `prisma.cruise`, `prisma.cruiseStop`, `prisma.ship`, `prisma.port`.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(cruise): add Cruise, CruiseStop, Ship, Port Prisma models"
```

### Task 1.2: Cruise Zod schemas

**Files:**
- Create: `backend/src/schemas/cruise.ts`
- Create: `backend/src/schemas/__tests__/cruise.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/schemas/__tests__/cruise.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from '../cruise';

describe('cruise schemas', () => {
  const minimalValid = {
    status: 'scheduled' as const,
  };

  it('accepts a minimal cruise', () => {
    const result = createCruiseSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
  });

  it('accepts a full cruise with stops', () => {
    const result = createCruiseSchema.safeParse({
      shipId: 42,
      cruiseLine: 'AIDA Cruises',
      departurePortId: 1,
      arrivalPortId: 1,
      startDate: '2026-06-01T12:00:00Z',
      endDate: '2026-06-08T09:00:00Z',
      status: 'scheduled',
      cabinNumber: '7218',
      cabinType: 'balcony',
      deck: 7,
      bookingReference: 'AIDA-XYZ',
      price: 1299.99,
      currency: 'EUR',
      tags: ['family'],
      companions: ['Alice'],
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, arrivalTime: '2026-06-01T12:00:00Z', departureTime: '2026-06-01T18:00:00Z' },
        { portId: null, dayNumber: 2, isAtSea: true },
        { portId: 2, dayNumber: 3, isAtSea: false, arrivalTime: '2026-06-03T07:00:00Z', departureTime: '2026-06-03T19:00:00Z', excursionNote: 'City tour' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid cabinType', () => {
    const result = createCruiseSchema.safeParse({ ...minimalValid, cabinType: 'penthouse' });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = createCruiseSchema.safeParse({ ...minimalValid, price: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects dayNumber < 1', () => {
    const result = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ dayNumber: 0, isAtSea: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects stop that is neither atSea nor has a portId', () => {
    const result = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ dayNumber: 1, isAtSea: false, portId: null }],
    });
    expect(result.success).toBe(false);
  });

  it('updateCruiseSchema requires at least one field', () => {
    const result = updateCruiseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('cruiseQuerySchema accepts line filter', () => {
    const result = cruiseQuerySchema.safeParse({ cruiseLine: 'AIDA' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest schemas/__tests__/cruise -- --forceExit`
Expected: FAIL — `createCruiseSchema` not found.

- [ ] **Step 3: Write the schema**

`backend/src/schemas/cruise.ts`:

```typescript
import { z } from 'zod';

const CABIN_TYPES = ['inside', 'oceanview', 'balcony', 'suite'] as const;
const STATUSES = ['scheduled', 'flown', 'cancelled', 'historical'] as const;
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const emptyToUndefined = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const stopSchema = z
  .object({
    portId: z.number().int().positive().nullable().optional(),
    dayNumber: z.number().int().min(1).max(365),
    isAtSea: z.boolean().default(false),
    arrivalTime: z.string().datetime().nullable().optional(),
    departureTime: z.string().datetime().nullable().optional(),
    excursionNote: z.string().max(500).optional(),
  })
  .refine((s) => s.isAtSea || (s.portId !== null && s.portId !== undefined), {
    message: 'A stop must either be at sea or reference a port',
    path: ['portId'],
  });

const baseCruiseSchema = z.object({
  shipId: z.number().int().positive().nullable().optional(),
  shipNameOverride: emptyToUndefined,
  cruiseLine: emptyToUndefined,
  departurePortId: z.number().int().positive().nullable().optional(),
  arrivalPortId: z.number().int().positive().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  status: z.enum(STATUSES).default('scheduled'),
  cabinNumber: z.string().max(20).optional(),
  cabinType: z.enum(CABIN_TYPES).optional(),
  deck: z.number().int().min(1).max(30).optional(),
  bookingReference: z.string().max(40).optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(CURRENCIES).optional(),
  notes: z
    .string()
    .transform((v) => v.replace(/<[^>]*>/g, ''))
    .optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  stops: z.array(stopSchema).max(60).optional(),
});

export const createCruiseSchema = baseCruiseSchema.refine(
  (data) => {
    if (!data.startDate || !data.endDate) return true;
    return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
  },
  { message: 'endDate must not precede startDate', path: ['endDate'] },
);

export const updateCruiseSchema = baseCruiseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const cruiseQuerySchema = z.object({
  status: z.union([z.enum(STATUSES), z.array(z.enum(STATUSES))]).optional(),
  cruiseLine: z.union([z.string(), z.array(z.string())]).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  region: z.string().optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['date', 'ship', 'line', 'ports', 'status']).optional(),
});

export type CruiseInput = z.infer<typeof baseCruiseSchema>;
export type CruiseQueryInput = z.infer<typeof cruiseQuerySchema>;
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd backend && npx jest schemas/__tests__/cruise -- --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/cruise.ts backend/src/schemas/__tests__/cruise.test.ts
git commit -m "feat(cruise): Zod schemas for cruise input + query"
```

---

## Phase 2 — Seed catalogs

Ships and ports ship as CSV files committed to the repo; a boot-time seeder imports idempotently. Curation of the full CSV content is a human task — the plan seeds a small starter set and sets up the infrastructure.

### Task 2.1: Starter ships.csv

**Files:**
- Create: `backend/src/seedData/ships.csv`

- [ ] **Step 1: Write starter CSV (30 ships, representative of the AIDA / TUI / MSC / Costa / Royal / Carnival / NCL / Hapag-Lloyd fleets)**

`backend/src/seedData/ships.csv`:

```csv
name,imo,cruise_line,year_built,gross_tonnage,capacity,status
AIDAnova,9781865,AIDA Cruises,2018,183900,6600,active
AIDAcosma,9781877,AIDA Cruises,2021,183900,6600,active
AIDAprima,9636262,AIDA Cruises,2016,125572,3300,active
AIDAperla,9636274,AIDA Cruises,2017,125572,3300,active
AIDAmar,9490052,AIDA Cruises,2012,71304,2192,active
AIDAbella,9398888,AIDA Cruises,2008,69203,2192,active
AIDAblu,9398876,AIDA Cruises,2010,71304,2192,active
AIDAluna,9490040,AIDA Cruises,2009,71304,2192,active
AIDAsol,9490038,AIDA Cruises,2011,71304,2192,active
AIDAstella,9601132,AIDA Cruises,2013,71304,2192,active
Mein Schiff 1,9783564,TUI Cruises,2018,111554,2894,active
Mein Schiff 2,9834624,TUI Cruises,2019,111554,2894,active
Mein Schiff 3,9641730,TUI Cruises,2014,99526,2506,active
Mein Schiff 4,9678408,TUI Cruises,2015,99526,2506,active
Mein Schiff 5,9710139,TUI Cruises,2016,99526,2534,active
Mein Schiff 6,9753193,TUI Cruises,2017,99526,2534,active
Mein Schiff 7,9790153,TUI Cruises,2024,111554,2894,active
MSC World Europa,9803613,MSC Cruises,2022,215863,6762,active
MSC Grandiosa,9803585,MSC Cruises,2019,181541,6334,active
MSC Virtuosa,9803597,MSC Cruises,2021,181541,6334,active
MSC Seaside,9745377,MSC Cruises,2017,153516,4540,active
MSC Meraviglia,9760231,MSC Cruises,2017,171598,5714,active
Costa Toscana,9781841,Costa Cruises,2022,185010,6554,active
Costa Smeralda,9781839,Costa Cruises,2019,185010,6554,active
Costa Fascinosa,9479744,Costa Cruises,2012,114147,3800,active
Wonder of the Seas,9838583,Royal Caribbean International,2022,236857,6988,active
Icon of the Seas,9838622,Royal Caribbean International,2024,250800,7600,active
Carnival Celebration,9837785,Carnival Cruise Line,2022,183521,6631,active
Norwegian Prima,9870553,Norwegian Cruise Line,2022,142500,3215,active
Europa 2,9616230,Hapag-Lloyd Cruises,2013,42830,500,active
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/seedData/ships.csv
git commit -m "feat(cruise): seed ships starter CSV (AIDA/TUI/MSC/Costa/Royal/Carnival/NCL/HLC)"
```

### Task 2.2: Starter ports.csv

**Files:**
- Create: `backend/src/seedData/ports.csv`

- [ ] **Step 1: Write starter CSV (50 cruise ports covering Mediterranean, Baltic, Norwegian Fjords, Caribbean, Alaska, Atlantic)**

`backend/src/seedData/ports.csv`:

```csv
name,city,country,unlocode,lat,lon,timezone,region
Hamburg,Hamburg,Germany,DEHAM,53.5400,9.9700,Europe/Berlin,atlantic
Kiel,Kiel,Germany,DEKEL,54.3200,10.1333,Europe/Berlin,baltic
Rostock-Warnemünde,Rostock,Germany,DERSK,54.1833,12.0833,Europe/Berlin,baltic
Bremerhaven,Bremerhaven,Germany,DEBRV,53.5500,8.5833,Europe/Berlin,atlantic
Amsterdam,Amsterdam,Netherlands,NLAMS,52.3833,4.9000,Europe/Amsterdam,atlantic
Rotterdam,Rotterdam,Netherlands,NLRTM,51.9000,4.4833,Europe/Amsterdam,atlantic
Southampton,Southampton,United Kingdom,GBSOU,50.9000,-1.4000,Europe/London,atlantic
Copenhagen,Copenhagen,Denmark,DKCPH,55.6867,12.5700,Europe/Copenhagen,baltic
Stockholm,Stockholm,Sweden,SESTO,59.3300,18.0600,Europe/Stockholm,baltic
Helsinki,Helsinki,Finland,FIHEL,60.1700,24.9400,Europe/Helsinki,baltic
Tallinn,Tallinn,Estonia,EETLL,59.4400,24.7500,Europe/Tallinn,baltic
Gdańsk,Gdańsk,Poland,PLGDN,54.3500,18.6500,Europe/Warsaw,baltic
Oslo,Oslo,Norway,NOOSL,59.9100,10.7500,Europe/Oslo,norwegian_fjords
Bergen,Bergen,Norway,NOBGO,60.3900,5.3200,Europe/Oslo,norwegian_fjords
Geiranger,Geiranger,Norway,NOGEI,62.1000,7.2000,Europe/Oslo,norwegian_fjords
Flåm,Flåm,Norway,NOFLM,60.8600,7.1100,Europe/Oslo,norwegian_fjords
Ålesund,Ålesund,Norway,NOAES,62.4700,6.1500,Europe/Oslo,norwegian_fjords
Tromsø,Tromsø,Norway,NOTOS,69.6500,18.9600,Europe/Oslo,norwegian_fjords
Barcelona,Barcelona,Spain,ESBCN,41.3500,2.1700,Europe/Madrid,mediterranean
Palma de Mallorca,Palma,Spain,ESPMI,39.5700,2.6500,Europe/Madrid,mediterranean
Málaga,Málaga,Spain,ESAGP,36.7200,-4.4200,Europe/Madrid,mediterranean
Valencia,Valencia,Spain,ESVLC,39.4700,-0.3800,Europe/Madrid,mediterranean
Marseille,Marseille,France,FRMRS,43.3000,5.3700,Europe/Paris,mediterranean
Nice,Nice,France,FRNCE,43.7000,7.2700,Europe/Paris,mediterranean
Genoa,Genoa,Italy,ITGOA,44.4100,8.9300,Europe/Rome,mediterranean
Civitavecchia,Civitavecchia,Italy,ITCVV,42.0900,11.8000,Europe/Rome,mediterranean
Naples,Naples,Italy,ITNAP,40.8400,14.2500,Europe/Rome,mediterranean
Venice,Venice,Italy,ITVCE,45.4300,12.3300,Europe/Rome,mediterranean
Dubrovnik,Dubrovnik,Croatia,HRDBV,42.6500,18.0900,Europe/Zagreb,mediterranean
Athens (Piraeus),Athens,Greece,GRPIR,37.9400,23.6400,Europe/Athens,mediterranean
Santorini,Santorini,Greece,GRJTR,36.4200,25.4300,Europe/Athens,mediterranean
Mykonos,Mykonos,Greece,GRJMK,37.4500,25.3300,Europe/Athens,mediterranean
Istanbul,Istanbul,Türkiye,TRIST,41.0100,28.9800,Europe/Istanbul,mediterranean
Kuşadası,Kuşadası,Türkiye,TRKUS,37.8600,27.2600,Europe/Istanbul,mediterranean
Funchal,Funchal,Portugal,PTFNC,32.6500,-16.9100,Atlantic/Madeira,atlantic
Lisbon,Lisbon,Portugal,PTLIS,38.7200,-9.1300,Europe/Lisbon,atlantic
Las Palmas,Las Palmas,Spain,ESLPA,28.1200,-15.4300,Atlantic/Canary,atlantic
Miami,Miami,United States,USMIA,25.7700,-80.1800,America/New_York,caribbean
Fort Lauderdale,Fort Lauderdale,United States,USFLL,26.1200,-80.1400,America/New_York,caribbean
Port Canaveral,Cape Canaveral,United States,USPCV,28.4100,-80.6100,America/New_York,caribbean
Nassau,Nassau,Bahamas,BSNAS,25.0800,-77.3400,America/Nassau,caribbean
San Juan,San Juan,Puerto Rico,PRSJU,18.4700,-66.1200,America/Puerto_Rico,caribbean
Cozumel,Cozumel,Mexico,MXCZM,20.5100,-86.9500,America/Cancun,caribbean
Bridgetown,Bridgetown,Barbados,BBBGI,13.1000,-59.6200,America/Barbados,caribbean
St. Thomas,Charlotte Amalie,US Virgin Islands,VISTT,18.3400,-64.9300,America/St_Thomas,caribbean
Seward,Seward,United States,USSWD,60.1200,-149.4400,America/Anchorage,alaska
Juneau,Juneau,United States,USJNU,58.3000,-134.4000,America/Juneau,alaska
Ketchikan,Ketchikan,United States,USKTN,55.3400,-131.6500,America/Juneau,alaska
Skagway,Skagway,United States,USSKW,59.4500,-135.3200,America/Juneau,alaska
Vancouver,Vancouver,Canada,CAVAN,49.2800,-123.1200,America/Vancouver,alaska
Panama Canal (Colón),Colón,Panama,PACTB,9.3600,-79.8700,America/Panama,atlantic
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/seedData/ports.csv
git commit -m "feat(cruise): seed ports starter CSV (Med/Baltic/Fjords/Caribbean/Alaska/Atlantic)"
```

### Task 2.3: Ports seeder

**Files:**
- Create: `backend/src/seedPortsFromCSV.ts`
- Create: `backend/src/__tests__/seedPortsFromCSV.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/__tests__/seedPortsFromCSV.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { prisma } from '../db';
import { seedPortsFromCSV } from '../seedPortsFromCSV';

describe('seedPortsFromCSV', () => {
  beforeEach(async () => {
    await prisma.port.deleteMany({ where: { isUserAdded: false } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('inserts all rows from the CSV on a fresh DB', async () => {
    const count = await seedPortsFromCSV();
    expect(count).toBeGreaterThanOrEqual(50);
    const rows = await prisma.port.count();
    expect(rows).toBe(count);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    const first = await seedPortsFromCSV();
    const second = await seedPortsFromCSV();
    expect(second).toBe(0);
    const rows = await prisma.port.count();
    expect(rows).toBe(first);
  });

  it('does not overwrite rows flagged isUserAdded', async () => {
    const p = await prisma.port.create({
      data: { name: 'Hamburg', city: 'Hamburg', country: 'Germany', unlocode: 'DEHAM', lat: 0, lon: 0, isUserAdded: true },
    });
    await seedPortsFromCSV();
    const reloaded = await prisma.port.findUnique({ where: { id: p.id } });
    expect(reloaded?.lat).toBe(0);
    expect(reloaded?.isUserAdded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest __tests__/seedPortsFromCSV -- --forceExit`
Expected: FAIL — `seedPortsFromCSV` not found.

- [ ] **Step 3: Write the seeder**

`backend/src/seedPortsFromCSV.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { prisma } from './db';
import logger from './utils/logger';

interface CSVPort {
  name: string;
  city: string;
  country: string;
  unlocode: string;
  lat: string;
  lon: string;
  timezone: string;
  region: string;
}

const CSV_PATH = path.resolve(__dirname, 'seedData', 'ports.csv');

export async function seedPortsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: 'seed_ports_skip', reason: 'csv_missing', path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CSVPort[];

  let inserted = 0;
  for (const row of rows) {
    if (!row.name || !row.lat || !row.lon) continue;

    const unlocode = row.unlocode?.trim() || null;
    if (unlocode) {
      const existing = await prisma.port.findUnique({ where: { unlocode } });
      if (existing) continue;
    }

    await prisma.port.create({
      data: {
        name: row.name.trim(),
        city: row.city?.trim() || null,
        country: row.country?.trim() || null,
        unlocode,
        lat: Number.parseFloat(row.lat),
        lon: Number.parseFloat(row.lon),
        timezone: row.timezone?.trim() || null,
        region: row.region?.trim() || null,
        isUserAdded: false,
      },
    });
    inserted += 1;
  }

  logger.info({ operation: 'seed_ports_done', inserted });
  return inserted;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd backend && npx jest __tests__/seedPortsFromCSV -- --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedPortsFromCSV.ts backend/src/__tests__/seedPortsFromCSV.test.ts
git commit -m "feat(cruise): idempotent ports CSV seeder"
```

### Task 2.4: Ships seeder

**Files:**
- Create: `backend/src/seedShipsFromCSV.ts`
- Create: `backend/src/__tests__/seedShipsFromCSV.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/__tests__/seedShipsFromCSV.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { prisma } from '../db';
import { seedShipsFromCSV } from '../seedShipsFromCSV';

describe('seedShipsFromCSV', () => {
  beforeEach(async () => {
    await prisma.ship.deleteMany({ where: { isUserAdded: false } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('inserts rows from CSV', async () => {
    const count = await seedShipsFromCSV();
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('is idempotent', async () => {
    await seedShipsFromCSV();
    const second = await seedShipsFromCSV();
    expect(second).toBe(0);
  });

  it('respects isUserAdded flag', async () => {
    const s = await prisma.ship.create({
      data: { name: 'AIDAnova', imo: '9781865', cruiseLine: 'AIDA Cruises', isUserAdded: true },
    });
    await seedShipsFromCSV();
    const reloaded = await prisma.ship.findUnique({ where: { id: s.id } });
    expect(reloaded?.isUserAdded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd backend && npx jest __tests__/seedShipsFromCSV -- --forceExit`
Expected: FAIL.

- [ ] **Step 3: Write the seeder**

`backend/src/seedShipsFromCSV.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { prisma } from './db';
import logger from './utils/logger';

interface CSVShip {
  name: string;
  imo: string;
  cruise_line: string;
  year_built: string;
  gross_tonnage: string;
  capacity: string;
  status: string;
}

const CSV_PATH = path.resolve(__dirname, 'seedData', 'ships.csv');

const toIntOrNull = (v: string): number | null => {
  if (!v || v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export async function seedShipsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: 'seed_ships_skip', reason: 'csv_missing', path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CSVShip[];

  let inserted = 0;
  for (const row of rows) {
    if (!row.name || !row.cruise_line) continue;

    const imo = row.imo?.trim() || null;
    if (imo) {
      const existing = await prisma.ship.findUnique({ where: { imo } });
      if (existing) continue;
    }

    await prisma.ship.create({
      data: {
        name: row.name.trim(),
        imo,
        cruiseLine: row.cruise_line.trim(),
        yearBuilt: toIntOrNull(row.year_built),
        grossTonnage: toIntOrNull(row.gross_tonnage),
        capacity: toIntOrNull(row.capacity),
        status: row.status?.trim() || 'active',
        isUserAdded: false,
      },
    });
    inserted += 1;
  }

  logger.info({ operation: 'seed_ships_done', inserted });
  return inserted;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd backend && npx jest __tests__/seedShipsFromCSV -- --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedShipsFromCSV.ts backend/src/__tests__/seedShipsFromCSV.test.ts
git commit -m "feat(cruise): idempotent ships CSV seeder"
```

### Task 2.5: Wire seeders into boot

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Find the existing seed bootstrap block**

Run: `cd backend && grep -n "seedAirportsFromCSV\|ensureAchievements\|seed" src/index.ts | head -10`
Note the line numbers where airport seeding and `ensureAchievements()` are called during startup. The new cruise seeders run in the same block, after `seedAirportsFromCSV` completes.

- [ ] **Step 2: Add imports at the top of `backend/src/index.ts` alongside existing seed imports**

```typescript
import { seedPortsFromCSV } from './seedPortsFromCSV';
import { seedShipsFromCSV } from './seedShipsFromCSV';
```

- [ ] **Step 3: Call the seeders in the existing bootstrap block**

Inside the startup async function, immediately after the airport seeder line:

```typescript
await seedPortsFromCSV();
await seedShipsFromCSV();
```

- [ ] **Step 4: Verify compile**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(cruise): run ports + ships seeders on boot"
```

---

## Phase 3 — Lookup APIs (ports, ships)

Autocomplete endpoints consumed by the pickers, plus "add custom" POST endpoints.

### Task 3.1: Ports lookup router

**Files:**
- Create: `backend/src/routes/ports.ts`
- Create: `backend/src/routes/__tests__/ports.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/routes/__tests__/ports.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../../index';
import { prisma } from '../../db';
import { createTestUser, authHeaders } from '../../__tests__/helpers/auth';

describe('GET /api/v1/ports', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    const { token } = await createTestUser();
    auth = authHeaders(token);
    await prisma.port.createMany({
      data: [
        { name: 'Hamburg', city: 'Hamburg', country: 'Germany', unlocode: 'DEHAM', lat: 53.54, lon: 9.97, region: 'atlantic' },
        { name: 'Barcelona', city: 'Barcelona', country: 'Spain', unlocode: 'ESBCN', lat: 41.35, lon: 2.17, region: 'mediterranean' },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns all ports when no query', async () => {
    const res = await request(app).get('/api/v1/ports').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by q (case-insensitive substring on name/city/unlocode)', async () => {
    const res = await request(app).get('/api/v1/ports?q=bar').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { name: string }) => p.name === 'Barcelona')).toBe(true);
  });

  it('exact unlocode match ranks first', async () => {
    const res = await request(app).get('/api/v1/ports?q=DEHAM').set(auth);
    expect(res.body.data[0].unlocode).toBe('DEHAM');
  });

  it('filters by region', async () => {
    const res = await request(app).get('/api/v1/ports?region=mediterranean').set(auth);
    expect(res.body.data.every((p: { region: string }) => p.region === 'mediterranean')).toBe(true);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/ports');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/ports', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    const { token } = await createTestUser();
    auth = authHeaders(token);
  });

  it('creates a user-added port', async () => {
    const res = await request(app).post('/api/v1/ports').set(auth).send({
      name: 'Kleiner Hafen',
      city: 'Timmendorf',
      country: 'Germany',
      lat: 54.0,
      lon: 10.8,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.isUserAdded).toBe(true);
  });

  it('rejects invalid coordinates', async () => {
    const res = await request(app).post('/api/v1/ports').set(auth).send({
      name: 'X',
      lat: 999,
      lon: 0,
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd backend && npx jest routes/__tests__/ports -- --forceExit`
Expected: FAIL — route not found, 404s.

- [ ] **Step 3: Write the router**

`backend/src/routes/ports.ts`:

```typescript
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

const router = Router();
router.use(authenticate);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  region: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createPortSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  unlocode: z.string().max(10).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().max(60).optional(),
  region: z.string().max(40).optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', parsed.error.message);
    const { q, region, limit } = parsed.data;

    const where: Prisma.PortWhereInput = {};
    if (region) where.region = region;
    if (q && q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { unlocode: { equals: q.toUpperCase() } },
      ];
    }

    const ports = await prisma.port.findMany({ where, take: limit, orderBy: { name: 'asc' } });

    if (q && q.length > 0) {
      const upper = q.toUpperCase();
      ports.sort((a, b) => {
        const ax = a.unlocode === upper ? 0 : 1;
        const bx = b.unlocode === upper ? 0 : 1;
        return ax - bx;
      });
    }

    res.json({ success: true, data: ports });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createPortSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_BODY', parsed.error.message);

    const port = await prisma.port.create({
      data: { ...parsed.data, isUserAdded: true },
    });
    logger.info({ operation: 'port_create', portId: port.id, userId: req.user?.id });
    res.status(201).json({ success: true, data: port });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Register in `backend/src/index.ts`**

Add import alongside other route imports:

```typescript
import portsRouter from './routes/ports';
```

And mount:

```typescript
app.use('/api/v1/ports', portsRouter);
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd backend && npx jest routes/__tests__/ports -- --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/ports.ts backend/src/routes/__tests__/ports.test.ts backend/src/index.ts
git commit -m "feat(cruise): ports lookup + custom-port API"
```

### Task 3.2: Ships lookup router

**Files:**
- Create: `backend/src/routes/ships.ts`
- Create: `backend/src/routes/__tests__/ships.test.ts`

- [ ] **Step 1: Write the failing test** (mirrors `ports.test.ts` pattern)

`backend/src/routes/__tests__/ships.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../../index';
import { prisma } from '../../db';
import { createTestUser, authHeaders } from '../../__tests__/helpers/auth';

describe('GET /api/v1/ships', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    const { token } = await createTestUser();
    auth = authHeaders(token);
    await prisma.ship.createMany({
      data: [
        { name: 'AIDAnova', imo: '9781865', cruiseLine: 'AIDA Cruises' },
        { name: 'Mein Schiff 1', imo: '9783564', cruiseLine: 'TUI Cruises' },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('filters by q across name + cruiseLine', async () => {
    const res = await request(app).get('/api/v1/ships?q=aida').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s: { name: string }) => s.name.includes('AIDA'))).toBe(true);
  });

  it('filters by cruiseLine exact', async () => {
    const res = await request(app).get('/api/v1/ships?cruiseLine=TUI%20Cruises').set(auth);
    expect(res.body.data.every((s: { cruiseLine: string }) => s.cruiseLine === 'TUI Cruises')).toBe(true);
  });

  it('exact IMO match ranks first', async () => {
    const res = await request(app).get('/api/v1/ships?q=9781865').set(auth);
    expect(res.body.data[0].imo).toBe('9781865');
  });
});

describe('POST /api/v1/ships', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    const { token } = await createTestUser();
    auth = authHeaders(token);
  });

  it('creates a user-added ship', async () => {
    const res = await request(app).post('/api/v1/ships').set(auth).send({
      name: 'MS Test',
      cruiseLine: 'Test Line',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.isUserAdded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd backend && npx jest routes/__tests__/ships -- --forceExit`
Expected: FAIL.

- [ ] **Step 3: Write the router**

`backend/src/routes/ships.ts`:

```typescript
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

const router = Router();
router.use(authenticate);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  cruiseLine: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createShipSchema = z.object({
  name: z.string().min(1).max(120),
  imo: z.string().max(10).optional(),
  cruiseLine: z.string().min(1).max(120),
  yearBuilt: z.number().int().min(1800).max(2100).optional(),
  grossTonnage: z.number().int().min(0).optional(),
  capacity: z.number().int().min(0).optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', parsed.error.message);
    const { q, cruiseLine, limit } = parsed.data;

    const where: Prisma.ShipWhereInput = {};
    if (cruiseLine) where.cruiseLine = cruiseLine;
    if (q && q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { cruiseLine: { contains: q, mode: 'insensitive' } },
        { imo: { equals: q } },
      ];
    }

    const ships = await prisma.ship.findMany({ where, take: limit, orderBy: { name: 'asc' } });

    if (q && q.length > 0) {
      ships.sort((a, b) => {
        const ax = a.imo === q ? 0 : 1;
        const bx = b.imo === q ? 0 : 1;
        return ax - bx;
      });
    }

    res.json({ success: true, data: ships });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createShipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_BODY', parsed.error.message);

    const ship = await prisma.ship.create({ data: { ...parsed.data, isUserAdded: true } });
    logger.info({ operation: 'ship_create', shipId: ship.id, userId: req.user?.id });
    res.status(201).json({ success: true, data: ship });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Register in `backend/src/index.ts`**

```typescript
import shipsRouter from './routes/ships';
// …
app.use('/api/v1/ships', shipsRouter);
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd backend && npx jest routes/__tests__/ships -- --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/ships.ts backend/src/routes/__tests__/ships.test.ts backend/src/index.ts
git commit -m "feat(cruise): ships lookup + custom-ship API"
```

---

## Phase 4 — Cruise CRUD API

### Task 4.1: Cruises router — list + read

**Files:**
- Create: `backend/src/routes/cruises.ts`
- Create: `backend/src/routes/__tests__/cruises.test.ts`

- [ ] **Step 1: Write the failing test (GET endpoints only — POST/PATCH/DELETE come in Task 4.2)**

`backend/src/routes/__tests__/cruises.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../../index';
import { prisma } from '../../db';
import { createTestUser, authHeaders } from '../../__tests__/helpers/auth';

describe('GET /api/v1/cruises', () => {
  let auth: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    const created = await createTestUser();
    auth = authHeaders(created.token);
    userId = created.userId;

    const port = await prisma.port.create({
      data: { name: 'Test Port', lat: 0, lon: 0, isUserAdded: true },
    });
    const ship = await prisma.ship.create({
      data: { name: 'Test Ship', cruiseLine: 'Test Line', isUserAdded: true },
    });
    await prisma.cruise.create({
      data: {
        userId,
        shipId: ship.id,
        cruiseLine: 'Test Line',
        departurePortId: port.id,
        arrivalPortId: port.id,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-08'),
        status: 'scheduled',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lists cruises for the authenticated user only', async () => {
    const res = await request(app).get('/api/v1/cruises').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  it('includes ship, departurePort, arrivalPort, stops in the response', async () => {
    const res = await request(app).get('/api/v1/cruises').set(auth);
    const c = res.body.data[0];
    expect(c.ship.name).toBe('Test Ship');
    expect(c.departurePort.name).toBe('Test Port');
    expect(c.arrivalPort.name).toBe('Test Port');
    expect(Array.isArray(c.stops)).toBe(true);
  });

  it('filters by cruiseLine', async () => {
    const res = await request(app).get('/api/v1/cruises?cruiseLine=Test%20Line').set(auth);
    expect(res.body.data.length).toBe(1);
  });

  it('returns 404 for a cruise that does not exist', async () => {
    const res = await request(app)
      .get('/api/v1/cruises/00000000-0000-0000-0000-000000000000')
      .set(auth);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/cruises');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd backend && npx jest routes/__tests__/cruises -- --forceExit`
Expected: FAIL.

- [ ] **Step 3: Create the router with GET routes only**

`backend/src/routes/cruises.ts`:

```typescript
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { cruiseQuerySchema } from '../schemas/cruise';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

const router = Router();
router.use(authenticate);

const CRUISE_INCLUDE = {
  ship: true,
  departurePort: true,
  arrivalPort: true,
  stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } },
} satisfies Prisma.CruiseInclude;

const buildWhere = (query: Record<string, unknown>, userId: string): Prisma.CruiseWhereInput => {
  const where: Prisma.CruiseWhereInput = { userId };
  if (typeof query.cruiseLine === 'string') where.cruiseLine = query.cruiseLine;
  if (typeof query.status === 'string') where.status = query.status;
  if (typeof query.tripId === 'string') where.tripId = query.tripId;
  if (typeof query.year === 'number') {
    const y = query.year;
    where.startDate = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
  }
  if (typeof query.region === 'string') {
    where.OR = [
      { departurePort: { region: query.region } },
      { arrivalPort: { region: query.region } },
      { stops: { some: { port: { region: query.region } } } },
    ];
  }
  return where;
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated');
    const parsed = cruiseQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', parsed.error.message);

    const where = buildWhere(parsed.data as Record<string, unknown>, req.user.id);
    const cruises = await prisma.cruise.findMany({
      where,
      include: CRUISE_INCLUDE,
      orderBy: { startDate: 'desc' },
      take: parsed.data.limit ?? 500,
      skip: parsed.data.offset ?? 0,
    });

    res.json({ success: true, data: cruises });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated');
    const cruise = await prisma.cruise.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: CRUISE_INCLUDE,
    });
    if (!cruise) throw new AppError(404, 'NOT_FOUND', 'Cruise not found');
    res.json({ success: true, data: cruise });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Register in `backend/src/index.ts`**

```typescript
import cruisesRouter from './routes/cruises';
// …
app.use('/api/v1/cruises', cruisesRouter);
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd backend && npx jest routes/__tests__/cruises -- --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/cruises.ts backend/src/routes/__tests__/cruises.test.ts backend/src/index.ts
git commit -m "feat(cruise): GET /cruises + /cruises/:id"
```

### Task 4.2: Cruises router — create / update / delete

**Files:**
- Modify: `backend/src/routes/cruises.ts`
- Modify: `backend/src/routes/__tests__/cruises.test.ts`

- [ ] **Step 1: Extend the test file with POST/PATCH/DELETE suites**

Append to `backend/src/routes/__tests__/cruises.test.ts`:

```typescript
describe('POST /api/v1/cruises', () => {
  let auth: Record<string, string>;
  let portId: number;

  beforeAll(async () => {
    const { token } = await createTestUser();
    auth = authHeaders(token);
    const port = await prisma.port.create({ data: { name: 'PostTest', lat: 0, lon: 0, isUserAdded: true } });
    portId = port.id;
  });

  it('creates a cruise with stops', async () => {
    const res = await request(app).post('/api/v1/cruises').set(auth).send({
      cruiseLine: 'New Line',
      departurePortId: portId,
      arrivalPortId: portId,
      startDate: '2026-08-01T12:00:00Z',
      endDate: '2026-08-08T10:00:00Z',
      status: 'scheduled',
      stops: [
        { portId, dayNumber: 1, isAtSea: false },
        { dayNumber: 2, isAtSea: true, portId: null },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.stops.length).toBe(2);
  });

  it('rejects invalid payload', async () => {
    const res = await request(app).post('/api/v1/cruises').set(auth).send({ price: -5 });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/cruises/:id', () => {
  let auth: Record<string, string>;
  let userId: string;
  let cruiseId: string;

  beforeAll(async () => {
    const created = await createTestUser();
    auth = authHeaders(created.token);
    userId = created.userId;
    const c = await prisma.cruise.create({ data: { userId, status: 'scheduled' } });
    cruiseId = c.id;
  });

  it('updates fields', async () => {
    const res = await request(app).patch(`/api/v1/cruises/${cruiseId}`).set(auth).send({ notes: 'Great trip' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Great trip');
  });

  it('replaces stops when stops provided', async () => {
    const res = await request(app).patch(`/api/v1/cruises/${cruiseId}`).set(auth).send({
      stops: [{ dayNumber: 1, isAtSea: true, portId: null }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stops.length).toBe(1);
  });

  it('404 on cruise owned by another user', async () => {
    const other = await createTestUser();
    const otherCruise = await prisma.cruise.create({ data: { userId: other.userId } });
    const res = await request(app).patch(`/api/v1/cruises/${otherCruise.id}`).set(auth).send({ notes: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/cruises/:id', () => {
  let auth: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    const created = await createTestUser();
    auth = authHeaders(created.token);
    userId = created.userId;
  });

  it('deletes and returns 204', async () => {
    const c = await prisma.cruise.create({ data: { userId } });
    const res = await request(app).delete(`/api/v1/cruises/${c.id}`).set(auth);
    expect(res.status).toBe(204);
    const gone = await prisma.cruise.findUnique({ where: { id: c.id } });
    expect(gone).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd backend && npx jest routes/__tests__/cruises -- --forceExit`
Expected: FAIL on new suites.

- [ ] **Step 3: Add POST handler to `cruises.ts`**

```typescript
import { createCruiseSchema, updateCruiseSchema } from '../schemas/cruise';
import { checkAndUpdateAchievements } from '../utils/achievements';

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated');
    const parsed = createCruiseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_BODY', parsed.error.message);

    const { stops, startDate, endDate, tripId, bookingId, ...rest } = parsed.data;

    const cruise = await prisma.$transaction(async (tx) => {
      const created = await tx.cruise.create({
        data: {
          userId: req.user!.id,
          ...rest,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          tripId: tripId ?? null,
          bookingId: bookingId ?? null,
        },
      });

      if (stops && stops.length > 0) {
        await tx.cruiseStop.createMany({
          data: stops.map((s) => ({
            cruiseId: created.id,
            portId: s.portId ?? null,
            dayNumber: s.dayNumber,
            isAtSea: s.isAtSea,
            arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
            departureTime: s.departureTime ? new Date(s.departureTime) : null,
            excursionNote: s.excursionNote ?? null,
          })),
        });
      }

      return tx.cruise.findUniqueOrThrow({ where: { id: created.id }, include: CRUISE_INCLUDE });
    });

    await checkAndUpdateAchievements(req.user.id).catch((err) => {
      logger.error({ operation: 'cruise_achievement_check_failed', error: err });
    });

    logger.info({ operation: 'cruise_create', cruiseId: cruise.id, userId: req.user.id });
    res.status(201).json({ success: true, data: cruise });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Add PATCH handler**

```typescript
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated');
    const existing = await prisma.cruise.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Cruise not found');

    const parsed = updateCruiseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_BODY', parsed.error.message);

    const { stops, startDate, endDate, ...rest } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cruise.update({
        where: { id: existing.id },
        data: {
          ...rest,
          startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null,
          endDate: endDate === undefined ? undefined : endDate ? new Date(endDate) : null,
        },
      });

      if (stops !== undefined) {
        await tx.cruiseStop.deleteMany({ where: { cruiseId: existing.id } });
        if (stops.length > 0) {
          await tx.cruiseStop.createMany({
            data: stops.map((s) => ({
              cruiseId: existing.id,
              portId: s.portId ?? null,
              dayNumber: s.dayNumber,
              isAtSea: s.isAtSea,
              arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
              departureTime: s.departureTime ? new Date(s.departureTime) : null,
              excursionNote: s.excursionNote ?? null,
            })),
          });
        }
      }

      return tx.cruise.findUniqueOrThrow({ where: { id: existing.id }, include: CRUISE_INCLUDE });
    });

    await checkAndUpdateAchievements(req.user.id).catch((err) => {
      logger.error({ operation: 'cruise_achievement_check_failed', error: err });
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Add DELETE handler**

```typescript
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated');
    const existing = await prisma.cruise.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Cruise not found');
    await prisma.cruise.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run test to verify pass**

Run: `cd backend && npx jest routes/__tests__/cruises -- --forceExit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/cruises.ts backend/src/routes/__tests__/cruises.test.ts
git commit -m "feat(cruise): POST/PATCH/DELETE cruises + stops replacement on update"
```

---

## Phase 5 — Frontend API client + types

### Task 5.1: TypeScript types for cruise domain

**Files:**
- Create: `frontend/src/types/cruise.ts`

- [ ] **Step 1: Write the types**

```typescript
export interface Ship {
  id: number;
  name: string;
  imo: string | null;
  cruiseLine: string;
  yearBuilt: number | null;
  grossTonnage: number | null;
  capacity: number | null;
  status: string;
  isUserAdded: boolean;
}

export interface Port {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  unlocode: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
  region: string | null;
  isUserAdded: boolean;
}

export interface CruiseStop {
  id: string;
  cruiseId: string;
  portId: number | null;
  port: Port | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime: string | null;
  departureTime: string | null;
  excursionNote: string | null;
}

export type CruiseStatus = "scheduled" | "flown" | "cancelled" | "historical";
export type CabinType = "inside" | "oceanview" | "balcony" | "suite";

export interface Cruise {
  id: string;
  userId: string;
  shipId: number | null;
  ship: Ship | null;
  shipNameOverride: string | null;
  cruiseLine: string | null;
  departurePortId: number | null;
  departurePort: Port | null;
  arrivalPortId: number | null;
  arrivalPort: Port | null;
  startDate: string | null;
  endDate: string | null;
  status: CruiseStatus;
  cabinNumber: string | null;
  cabinType: CabinType | null;
  deck: number | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  stops: CruiseStop[];
  createdAt: string;
}

export interface CruiseStopInput {
  portId: number | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: string | null;
  departureTime?: string | null;
  excursionNote?: string;
}

export interface CruiseInput {
  shipId?: number | null;
  shipNameOverride?: string;
  cruiseLine?: string;
  departurePortId?: number | null;
  arrivalPortId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: CruiseStatus;
  cabinNumber?: string;
  cabinType?: CabinType;
  deck?: number;
  bookingReference?: string;
  price?: number;
  currency?: "EUR" | "USD" | "GBP" | "CHF";
  notes?: string;
  tags?: string[];
  companions?: string[];
  tripId?: string | null;
  bookingId?: string | null;
  stops?: CruiseStopInput[];
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/cruise.ts
git commit -m "feat(cruise): frontend cruise types"
```

### Task 5.2: Cruise API client

**Files:**
- Create: `frontend/src/lib/cruiseApi.ts`
- Create: `frontend/src/__tests__/lib/cruiseApi.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/__tests__/lib/cruiseApi.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { cruiseApi, portsApi, shipsApi } from "../../lib/cruiseApi";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cruiseApi", () => {
  it("list() requests /cruises with filters", async () => {
    mockedAxios.create = vi.fn(() => mockedAxios as unknown as ReturnType<typeof axios.create>);
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: [] } });
    await cruiseApi.list({ cruiseLine: "AIDA" });
    expect(mockedAxios.get).toHaveBeenCalledWith("/cruises", { params: { cruiseLine: "AIDA" } });
  });

  it("get() requests /cruises/:id", async () => {
    mockedAxios.create = vi.fn(() => mockedAxios as unknown as ReturnType<typeof axios.create>);
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: { id: "x" } } });
    const r = await cruiseApi.get("x");
    expect(mockedAxios.get).toHaveBeenCalledWith("/cruises/x");
    expect(r.id).toBe("x");
  });
});

describe("portsApi", () => {
  it("search() requests /ports with q", async () => {
    mockedAxios.create = vi.fn(() => mockedAxios as unknown as ReturnType<typeof axios.create>);
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: [] } });
    await portsApi.search("hamburg");
    expect(mockedAxios.get).toHaveBeenCalledWith("/ports", { params: { q: "hamburg" } });
  });
});

describe("shipsApi", () => {
  it("search() requests /ships with q", async () => {
    mockedAxios.create = vi.fn(() => mockedAxios as unknown as ReturnType<typeof axios.create>);
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: [] } });
    await shipsApi.search("aida");
    expect(mockedAxios.get).toHaveBeenCalledWith("/ships", { params: { q: "aida" } });
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd frontend && npx vitest --run lib/cruiseApi`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

`frontend/src/lib/cruiseApi.ts`:

```typescript
import { apiClient } from "./api";
import type { Cruise, CruiseInput, Port, Ship } from "../types/cruise";

interface ListResp<T> {
  success: boolean;
  data: T[];
}
interface GetResp<T> {
  success: boolean;
  data: T;
}

export interface CruiseListQuery {
  status?: string | string[];
  cruiseLine?: string | string[];
  year?: number;
  region?: string;
  tripId?: string;
  sort?: "date" | "ship" | "line" | "ports" | "status";
  limit?: number;
  offset?: number;
}

export const cruiseApi = {
  list: async (q: CruiseListQuery = {}): Promise<Cruise[]> => {
    const res = await apiClient.get<ListResp<Cruise>>("/cruises", { params: q });
    return res.data.data;
  },
  get: async (id: string): Promise<Cruise> => {
    const res = await apiClient.get<GetResp<Cruise>>(`/cruises/${id}`);
    return res.data.data;
  },
  create: async (input: CruiseInput): Promise<Cruise> => {
    const res = await apiClient.post<GetResp<Cruise>>("/cruises", input);
    return res.data.data;
  },
  update: async (id: string, input: CruiseInput): Promise<Cruise> => {
    const res = await apiClient.patch<GetResp<Cruise>>(`/cruises/${id}`, input);
    return res.data.data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/cruises/${id}`);
  },
};

export const portsApi = {
  search: async (q: string, region?: string): Promise<Port[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (region) params.region = region;
    const res = await apiClient.get<ListResp<Port>>("/ports", { params });
    return res.data.data;
  },
  create: async (input: {
    name: string;
    city?: string;
    country?: string;
    lat: number;
    lon: number;
    unlocode?: string;
    region?: string;
  }): Promise<Port> => {
    const res = await apiClient.post<GetResp<Port>>("/ports", input);
    return res.data.data;
  },
};

export const shipsApi = {
  search: async (q: string, cruiseLine?: string): Promise<Ship[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (cruiseLine) params.cruiseLine = cruiseLine;
    const res = await apiClient.get<ListResp<Ship>>("/ships", { params });
    return res.data.data;
  },
  create: async (input: {
    name: string;
    cruiseLine: string;
    imo?: string;
    yearBuilt?: number;
    grossTonnage?: number;
    capacity?: number;
  }): Promise<Ship> => {
    const res = await apiClient.post<GetResp<Ship>>("/ships", input);
    return res.data.data;
  },
};
```

> Note: the test mocks `axios`, but the production client uses the project's shared `apiClient` export from `frontend/src/lib/api.ts` (which sets `withCredentials: true` for the auth cookie). If `api.ts` uses a different export name, adapt the import.

- [ ] **Step 4: Align test with actual export**

If `frontend/src/lib/api.ts` exports `api` instead of `apiClient`, update the import in `cruiseApi.ts` and rewrite the test to mock the shared client module rather than `axios` directly, following the existing pattern in `frontend/src/__tests__/lib/api.test.ts` (or the closest analogue). The shape of the test stays the same — only the mock target differs.

- [ ] **Step 5: Run test to verify pass**

Run: `cd frontend && npx vitest --run lib/cruiseApi`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/cruiseApi.ts frontend/src/__tests__/lib/cruiseApi.test.ts
git commit -m "feat(cruise): frontend cruise/ports/ships API clients"
```

### Task 5.3: i18n cruise namespace

**Files:**
- Create: `frontend/src/i18n/resources/de/cruise.json`
- Create: `frontend/src/i18n/resources/en/cruise.json`
- Modify: `frontend/src/i18n/config.ts`

- [ ] **Step 1: Write `de/cruise.json`**

```json
{
  "nav": {
    "link": "Kreuzfahrten"
  },
  "list": {
    "title": "Kreuzfahrten",
    "new": "Neue Kreuzfahrt",
    "empty": "Noch keine Kreuzfahrten erfasst",
    "columns": {
      "ship": "Schiff",
      "line": "Reederei",
      "dates": "Termine",
      "ports": "Häfen",
      "status": "Status",
      "cabin": "Kabine",
      "price": "Preis"
    }
  },
  "detail": {
    "route": "Route",
    "cabin": "Kabine",
    "costs": "Kosten",
    "meta": "Notizen & Tags"
  },
  "field": {
    "ship": "Schiff",
    "line": "Reederei",
    "depart": "Abfahrt",
    "arrive": "Ankunft",
    "cabin": "Kabine",
    "cabinType": "Kategorie",
    "deck": "Deck",
    "sea_days": "Seetage",
    "ports": "Häfen",
    "distance_nm": "Seemeilen",
    "bookingReference": "Buchungsnummer",
    "price": "Preis",
    "notes": "Notizen",
    "tags": "Tags",
    "companions": "Mitreisende"
  },
  "cabinType": {
    "inside": "Innen",
    "oceanview": "Außenkabine",
    "balcony": "Balkon",
    "suite": "Suite"
  },
  "status": {
    "scheduled": "Geplant",
    "flown": "Abgeschlossen",
    "cancelled": "Storniert",
    "historical": "Historisch"
  },
  "stops": {
    "title": "Hafenfolge",
    "at_sea": "Auf See",
    "add": "Stopp hinzufügen",
    "day": "Tag",
    "excursion": "Landausflug"
  },
  "picker": {
    "ship_placeholder": "Schiff suchen …",
    "port_placeholder": "Hafen suchen …",
    "add_custom_ship": "Neues Schiff anlegen",
    "add_custom_port": "Neuen Hafen anlegen"
  },
  "map": {
    "layer": "Kreuzfahrten"
  }
}
```

- [ ] **Step 2: Write `en/cruise.json` (same shape, English text)**

```json
{
  "nav": { "link": "Cruises" },
  "list": {
    "title": "Cruises",
    "new": "New cruise",
    "empty": "No cruises yet",
    "columns": {
      "ship": "Ship",
      "line": "Line",
      "dates": "Dates",
      "ports": "Ports",
      "status": "Status",
      "cabin": "Cabin",
      "price": "Price"
    }
  },
  "detail": { "route": "Route", "cabin": "Cabin", "costs": "Costs", "meta": "Notes & tags" },
  "field": {
    "ship": "Ship",
    "line": "Line",
    "depart": "Depart",
    "arrive": "Arrive",
    "cabin": "Cabin",
    "cabinType": "Category",
    "deck": "Deck",
    "sea_days": "Sea days",
    "ports": "Ports",
    "distance_nm": "Nautical miles",
    "bookingReference": "Booking reference",
    "price": "Price",
    "notes": "Notes",
    "tags": "Tags",
    "companions": "Companions"
  },
  "cabinType": { "inside": "Inside", "oceanview": "Oceanview", "balcony": "Balcony", "suite": "Suite" },
  "status": { "scheduled": "Scheduled", "flown": "Completed", "cancelled": "Cancelled", "historical": "Historical" },
  "stops": {
    "title": "Itinerary",
    "at_sea": "At sea",
    "add": "Add stop",
    "day": "Day",
    "excursion": "Excursion"
  },
  "picker": {
    "ship_placeholder": "Search ship …",
    "port_placeholder": "Search port …",
    "add_custom_ship": "Add custom ship",
    "add_custom_port": "Add custom port"
  },
  "map": { "layer": "Cruises" }
}
```

- [ ] **Step 3: Register the namespace in `frontend/src/i18n/config.ts`**

Import both resource files and add `cruise` to the namespace arrays / `resources` object alongside the existing ones (`common`, `flights`, `map`, `trips`, …). Follow the exact pattern used by `trips` or `flights` — this file has a consistent shape.

- [ ] **Step 4: Verify compile + tests still pass**

Run:

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

Expected: no errors, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/resources/de/cruise.json frontend/src/i18n/resources/en/cruise.json frontend/src/i18n/config.ts
git commit -m "feat(cruise): i18n namespace (de + en)"
```

---

## Phase 6 — Frontend cruise list + detail + edit

### Task 6.1: ShipPicker component

**Files:**
- Create: `frontend/src/components/Cruise/ShipPicker.tsx`
- Create: `frontend/src/__tests__/components/ShipPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipPicker } from "../../components/Cruise/ShipPicker";
import { shipsApi } from "../../lib/cruiseApi";

vi.mock("../../lib/cruiseApi", () => ({
  shipsApi: { search: vi.fn(), create: vi.fn() },
}));

describe("ShipPicker", () => {
  it("searches as user types and shows results", async () => {
    (shipsApi.search as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, name: "AIDAnova", cruiseLine: "AIDA Cruises", imo: "9781865", isUserAdded: false },
    ]);
    const onSelect = vi.fn();
    render(<ShipPicker value={null} onChange={onSelect} />);
    await userEvent.type(screen.getByRole("combobox"), "aida");
    await waitFor(() => expect(shipsApi.search).toHaveBeenCalled());
    await userEvent.click(await screen.findByText("AIDAnova"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows 'Add custom' button when no exact match and calls create", async () => {
    (shipsApi.search as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (shipsApi.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99,
      name: "MS Custom",
      cruiseLine: "Custom Line",
      imo: null,
      isUserAdded: true,
    });
    const onSelect = vi.fn();
    render(<ShipPicker value={null} onChange={onSelect} />);
    await userEvent.type(screen.getByRole("combobox"), "MS Custom");
    await waitFor(() => expect(shipsApi.search).toHaveBeenCalled());
    await userEvent.click(await screen.findByText(/add custom|neues schiff/i));
    // dialog requires line input before save — simulate it
    const lineInput = await screen.findByPlaceholderText(/line|reederei/i);
    await userEvent.type(lineInput, "Custom Line");
    await userEvent.click(screen.getByRole("button", { name: /save|speichern/i }));
    await waitFor(() => expect(shipsApi.create).toHaveBeenCalled());
    expect(onSelect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd frontend && npx vitest --run components/ShipPicker`
Expected: FAIL.

- [ ] **Step 3: Write the component**

```tsx
import { useEffect, useState } from "react";
import { shipsApi } from "../../lib/cruiseApi";
import type { Ship } from "../../types/cruise";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  value: Ship | null;
  onChange: (ship: Ship) => void;
}

export function ShipPicker({ value, onChange }: Props) {
  const { t } = useTranslation("cruise");
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<Ship[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLine, setNewLine] = useState("");

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!query || query.length < 2) {
        setResults([]);
        return;
      }
      const r = await shipsApi.search(query);
      setResults(r);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const exactMatch = results.some((r) => r.name.toLowerCase() === query.toLowerCase());

  const save = async () => {
    if (!newName || !newLine) return;
    const ship = await shipsApi.create({ name: newName, cruiseLine: newLine });
    onChange(ship);
    setShowAdd(false);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={results.length > 0}
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        placeholder={t("picker.ship_placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-800"
                onClick={() => {
                  onChange(r);
                  setQuery(r.name);
                  setResults([]);
                }}
              >
                {r.name} <span className="text-neutral-500">— {r.cruiseLine}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.length >= 2 && !exactMatch && (
        <button
          type="button"
          className="mt-2 text-xs text-sky-400 hover:underline"
          onClick={() => {
            setNewName(query);
            setShowAdd(true);
          }}
        >
          {t("picker.add_custom_ship")}
        </button>
      )}
      {showAdd && (
        <div className="mt-2 space-y-2 rounded-md border border-neutral-700 bg-neutral-900 p-3">
          <input
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("field.ship")}
          />
          <input
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
            value={newLine}
            onChange={(e) => setNewLine(e.target.value)}
            placeholder={t("field.line")}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-neutral-400">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
            >
              {t("picker.add_custom_ship")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd frontend && npx vitest --run components/ShipPicker`
Expected: PASS. (If copy mismatch fails the test, tweak the regex in the test to match the i18n labels — do not weaken the assertions.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Cruise/ShipPicker.tsx frontend/src/__tests__/components/ShipPicker.test.tsx
git commit -m "feat(cruise): ShipPicker component with custom-ship flow"
```

### Task 6.2: PortPicker component

**Files:**
- Create: `frontend/src/components/Cruise/PortPicker.tsx`
- Create: `frontend/src/__tests__/components/PortPicker.test.tsx`

Same pattern as Task 6.1 but for ports. Include: `lat` and `lon` inputs on the "add custom" dialog, optional `unlocode`, optional `region`.

- [ ] **Step 1: Write test mirroring ShipPicker test (replace `ships` with `ports` and assert `lat`/`lon` inputs render).**
- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement `PortPicker.tsx` mirroring `ShipPicker.tsx`, with these differences in the add-custom form:**
  - `name` input
  - `city` input
  - `country` input
  - `lat` numeric input (step 0.001)
  - `lon` numeric input (step 0.001)
  - Save calls `portsApi.create({ name, city, country, lat, lon })`.
- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(cruise): PortPicker component with custom-port flow"
```

### Task 6.3: CruiseStopsEditor component

**Files:**
- Create: `frontend/src/components/Cruise/CruiseStopsEditor.tsx`
- Create: `frontend/src/__tests__/components/CruiseStopsEditor.test.tsx`

The editor takes `stops: CruiseStopInput[]` and emits `(stops: CruiseStopInput[]) => void`. Supports add, remove, reorder (simple up/down buttons — no drag-drop in V1), toggle at-sea, port picker, arrival/departure time, excursion note.

- [ ] **Step 1: Write a focused test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseStopsEditor } from "../../components/Cruise/CruiseStopsEditor";

describe("CruiseStopsEditor", () => {
  it("adds a stop with auto-incremented dayNumber", async () => {
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /add stop|stopp/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ dayNumber: 1, isAtSea: false, portId: null }),
    ]);
  });

  it("removes a stop and renumbers subsequent days", async () => {
    const stops = [
      { portId: 1, dayNumber: 1, isAtSea: false },
      { portId: 2, dayNumber: 2, isAtSea: false },
      { portId: 3, dayNumber: 3, isAtSea: false },
    ];
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={stops} onChange={onChange} />);
    const removeBtns = screen.getAllByRole("button", { name: /remove|entfernen/i });
    await userEvent.click(removeBtns[0]);
    const emitted = onChange.mock.calls[0][0];
    expect(emitted.length).toBe(2);
    expect(emitted[0].dayNumber).toBe(1);
    expect(emitted[1].dayNumber).toBe(2);
  });
});
```

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement the component** — a simple vertical list. Each row contains: reorder buttons (↑ ↓), `PortPicker` (disabled if `isAtSea`), at-sea toggle, `dayNumber` read-only, arrival/departure datetime inputs, excursion note textarea, remove button. `onChange` emits the full array after every edit, always renumbering `dayNumber` to `index+1` for stable numbering.
- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(cruise): CruiseStopsEditor with add/remove/reorder"
```

### Task 6.4: CruiseEditModal

**Files:**
- Create: `frontend/src/components/Cruise/CruiseEditModal.tsx`
- Create: `frontend/src/__tests__/components/CruiseEditModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../components/Cruise/CruiseEditModal";
import { cruiseApi } from "../../lib/cruiseApi";

vi.mock("../../lib/cruiseApi", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));

describe("CruiseEditModal", () => {
  it("submits a new cruise and calls onSaved", async () => {
    (cruiseApi.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" });
    const onSaved = vi.fn();
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/line|reederei/i), "AIDA");
    await userEvent.click(screen.getByRole("button", { name: /save|speichern/i }));
    expect(cruiseApi.create).toHaveBeenCalledWith(expect.objectContaining({ cruiseLine: "AIDA" }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows validation errors from server", async () => {
    (cruiseApi.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: "Invalid payload" } },
    });
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /save|speichern/i }));
    expect(await screen.findByText(/invalid payload/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement the modal** with five collapsible sections per the spec (Ship & Basics / Ports & Stops / Cabin / Costs / Meta). Use `ShipPicker`, `PortPicker`, `CruiseStopsEditor`. Submit calls `cruiseApi.create` (mode=create) or `cruiseApi.update` (mode=edit). On success, call `onSaved(cruise)`. On error, surface `err.response?.data?.error` in a banner.
- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(cruise): CruiseEditModal with 5-section form"
```

### Task 6.5: CruisesPage (list)

**Files:**
- Create: `frontend/src/pages/CruisesPage.tsx`
- Create: `frontend/src/components/Cruise/CruiseRow.tsx`

- [ ] **Step 1: Implement `CruiseRow.tsx`** — renders one row with ship icon + name, line, date range, port count, status pill, cabin, price. Click emits `onOpen(cruise)`.

- [ ] **Step 2: Implement `CruisesPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/cruiseApi";
import type { Cruise } from "../types/cruise";
import { CruiseRow } from "../components/Cruise/CruiseRow";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { useTranslation } from "../hooks/useTranslation";

export default function CruisesPage() {
  const { t } = useTranslation("cruise");
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const reload = async () => {
    setLoading(true);
    const data = await cruiseApi.list();
    setCruises(data);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
        >
          {t("list.new")}
        </button>
      </div>

      {loading ? (
        <div className="text-neutral-400">Loading …</div>
      ) : cruises.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-400">
          {t("list.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left">{t("list.columns.ship")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.line")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.dates")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.ports")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.status")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.cabin")}</th>
                <th className="px-3 py-2 text-right">{t("list.columns.price")}</th>
              </tr>
            </thead>
            <tbody>
              {cruises.map((c) => (
                <CruiseRow key={c.id} cruise={c} onOpen={() => navigate(`/cruises/${c.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CruiseEditModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register route in `frontend/src/App.tsx`**

Locate the existing route block (it already domain-gates routes based on Foundation work). Add:

```tsx
{isDomainEnabled("cruise") && (
  <>
    <Route path="/cruises" element={<CruisesPage />} />
    <Route path="/cruises/:id" element={<CruiseDetailPage />} />
  </>
)}
```

Use the existing helper (`useEnabledDomains` / `isDomainEnabled`) that Foundation already provides. If lazy-loading is the existing pattern, wrap `CruisesPage` and `CruiseDetailPage` in `React.lazy`.

- [ ] **Step 4: Verify compile + frontend tests pass**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CruisesPage.tsx frontend/src/components/Cruise/CruiseRow.tsx frontend/src/App.tsx
git commit -m "feat(cruise): cruise list page + route gated by enabledDomains"
```

### Task 6.6: CruiseDetailPage

**Files:**
- Create: `frontend/src/pages/CruiseDetailPage.tsx`

- [ ] **Step 1: Implement the detail page** per the spec's hybrid B+C layout:
  - Top ship-header strip: icon tile (🚢 in rounded square tinted with line color — use a color dictionary or the shared `DOMAINS.cruise.color` as fallback), title, line, date range, stat pills (days, ports, sea days, region, status pill), Edit / Export buttons.
  - Two-column body on `md:` and up: left ≈60% timeline, right ≈40% sticky info column (map placeholder for now, cabin card, costs card, notes/tags/companions card).
  - Mobile (below `md`): stack vertically — header, then map, then timeline, then info cards.
  - Timeline uses the polymorphic `<TripTimeline />` component from Foundation — pass `events={cruise.stops.map(toTimelineEvent)}`. If the component signature differs, adapt — the signature is: `events: Array<{ kind: 'cruise-stop' | 'flight'; …payload }>`.
  - The map card is a placeholder in this task (Phase 7 wires it to the actual cruise layers).
  - Edit button opens `CruiseEditModal` in `mode="edit"` with `cruise={cruise}`. On save, `setCruise(updated)` without reload.

- [ ] **Step 2: Verify compile + existing tests still pass**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/CruiseDetailPage.tsx
git commit -m "feat(cruise): cruise detail page with ship header + timeline + info cards"
```

### Task 6.7: Cruise nav link

**Files:**
- Modify: `frontend/src/components/NavigationBar.tsx`

- [ ] **Step 1: Add the cruise nav item inside the existing domain-gated nav block**

Foundation already iterates `enabledDomains`. Ensure the `cruise` case is handled and emits a link to `/cruises` with label `t("cruise:nav.link")` and the cruise icon (🚢). If the nav block currently only handles `flight`, extend it via a switch or a domain-descriptor lookup.

- [ ] **Step 2: Verify nav renders under dev server**

Run `npm run dev:frontend` locally, toggle `cruise` on in Settings (the domain is still `available: false` — you may need to temporarily set it to `true` in `frontend/src/shared/domains.ts` to verify, then revert). Confirm the Cruise link appears and navigates to `/cruises`.

- [ ] **Step 3: Revert the temporary domain flip** (it stays `false` until Phase 10 finishes).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NavigationBar.tsx
git commit -m "feat(cruise): nav link (gated by enabledDomains)"
```

---

## Phase 7 — Map layer

### Task 7.1: Curved-arc geometry helper

**Files:**
- Create: `frontend/src/components/Map/cruiseArc.ts`
- Create: `frontend/src/__tests__/map/cruiseArc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildCruiseArc } from "../../components/Map/cruiseArc";

describe("buildCruiseArc", () => {
  it("returns a path with the requested resolution", () => {
    const path = buildCruiseArc({ lat: 53.54, lon: 9.97 }, { lat: 60.39, lon: 5.32 }, 32);
    expect(path.length).toBe(33);
    expect(path[0]).toEqual([9.97, 53.54]);
    expect(path[path.length - 1]).toEqual([5.32, 60.39]);
  });

  it("control point offsets perpendicular to the segment", () => {
    const path = buildCruiseArc({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 10);
    const mid = path[Math.floor(path.length / 2)];
    // midpoint should be lifted off the direct line (lat != 0)
    expect(Math.abs(mid[1])).toBeGreaterThan(0.01);
  });
});
```

- [ ] **Step 2: Verify fail.**

Run: `cd frontend && npx vitest --run map/cruiseArc`

- [ ] **Step 3: Implement**

```typescript
type LonLat = [number, number];

export function buildCruiseArc(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  resolution = 64,
): LonLat[] {
  const dx = to.lon - from.lon;
  const dy = to.lat - from.lat;
  const midLon = (from.lon + to.lon) / 2;
  const midLat = (from.lat + to.lat) / 2;
  // Perpendicular offset — magnitude scaled by segment length so short hops don't arc wildly
  const length = Math.sqrt(dx * dx + dy * dy);
  const offsetMagnitude = length * 0.2;
  const perp: LonLat = [-dy, dx];
  const perpLen = Math.sqrt(perp[0] ** 2 + perp[1] ** 2) || 1;
  const ctrl: LonLat = [
    midLon + (perp[0] / perpLen) * offsetMagnitude,
    midLat + (perp[1] / perpLen) * offsetMagnitude,
  ];

  const path: LonLat[] = [];
  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution;
    const it = 1 - t;
    const lon = it * it * from.lon + 2 * it * t * ctrl[0] + t * t * to.lon;
    const lat = it * it * from.lat + 2 * it * t * ctrl[1] + t * t * to.lat;
    path.push([lon, lat]);
  }
  return path;
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
git add frontend/src/components/Map/cruiseArc.ts frontend/src/__tests__/map/cruiseArc.test.ts
git commit -m "feat(cruise): Bezier cruise-arc geometry helper"
```

### Task 7.2: Cruise layers

**Files:**
- Create: `frontend/src/components/Map/CruiseArcsLayer.ts`
- Create: `frontend/src/components/Map/CruisePortsLayer.ts`

- [ ] **Step 1: Implement `CruiseArcsLayer.ts`**

```typescript
import { PathLayer } from "@deck.gl/layers";
import type { Cruise } from "../../types/cruise";
import { buildCruiseArc } from "./cruiseArc";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
}

export function buildCruiseArcsLayer(cruises: Cruise[]): PathLayer<ArcDatum> {
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    const stops = cruise.stops.filter((s) => !s.isAtSea && s.port).sort((a, b) => a.dayNumber - b.dayNumber);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i].port!;
      const b = stops[i + 1].port!;
      arcs.push({
        path: buildCruiseArc(a, b),
        cruiseId: cruise.id,
        cruiseLine: cruise.cruiseLine,
      });
    }
  }

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: [56, 189, 248, 220],
    getWidth: 2,
    widthUnits: "pixels",
    pickable: true,
  });
}
```

- [ ] **Step 2: Implement `CruisePortsLayer.ts`**

```typescript
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Cruise } from "../../types/cruise";

interface PortDatum {
  position: [number, number];
  portId: number;
  name: string;
  visits: number;
}

export function buildCruisePortsLayer(cruises: Cruise[]): ScatterplotLayer<PortDatum> {
  const byPort = new Map<number, PortDatum>();
  for (const cruise of cruises) {
    for (const stop of cruise.stops) {
      if (stop.isAtSea || !stop.port) continue;
      const existing = byPort.get(stop.port.id);
      if (existing) {
        existing.visits += 1;
      } else {
        byPort.set(stop.port.id, {
          position: [stop.port.lon, stop.port.lat],
          portId: stop.port.id,
          name: stop.port.name,
          visits: 1,
        });
      }
    }
  }

  return new ScatterplotLayer<PortDatum>({
    id: "cruise-ports",
    data: Array.from(byPort.values()),
    getPosition: (d) => d.position,
    getRadius: (d) => 4 + Math.min(d.visits, 10) * 0.6,
    radiusUnits: "pixels",
    getFillColor: [56, 189, 248, 220],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });
}
```

- [ ] **Step 3: Verify compile**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Map/CruiseArcsLayer.ts frontend/src/components/Map/CruisePortsLayer.ts
git commit -m "feat(cruise): deck.gl cruise arcs + ports layers"
```

### Task 7.3: Mount cruise layers on shared map

**Files:**
- Modify: `frontend/src/components/Map/MapContainer3D.tsx`
- Modify: `frontend/src/components/Map/VisModeSelector.tsx` (if layer toggles live there)

- [ ] **Step 1: Import the cruise builders, fetch cruises alongside flights**

Inside `MapContainer3D.tsx`, add near the flights-fetching hook:

```typescript
import { useEffect, useState } from "react";
import { cruiseApi } from "../../lib/cruiseApi";
import type { Cruise } from "../../types/cruise";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { buildCruiseArcsLayer } from "./CruiseArcsLayer";
import { buildCruisePortsLayer } from "./CruisePortsLayer";

const [cruises, setCruises] = useState<Cruise[]>([]);
const { isEnabled } = useEnabledDomains();

useEffect(() => {
  if (!isEnabled("cruise")) return;
  let cancelled = false;
  void cruiseApi.list().then((data) => {
    if (!cancelled) setCruises(data);
  });
  return () => {
    cancelled = true;
  };
}, [isEnabled]);
```

(Adapt to the file's existing data-fetching style — if it uses React Query, add a `useQuery(['cruises'], cruiseApi.list, { enabled: isEnabled('cruise') })`.)

- [ ] **Step 2: Register layers in the deck.gl layers array, behind a toggle**

Add a `showCruises` state (default `true` when domain enabled). When `showCruises && isEnabled('cruise')`, include `buildCruiseArcsLayer(cruises)` and `buildCruisePortsLayer(cruises)` in the layers list. Flight layers remain unchanged.

- [ ] **Step 3: Add toggle to `VisModeSelector`**

Add a checkbox / chip labeled `{t("cruise:map.layer")}` that toggles `showCruises`. Only render the toggle when `isEnabled("cruise")` returns true.

- [ ] **Step 4: Manual smoke test**

With dev server running (`npm run dev`), temporarily flip `cruise` to `available: true`, enable cruise in Settings, create one cruise with 3 ports via the list page, reload `/map`. Expect to see the toggle and — when enabled — port rings + curved arcs.

- [ ] **Step 5: Revert the temporary flip, run TS check + vitest**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Map/MapContainer3D.tsx frontend/src/components/Map/VisModeSelector.tsx
git commit -m "feat(cruise): mount cruise layers on shared map + toggle"
```

---

## Phase 8 — Achievements

### Task 8.1: Extend `AchievementDefinition` with `domain`

**Files:**
- Modify: `backend/src/data/achievements.ts`
- Modify: `backend/src/data/achievementSeeds/partA.ts`
- Modify: `backend/src/data/achievementSeeds/partB.ts`
- Create: `backend/src/data/__tests__/seedDomains.test.ts`

- [ ] **Step 1: Add `domain` field to the `AchievementDefinition` interface**

In `backend/src/data/achievements.ts`:

```typescript
export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  domain: "flight" | "cruise" | "shared";
  icon: string;
  tier: string;
  requirement: number;
  requirementType: string;
  points: number;
  isHidden?: boolean;
}
```

- [ ] **Step 2: Extend `ensureAchievements()` to write `domain` on upsert**

Locate the upsert/create call inside `ensureAchievements()`. Ensure `domain: def.domain` is passed in both `create` and `update` branches.

- [ ] **Step 3: Add `domain: 'flight'` to every entry in `partA.ts` and `partB.ts`**

Use search/replace across the two files. Then **upgrade** the country/continent codes (COUNTRIES_*, CONTINENTS_*) to `domain: 'shared'`. The exact list:

- Any code with `requirementType: 'countries'`
- Any code with `requirementType: 'continents'`

Find them via:

```bash
cd backend && grep -n "countries\|continents" src/data/achievementSeeds/*.ts | head -40
```

Change their domain from `'flight'` to `'shared'`.

- [ ] **Step 4: Write the guard test**

`backend/src/data/__tests__/seedDomains.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import { achievements } from '../achievements';

describe('achievement seed domains', () => {
  it('every achievement has a domain', () => {
    for (const a of achievements) {
      expect(a.domain).toBeTruthy();
    }
  });

  it('country/continent achievements are shared', () => {
    for (const a of achievements) {
      if (a.requirementType === 'countries' || a.requirementType === 'continents') {
        expect(a.domain).toBe('shared');
      }
    }
  });
});
```

- [ ] **Step 5: Verify tests + compile**

```bash
cd backend && npx tsc --noEmit && npx jest data/__tests__/seedDomains -- --forceExit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/data/achievements.ts backend/src/data/achievementSeeds/partA.ts backend/src/data/achievementSeeds/partB.ts backend/src/data/__tests__/seedDomains.test.ts
git commit -m "feat(cruise): annotate existing achievements with domain; country/continent -> shared"
```

### Task 8.2: Cruise + shared seed definitions (Part C)

**Files:**
- Create: `backend/src/data/achievementSeeds/partC.ts`
- Modify: `backend/src/data/achievements.ts`

- [ ] **Step 1: Implement Part C with the 27 cruise + 5 shared codes from the spec**

`backend/src/data/achievementSeeds/partC.ts`:

```typescript
import type { AchievementDefinition } from '../achievements';

export const seedsPartC: AchievementDefinition[] = [
  // Cruise count
  { code: 'FIRST_CRUISE', name: 'Leinen los', description: 'Erste Kreuzfahrt erledigt', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'bronze', requirement: 1, requirementType: 'cruises_count', points: 15 },
  { code: 'SEA_EXPLORER_5', name: 'Sea Explorer', description: '5 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'silver', requirement: 5, requirementType: 'cruises_count', points: 35 },
  { code: 'CRUISE_ENTHUSIAST_10', name: 'Cruise Enthusiast', description: '10 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'gold', requirement: 10, requirementType: 'cruises_count', points: 60 },
  { code: 'SEVEN_SEAS_25', name: 'Seven Seas', description: '25 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🌊', tier: 'platinum', requirement: 25, requirementType: 'cruises_count', points: 120 },
  { code: 'NEPTUNES_FAVORITE_50', name: "Neptune's Favorite", description: '50 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🔱', tier: 'diamond', requirement: 50, requirementType: 'cruises_count', points: 250 },

  // Ports
  { code: 'PORT_HOPPER_5', name: 'Port Hopper', description: '5 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '⚓', tier: 'bronze', requirement: 5, requirementType: 'cruise_ports_unique', points: 15 },
  { code: 'HARBOR_TOUR_25', name: 'Harbor Tour', description: '25 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '⚓', tier: 'silver', requirement: 25, requirementType: 'cruise_ports_unique', points: 40 },
  { code: 'HARBOR_MASTER_50', name: 'Harbor Master', description: '50 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '🏴‍☠️', tier: 'gold', requirement: 50, requirementType: 'cruise_ports_unique', points: 80 },
  { code: 'MEGA_CRUISE_10', name: 'Mega Cruise', description: '10+ Häfen in einer Kreuzfahrt', category: 'special', domain: 'cruise', icon: '🗺️', tier: 'platinum', requirement: 10, requirementType: 'cruise_ports_single', points: 100 },

  // Ships
  { code: 'CAPTAINS_LOG_1', name: "Captain's Log", description: 'Erstes Schiff', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'bronze', requirement: 1, requirementType: 'cruise_ships_unique', points: 10 },
  { code: 'FLEET_SAMPLER_5', name: 'Fleet Sampler', description: '5 verschiedene Schiffe', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'silver', requirement: 5, requirementType: 'cruise_ships_unique', points: 30 },
  { code: 'NAVAL_CURATOR_15', name: 'Naval Curator', description: '15 verschiedene Schiffe', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'gold', requirement: 15, requirementType: 'cruise_ships_unique', points: 75 },

  // Cruise line
  { code: 'LOYAL_SAILOR_3', name: 'Loyal Sailor', description: '3 Kreuzfahrten mit derselben Reederei', category: 'collector', domain: 'cruise', icon: '🎖️', tier: 'bronze', requirement: 3, requirementType: 'cruise_line_loyalty', points: 15 },
  { code: 'LINE_HOPPER_5', name: 'Line Hopper', description: '5 verschiedene Reedereien', category: 'collector', domain: 'cruise', icon: '🎖️', tier: 'silver', requirement: 5, requirementType: 'cruise_lines_unique', points: 40 },
  { code: 'CARNIVAL_COLLECTOR', name: 'Carnival Collector', description: 'Alle Carnival-Marken befahren', category: 'collector', domain: 'cruise', icon: '🎠', tier: 'gold', requirement: 1, requirementType: 'carnival_brands_all', points: 90, isHidden: true },

  // Sea days
  { code: 'SEA_LEGS_1', name: 'Sea Legs', description: 'Erster Seetag', category: 'special', domain: 'cruise', icon: '🌊', tier: 'bronze', requirement: 1, requirementType: 'sea_days', points: 10 },
  { code: 'SALT_DOG_30', name: 'Salt Dog', description: '30 Seetage gesamt', category: 'special', domain: 'cruise', icon: '🌊', tier: 'silver', requirement: 30, requirementType: 'sea_days', points: 40 },
  { code: 'TRANSATLANTIC_7', name: 'Transatlantic', description: '7+ aufeinanderfolgende Seetage', category: 'special', domain: 'cruise', icon: '🌊', tier: 'gold', requirement: 7, requirementType: 'sea_days_streak', points: 80 },

  // Regions
  { code: 'MEDITERRANEAN', name: 'Mediterraner Urlauber', description: 'Mittelmeer besucht', category: 'explorer', domain: 'cruise', icon: '🌞', tier: 'bronze', requirement: 1, requirementType: 'cruise_region_mediterranean', points: 15 },
  { code: 'CARIBBEAN', name: 'Karibikfahrer', description: 'Karibik besucht', category: 'explorer', domain: 'cruise', icon: '🏝️', tier: 'bronze', requirement: 1, requirementType: 'cruise_region_caribbean', points: 15 },
  { code: 'BALTIC_OR_FJORDS', name: 'Nordische Route', description: 'Ostsee oder Fjorde', category: 'explorer', domain: 'cruise', icon: '❄️', tier: 'silver', requirement: 1, requirementType: 'cruise_region_baltic_or_fjords', points: 30 },
  { code: 'CANAL_TRANSIT', name: 'Canal Transit', description: 'Panama- oder Suezkanal', category: 'special', domain: 'cruise', icon: '🛶', tier: 'gold', requirement: 1, requirementType: 'cruise_canal_transit', points: 80 },
  { code: 'POLAR_EXPLORER', name: 'Polar Explorer', description: 'Antarktis oder Nordwestpassage', category: 'special', domain: 'cruise', icon: '🧊', tier: 'platinum', requirement: 1, requirementType: 'cruise_polar', points: 150 },

  // Cabin
  { code: 'BALCONY_FIRST', name: 'Erster Balkon', description: 'Erste Balkonkabine', category: 'special', domain: 'cruise', icon: '🪟', tier: 'bronze', requirement: 1, requirementType: 'cruise_cabin_balcony', points: 10 },
  { code: 'SUITE_FIRST', name: 'Erste Suite', description: 'Erste Suite', category: 'special', domain: 'cruise', icon: '🛏️', tier: 'silver', requirement: 1, requirementType: 'cruise_cabin_suite', points: 25 },
  { code: 'TOP_DECK', name: 'Top Deck', description: 'Deck 12 oder höher', category: 'special', domain: 'cruise', icon: '⬆️', tier: 'gold', requirement: 12, requirementType: 'cruise_deck_min', points: 40 },

  // Special
  { code: 'BIRTHDAY_AT_SEA', name: 'Birthday at Sea', description: 'Geburtstag auf See', category: 'special', domain: 'cruise', icon: '🎂', tier: 'silver', requirement: 1, requirementType: 'cruise_birthday_at_sea', points: 30 },
  { code: 'NEW_YEARS_AT_SEA', name: "New Year's at Sea", description: 'Silvester auf See', category: 'special', domain: 'cruise', icon: '🎇', tier: 'gold', requirement: 1, requirementType: 'cruise_new_years_at_sea', points: 60 },
  { code: 'COLD_WATER_CRUISER', name: 'Cold Water Cruiser', description: 'Island, Alaska oder Antarktis', category: 'special', domain: 'cruise', icon: '🥶', tier: 'silver', requirement: 1, requirementType: 'cruise_cold_water', points: 30 },

  // Shared
  { code: 'WORLD_TRAVELER', name: 'World Traveler', description: '25 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'silver', requirement: 25, requirementType: 'countries', points: 50 },
  { code: 'GLOBE_TREKKER', name: 'Globe Trekker', description: '50 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'gold', requirement: 50, requirementType: 'countries', points: 100 },
  { code: 'CENTURION', name: 'Centurion', description: '100 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'diamond', requirement: 100, requirementType: 'countries', points: 300 },
  { code: 'SEVEN_CONTINENTS_CLUB', name: 'Seven Continents Club', description: 'Alle 7 Kontinente', category: 'explorer', domain: 'shared', icon: '🌐', tier: 'platinum', requirement: 7, requirementType: 'continents', points: 200 },
  { code: 'FLY_AND_SAIL', name: 'Fly & Sail', description: 'Trip mit Flug UND Kreuzfahrt', category: 'special', domain: 'shared', icon: '✈️🚢', tier: 'gold', requirement: 1, requirementType: 'fly_and_sail_trip', points: 60 },
];
```

Dedupe note: `WORLD_TRAVELER`, `GLOBE_TREKKER`, `CENTURION`, `SEVEN_CONTINENTS_CLUB` codes may already exist in `partA.ts` / `partB.ts` with `domain: 'shared'` from Task 8.1. If so, remove them from Part C to avoid duplicates (codes are unique per the Prisma `@unique` constraint). Run `grep 'WORLD_TRAVELER\|GLOBE_TREKKER\|CENTURION\|SEVEN_CONTINENTS_CLUB' backend/src/data/achievementSeeds/*.ts` to decide.

- [ ] **Step 2: Compose in `backend/src/data/achievements.ts`**

```typescript
import { seedsPartC } from './achievementSeeds/partC';
export const achievements: AchievementDefinition[] = [...seedsPartA, ...seedsPartB, ...seedsPartC];
```

- [ ] **Step 3: Verify compile + guard test still passes**

```bash
cd backend && npx tsc --noEmit && npx jest data/__tests__/seedDomains -- --forceExit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/data/achievementSeeds/partC.ts backend/src/data/achievements.ts
git commit -m "feat(cruise): achievement Part C (27 cruise + 5 shared)"
```

### Task 8.3: Cruise stats helper

**Files:**
- Create: `backend/src/utils/cruiseStats.ts`
- Create: `backend/src/utils/__tests__/cruiseStats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { calculateCruiseStats, type CruiseData } from '../cruiseStats';

const port = (id: number, region: string, country: string) =>
  ({ id, name: `P${id}`, region, country, lat: 0, lon: 0, unlocode: null, city: null, timezone: null, isUserAdded: false });

describe('calculateCruiseStats', () => {
  const sampleCruises: CruiseData[] = [
    {
      id: 'c1',
      shipId: 1,
      cruiseLine: 'AIDA Cruises',
      cabinType: 'balcony',
      deck: 7,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-08'),
      stops: [
        { portId: 1, port: port(1, 'mediterranean', 'Spain'), dayNumber: 1, isAtSea: false },
        { portId: null, port: null, dayNumber: 2, isAtSea: true },
        { portId: null, port: null, dayNumber: 3, isAtSea: true },
        { portId: 2, port: port(2, 'mediterranean', 'France'), dayNumber: 4, isAtSea: false },
      ],
    },
    {
      id: 'c2',
      shipId: 2,
      cruiseLine: 'TUI Cruises',
      cabinType: 'suite',
      deck: 14,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-08'),
      stops: [
        { portId: 3, port: port(3, 'caribbean', 'Bahamas'), dayNumber: 1, isAtSea: false },
        { portId: 4, port: port(4, 'caribbean', 'Puerto Rico'), dayNumber: 2, isAtSea: false },
      ],
    },
  ];

  it('counts cruises', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisesCount).toBe(2);
  });

  it('counts unique ports and ships across cruises', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisePortsUnique).toBe(4);
    expect(s.cruiseShipsUnique).toBe(2);
  });

  it('counts sea days total and max streak', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.seaDays).toBe(2);
    expect(s.seaDaysStreak).toBe(2);
  });

  it('detects max ports in a single cruise', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisePortsSingleMax).toBe(2);
  });

  it('tracks unique lines and loyalty count', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruiseLinesUnique).toBe(2);
    expect(s.cruiseLineLoyaltyMax).toBe(1);
  });

  it('exposes region flags', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.regions.has('mediterranean')).toBe(true);
    expect(s.regions.has('caribbean')).toBe(true);
  });

  it('picks min cabin tier', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.hasBalconyCabin).toBe(true);
    expect(s.hasSuiteCabin).toBe(true);
    expect(s.maxDeck).toBe(14);
  });

  it('countries set includes ports countries', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.countries.has('Spain')).toBe(true);
    expect(s.countries.has('Bahamas')).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement**

```typescript
export interface CruisePortData {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  unlocode: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
  isUserAdded: boolean;
}

export interface CruiseStopData {
  portId: number | null;
  port: CruisePortData | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: Date | null;
  departureTime?: Date | null;
}

export interface CruiseData {
  id: string;
  shipId: number | null;
  cruiseLine: string | null;
  cabinType: string | null;
  deck: number | null;
  startDate: Date | null;
  endDate: Date | null;
  stops: CruiseStopData[];
}

export interface CruiseStats {
  cruisesCount: number;
  cruisePortsUnique: number;
  cruisePortsSingleMax: number;
  cruiseShipsUnique: number;
  cruiseLinesUnique: number;
  cruiseLineLoyaltyMax: number;
  seaDays: number;
  seaDaysStreak: number;
  regions: Set<string>;
  countries: Set<string>;
  hasBalconyCabin: boolean;
  hasSuiteCabin: boolean;
  maxDeck: number;
  hasCanalTransit: boolean;
  hasPolar: boolean;
  hasColdWater: boolean;
  hasBirthdayAtSea: boolean;
  hasNewYearsAtSea: boolean;
}

const CANAL_UNLOCODES = new Set(['PACTB', 'EGPSD']); // Panama Colón, Port Said
const POLAR_REGIONS = new Set(['antarctic', 'polar']);
const COLD_WATER_COUNTRIES = new Set(['Iceland', 'Antarctica', 'Greenland']);
const COLD_WATER_REGIONS = new Set(['alaska', 'polar', 'antarctic']);

export function calculateCruiseStats(cruises: CruiseData[], userBirthday?: { month: number; day: number }): CruiseStats {
  const portIds = new Set<number>();
  const shipIds = new Set<number>();
  const lines = new Set<string>();
  const regions = new Set<string>();
  const countries = new Set<string>();
  const lineCounts = new Map<string, number>();

  let seaDays = 0;
  let seaDaysStreak = 0;
  let cruisePortsSingleMax = 0;
  let hasBalconyCabin = false;
  let hasSuiteCabin = false;
  let maxDeck = 0;
  let hasCanalTransit = false;
  let hasPolar = false;
  let hasColdWater = false;
  let hasBirthdayAtSea = false;
  let hasNewYearsAtSea = false;

  for (const cruise of cruises) {
    if (cruise.shipId !== null) shipIds.add(cruise.shipId);
    if (cruise.cruiseLine) {
      lines.add(cruise.cruiseLine);
      lineCounts.set(cruise.cruiseLine, (lineCounts.get(cruise.cruiseLine) ?? 0) + 1);
    }
    if (cruise.cabinType === 'balcony' || cruise.cabinType === 'suite') hasBalconyCabin = true;
    if (cruise.cabinType === 'suite') hasSuiteCabin = true;
    if (cruise.deck !== null && cruise.deck > maxDeck) maxDeck = cruise.deck;

    const sortedStops = [...cruise.stops].sort((a, b) => a.dayNumber - b.dayNumber);
    let cruisePortCount = 0;
    let currentSeaStreak = 0;
    for (const stop of sortedStops) {
      if (stop.isAtSea) {
        seaDays += 1;
        currentSeaStreak += 1;
        if (currentSeaStreak > seaDaysStreak) seaDaysStreak = currentSeaStreak;
      } else {
        currentSeaStreak = 0;
        if (stop.port) {
          portIds.add(stop.port.id);
          cruisePortCount += 1;
          if (stop.port.country) countries.add(stop.port.country);
          if (stop.port.region) regions.add(stop.port.region);
          if (stop.port.unlocode && CANAL_UNLOCODES.has(stop.port.unlocode)) hasCanalTransit = true;
          if (stop.port.region && POLAR_REGIONS.has(stop.port.region)) hasPolar = true;
          if (
            (stop.port.country && COLD_WATER_COUNTRIES.has(stop.port.country)) ||
            (stop.port.region && COLD_WATER_REGIONS.has(stop.port.region))
          ) {
            hasColdWater = true;
          }
        }
      }
    }
    if (cruisePortCount > cruisePortsSingleMax) cruisePortsSingleMax = cruisePortCount;

    if (userBirthday && cruise.startDate && cruise.endDate) {
      hasBirthdayAtSea = hasBirthdayAtSea || rangeContainsMonthDay(cruise.startDate, cruise.endDate, userBirthday);
    }
    if (cruise.startDate && cruise.endDate) {
      hasNewYearsAtSea = hasNewYearsAtSea || rangeContainsMonthDay(cruise.startDate, cruise.endDate, { month: 12, day: 31 });
    }
  }

  let cruiseLineLoyaltyMax = 0;
  for (const count of lineCounts.values()) {
    if (count > cruiseLineLoyaltyMax) cruiseLineLoyaltyMax = count;
  }

  return {
    cruisesCount: cruises.length,
    cruisePortsUnique: portIds.size,
    cruisePortsSingleMax,
    cruiseShipsUnique: shipIds.size,
    cruiseLinesUnique: lines.size,
    cruiseLineLoyaltyMax,
    seaDays,
    seaDaysStreak,
    regions,
    countries,
    hasBalconyCabin,
    hasSuiteCabin,
    maxDeck,
    hasCanalTransit,
    hasPolar,
    hasColdWater,
    hasBirthdayAtSea,
    hasNewYearsAtSea,
  };
}

function rangeContainsMonthDay(start: Date, end: Date, md: { month: number; day: number }): boolean {
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getUTCMonth() + 1 === md.month && cur.getUTCDate() === md.day) return true;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return false;
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
cd backend && npx jest utils/__tests__/cruiseStats -- --forceExit
git add backend/src/utils/cruiseStats.ts backend/src/utils/__tests__/cruiseStats.test.ts
git commit -m "feat(cruise): calculateCruiseStats covering all achievement dimensions"
```

### Task 8.4: Wire cruise stats into checker

**Files:**
- Modify: `backend/src/utils/achievementStats.ts`
- Modify: `backend/src/utils/achievementChecks.ts`
- Modify: `backend/src/utils/achievements.ts`

- [ ] **Step 1: Extend `UserStats` (in `achievementStats.ts`) with cruise fields**

Merge the fields produced by `calculateCruiseStats` into `UserStats`. Change `calculateUserStats` signature to accept `cruises: CruiseData[]` (default `[]`), call `calculateCruiseStats(cruises)`, and fold the result into the returned object. `countries` set now unions flight-derived countries + cruise-port countries (shared achievements depend on this).

- [ ] **Step 2: Extend `checkAchievement` (in `achievementChecks.ts`)**

Add cases for each new `requirementType`:
- `cruises_count` → `stats.cruisesCount`
- `cruise_ports_unique` → `stats.cruisePortsUnique`
- `cruise_ports_single` → `stats.cruisePortsSingleMax`
- `cruise_ships_unique` → `stats.cruiseShipsUnique`
- `cruise_lines_unique` → `stats.cruiseLinesUnique`
- `cruise_line_loyalty` → `stats.cruiseLineLoyaltyMax`
- `sea_days` → `stats.seaDays`
- `sea_days_streak` → `stats.seaDaysStreak`
- `cruise_region_mediterranean` → `stats.regions.has('mediterranean') ? 1 : 0`
- `cruise_region_caribbean` → same with `'caribbean'`
- `cruise_region_baltic_or_fjords` → `stats.regions.has('baltic') || stats.regions.has('norwegian_fjords') ? 1 : 0`
- `cruise_canal_transit` → `stats.hasCanalTransit ? 1 : 0`
- `cruise_polar` → `stats.hasPolar ? 1 : 0`
- `cruise_cabin_balcony` → `stats.hasBalconyCabin ? 1 : 0`
- `cruise_cabin_suite` → `stats.hasSuiteCabin ? 1 : 0`
- `cruise_deck_min` → `stats.maxDeck`
- `cruise_birthday_at_sea` → `stats.hasBirthdayAtSea ? 1 : 0`
- `cruise_new_years_at_sea` → `stats.hasNewYearsAtSea ? 1 : 0`
- `cruise_cold_water` → `stats.hasColdWater ? 1 : 0`
- `fly_and_sail_trip` → `stats.hasFlyAndSailTrip ? 1 : 0` (compute from `Trip.flights.length > 0 && Trip.cruises.length > 0` inside `calculateUserStats`)
- `carnival_brands_all` — add a constant `CARNIVAL_BRANDS` set (`Costa Cruises`, `AIDA Cruises`, `Carnival Cruise Line`, `Princess Cruises`, `Holland America Line`, `Cunard`, `Seabourn`, `P&O Cruises`); return `1` if all are a subset of `stats.cruiseLines` (add `cruiseLines: Set<string>` to `UserStats`).

- [ ] **Step 3: Extend `checkAndUpdateAchievements` (in `achievements.ts`)**

Fetch cruises alongside flights before calling `calculateUserStats`:

```typescript
const cruises = await prisma.cruise.findMany({
  where: { userId },
  include: { stops: { include: { port: true } }, trip: { include: { flights: true, cruises: true } } },
});
const stats = calculateUserStats(flights, cruises, { birthdate: user?.birthdate ?? null });
```

Adapt `calculateUserStats` to compute `hasFlyAndSailTrip` by inspecting each cruise's `trip` (if present, and the trip has both flights and cruises arrays with length ≥ 1).

- [ ] **Step 4: Run the full achievement test suite**

```bash
cd backend && npx jest utils/__tests__/ -- --forceExit
```

Expected: all existing tests pass, new cruise-path is exercised.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/achievementStats.ts backend/src/utils/achievementChecks.ts backend/src/utils/achievements.ts
git commit -m "feat(cruise): wire cruise stats + new requirementTypes into achievement checker"
```

---

## Phase 9 — Parser integration

### Task 9.1: CruiseData schema

**Files:**
- Create: `backend/src/schemas/cruiseData.ts`

- [ ] **Step 1: Write the schema** mirroring `flightData.ts` conceptually

```typescript
import { z } from 'zod';

export const cruiseStopParsedSchema = z.object({
  portName: z.string().optional(),
  portCountry: z.string().optional(),
  dayNumber: z.number().int().min(1).optional(),
  arrivalTime: z.string().optional(),
  departureTime: z.string().optional(),
  isAtSea: z.boolean().optional(),
});

export const cruiseDataSchema = z.object({
  shipName: z.string().optional(),
  cruiseLine: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  departurePortName: z.string().optional(),
  arrivalPortName: z.string().optional(),
  cabinNumber: z.string().optional(),
  cabinType: z.enum(['inside', 'oceanview', 'balcony', 'suite']).optional(),
  deck: z.number().int().optional(),
  bookingReference: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  stops: z.array(cruiseStopParsedSchema).optional(),
});

export type CruiseData = z.infer<typeof cruiseDataSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/schemas/cruiseData.ts
git commit -m "feat(cruise): CruiseData Zod schema for parser output"
```

### Task 9.2: AIDA + TUI seed templates

**Files:**
- Create: `backend/src/services/parsers/cruiseTemplates/aida.ts`
- Create: `backend/src/services/parsers/cruiseTemplates/tui.ts`
- Create: `backend/src/services/parsers/cruiseTemplates/index.ts`

Template content is regex patterns + a fingerprint (matches if sender or subject contains known strings). Look at `backend/src/services/parsers/*.ts` from Foundation to match the existing template shape — if Foundation introduced a `CruiseTemplate` or generic `Template` interface, use it; otherwise export plain objects and adapt when the registry file lands.

- [ ] **Step 1: Implement AIDA template** with fingerprint (`from` contains `aida.de`, subject matches `/reiseunterlagen|buchungsbestätigung/i`) and patterns for ship name (`/Schiff:\s*(.+)/`), dates (`/Reise:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/`), cabin, deck, booking reference, ports list. Ports block is an ordered list like `Tag 1 – Hamburg – An: 18:00\nTag 2 – Seetag\nTag 3 – Bergen – An: 08:00 / Ab: 17:00`.

- [ ] **Step 2: Implement TUI template** with fingerprint (`from` contains `tuicruises.com` or `meinschiff.com`, subject matches `/buchungsbestätigung|reiseunterlagen/i`) and similar pattern set. Ship name is typically in a header like `Ihre Kreuzfahrt mit der Mein Schiff 3`.

- [ ] **Step 3: `index.ts` exports both**

```typescript
export { aidaTemplate } from './aida';
export { tuiTemplate } from './tui';
export const cruiseTemplates = [require('./aida').aidaTemplate, require('./tui').tuiTemplate];
```

- [ ] **Step 4: Register in the parser template loader** — find the file that Foundation modified to add `domain` to `ParserTemplate`. Register these two as system seed templates (userId = `null` or a known system UUID, matching how flight seeds are registered; if there is no analogous flight seed, add them as in-memory registry entries consulted when `domain === 'cruise'`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/cruiseTemplates
git commit -m "feat(cruise): AIDA + TUI seed parser templates"
```

### Task 9.3: LLM prompt branching

**Files:**
- Modify: parser service that invokes the LLM (e.g. `backend/src/services/ollamaVisionParser.ts`, `backend/src/services/bookingParser.ts`, whichever orchestrates LLM calls — Foundation standardized these around a domain discriminator)

- [ ] **Step 1: Route cruise parses to a cruise system prompt**

Where the LLM call today uses `FlightData` as the target schema, branch on `domain`:
- `domain === 'flight'` → existing behavior, extract `FlightData`
- `domain === 'cruise'` → system prompt asks for `CruiseData`-shaped JSON (fields named in `cruiseDataSchema`), parse response through `cruiseDataSchema.safeParse`.

Pull the system prompt into a constant `CRUISE_SYSTEM_PROMPT` that lists each field in German + English synonyms and shows one fully-worked example JSON.

- [ ] **Step 2: Save parsed cruise output to `Cruise` + `CruiseStop`**

When a cruise parse succeeds (confidence ≥ threshold), create `Cruise` + its `CruiseStop`s using the same service that flights use — the caller passes a target-domain discriminator. For each parsed port name, call a `resolvePortByName(name)` helper that looks up `Port` by case-insensitive name + country, falling back to `prisma.port.create({ ..., isUserAdded: true })` when no match. Same for `Ship` via IMO or name.

- [ ] **Step 3: Gate parser entry points on enabled domains**

Foundation already wired `domain` into the parser route validation. Confirm that an `emailParse` / `pdfParse` / `boardingpassParse` POST with `domain=cruise` is rejected with 403 when the authenticated user's `enabledDomains` does not include `'cruise'`. If not yet wired, add that check inside the route handler (before kicking off the parse).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cruise): LLM prompt + save pipeline branches on domain=cruise"
```

---

## Phase 10 — Trip integration + activation + final wrap-up

### Task 10.1: Trip response includes cruises

**Files:**
- Modify: `backend/src/routes/trips.ts`

- [ ] **Step 1: Add `cruises` to the include block** for GET `/trips` and GET `/trips/:id`:

```typescript
include: {
  flights: true,
  cruises: {
    include: {
      ship: true,
      departurePort: true,
      arrivalPort: true,
      stops: { include: { port: true }, orderBy: { dayNumber: 'asc' } },
    },
  },
  bookings: true,
}
```

- [ ] **Step 2: Update frontend `Trip` type** (`frontend/src/types/trip.ts` or equivalent) to include `cruises: Cruise[]`.

- [ ] **Step 3: Extend Trip detail view** to render cruises in the polymorphic `<TripTimeline />` from Foundation. Pass `events = [...trip.flights.map(toFlightEvent), ...trip.cruises.map(toCruiseEvent)]` sorted by start date.

- [ ] **Step 4: Run full test suite**

```bash
cd backend && npx jest -- --forceExit
cd ../frontend && npx vitest --run
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cruise): trips include cruises; timeline renders interleaved events"
```

### Task 10.2: AdvancedStatsPage + Dashboard cruise sections

**Files:**
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: AdvancedStatsPage — add cruise KPI block**

Foundation introduced domain filtering. Under that, render a "Kreuzfahrten" block when `cruise` is enabled + selected: cruise count, ports visited, sea days, unique ships, unique lines. Data comes from a new `statsApi.cruiseSummary()` call or computed client-side from `cruiseApi.list()`.

- [ ] **Step 2: DashboardPage — add cruise KPI card**

Add a summary card next to the flights KPI cards that shows cruise count + next upcoming cruise. Gate via `isEnabled('cruise')`.

- [ ] **Step 3: Smoke test under dev server.** Toggle `cruise` to `available: true` temporarily, enable in Settings, create a cruise, confirm both pages render it. Revert the flip.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cruise): stats + dashboard cruise blocks gated by enabledDomains"
```

### Task 10.3: Activate the domain

**Files:**
- Modify: `backend/src/shared/domains.ts`
- Modify: `frontend/src/shared/domains.ts`

- [ ] **Step 1: Flip `cruise.available` to `true`** in both files. That's the only change. Do not touch other fields.

- [ ] **Step 2: Full build check**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

All green.

- [ ] **Step 3: Manual end-to-end smoke**

Dev server up. Log in, go to Settings → Bereiche. Confirm `Kreuzfahrten` is now toggleable (it was hidden before because `available=false`). Enable it. Confirm:
- Nav bar shows Cruise link.
- `/cruises` loads the empty list.
- Create a cruise with 3 ports → detail page renders → Edit works.
- `/map` shows the cruise toggle, arcs, and port rings.
- Achievements page shows cruise + shared codes.
- Parser page's domain picker now lists `cruise`; AIDA/TUI templates visible.

- [ ] **Step 4: Commit**

```bash
git add backend/src/shared/domains.ts frontend/src/shared/domains.ts
git commit -m "feat(cruise): activate domain (available=true) after full implementation"
```

### Task 10.4: Document in CLAUDE.md gotchas

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append cruise-specific gotchas** to the existing "Critical Gotchas" section:

```markdown
- **Cruise stops** — each stop is either a port call (`portId` set, `isAtSea = false`)
  or a sea day (`portId = null`, `isAtSea = true`). Zod rejects the union where
  both are unset. Always renumber `dayNumber` as `index + 1` after add/remove
  in the frontend editor to keep numbering stable.
- **Cruise arcs are cosmetic** — `buildCruiseArc` uses a Bezier perpendicular
  offset, not real sea-route pathfinding. Arcs may cross continents. Documented,
  deferred to V2.
- **Ship + Port seeds are idempotent** — `seedShipsFromCSV` / `seedPortsFromCSV`
  skip rows whose `imo` / `unlocode` already exists. User-added rows
  (`isUserAdded=true`) are never overwritten by re-seeding.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(cruise): document cruise-specific gotchas"
```

### Task 10.5: Update MEMORY.md

**Files:**
- Modify: `C:\Users\Dennis Wittke\.claude\projects\D--Projekte-TravStats\memory\project_multi_domain_refactor.md`
- Modify: `C:\Users\Dennis Wittke\.claude\projects\D--Projekte-TravStats\memory\MEMORY.md` (index)

- [ ] **Step 1: Mark the cruise module as implemented (but not yet deployed)** in the existing multi-domain-refactor memory note. Add a `**Status (2026-04-19):**` line: "Foundation + Cruise implementation complete on `dev/multi-domain-v1`. Not yet promoted to `main`. User decides when to deploy."

No commit needed — memory files live outside the repo.

---

## Self-Review Checklist

Run through after executing the plan:

- [ ] Every section of the cruise spec (`2026-04-19-cruise-module-design.md`) maps to a task:
  - Data model → Tasks 1.1, 1.2
  - Seed catalogs → Tasks 2.1–2.5
  - Lookup APIs → Tasks 3.1, 3.2
  - CRUD → Tasks 4.1, 4.2
  - Frontend types + API client + i18n → Tasks 5.1–5.3
  - List / detail / edit / nav → Tasks 6.1–6.7
  - Map layer → Tasks 7.1–7.3
  - Achievements → Tasks 8.1–8.4
  - Parser templates → Tasks 9.1–9.3
  - Trip integration, stats, activation, docs → Tasks 10.1–10.5
- [ ] No TBD / placeholder / "similar to Task N" text remains.
- [ ] Every code block defines its types inline or references an earlier-declared type.
- [ ] Every test step has a matching run command with expected output.
- [ ] Every task ends with an explicit commit step.
- [ ] Branch strategy is honored: all commits land on `dev/multi-domain-v1`, never on `main`, no deploy until user promotes.
