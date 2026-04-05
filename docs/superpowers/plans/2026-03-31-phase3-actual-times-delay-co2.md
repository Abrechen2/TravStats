# Phase 3: Actual Times, Delay-Tracking & CO₂ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store actual departure/arrival times and per-flight CO₂ on each Flight record, auto-calculate delay in minutes and CO₂ on save, and surface both values in the FlightList and FlightEditModal.

**Architecture:** Four new nullable columns on the `flights` DB table (`actualDeparture`, `actualArrival`, `delayMinutes`, `co2Kg`). A pure `co2Calculator.ts` service computes CO₂ from distance + seat class on every create/update. `delayMinutes` is derived automatically from `actualDeparture` vs `departureTime`. The frontend adds actual-time inputs to the edit modal and shows a delay badge + CO₂ chip on each flight row.

**Tech Stack:** Prisma migrations, TypeScript, Zod, React, react-i18next (`useTranslation` wrapper), Vitest (frontend), Jest (backend).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add 4 new fields to Flight model |
| Create | `backend/prisma/migrations/20260331000000_add_actual_times_and_co2/migration.sql` | DB migration |
| Create | `backend/src/services/co2Calculator.ts` | Pure CO₂ calculation (distance × factor × cabin) |
| Create | `backend/src/services/__tests__/co2Calculator.test.ts` | Unit tests |
| Modify | `backend/src/schemas/flight.ts` | Add `actualDeparture`, `actualArrival` to Zod schema |
| Modify | `backend/src/routes/flights.ts` | Calculate + persist `co2Kg` and `delayMinutes` on create/update |
| Modify | `frontend/src/types/index.ts` | Add 4 fields to `Flight` + `FlightInput` interfaces |
| Modify | `frontend/src/components/FlightEditModal.tsx` | Actual time inputs |
| Modify | `frontend/src/components/FlightList.tsx` | Delay badge + CO₂ chip per row |
| Modify | `frontend/src/i18n/resources/de/flights.json` | DE strings |
| Modify | `frontend/src/i18n/resources/en/flights.json` | EN strings |

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260331000000_add_actual_times_and_co2/migration.sql`

- [ ] **Add 4 fields to Flight model in `schema.prisma`**

Find the `// Phase 1: Email Template Parsing` comment block in the Flight model. Add before it:

```prisma
  // Phase 3: Actual Times, Delay, CO₂
  actualDeparture     DateTime? @map("actual_departure")   // Actual wheels-off time (user-entered)
  actualArrival       DateTime? @map("actual_arrival")     // Actual wheels-on time (user-entered)
  delayMinutes        Int?      @map("delay_minutes")      // actualDeparture - departureTime in minutes (negative = early)
  co2Kg               Float?    @map("co2_kg")             // Calculated CO₂ in kg (distance × factor × cabin multiplier)
```

- [ ] **Create migration SQL file**

Create the directory and file at `backend/prisma/migrations/20260331000000_add_actual_times_and_co2/migration.sql`:

```sql
-- Phase 3: Add actual flight times, delay tracking and per-flight CO₂
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "actual_departure" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "actual_arrival"   TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "delay_minutes"    INTEGER;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "co2_kg"           DOUBLE PRECISION;
```

- [ ] **Run migration (requires running PostgreSQL)**

```bash
cd /d/Projekte/TravStats/backend && npx prisma migrate dev --name add_actual_times_and_co2
```

If DB is not available, run:
```bash
cd /d/Projekte/TravStats/backend && npx prisma generate
```
(The client will be regenerated to include the new fields; migration will run on next deploy.)

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/prisma/schema.prisma backend/prisma/migrations/20260331000000_add_actual_times_and_co2/
git commit -m "feat: add actualDeparture, actualArrival, delayMinutes, co2Kg to Flight schema"
```

---

## Task 2: CO₂ Calculator Service (TDD)

**Files:**
- Create: `backend/src/services/co2Calculator.ts`
- Create: `backend/src/services/__tests__/co2Calculator.test.ts`

- [ ] **Write failing tests**

Create `backend/src/services/__tests__/co2Calculator.test.ts`:

```typescript
import { calculateCo2Kg, CABIN_FACTORS } from '../co2Calculator';

describe('calculateCo2Kg', () => {
  it('returns null when coordinates are missing', () => {
    expect(calculateCo2Kg({ depLat: null, depLon: null, arrLat: 48.3, arrLon: 11.7, seatClass: null })).toBeNull();
    expect(calculateCo2Kg({ depLat: 52.5, depLon: 13.4, arrLat: null, arrLon: null, seatClass: null })).toBeNull();
  });

  it('calculates economy CO₂ for short haul (FRA→MUC ~300km)', () => {
    // FRA: 50.033°N, 8.571°E — MUC: 48.354°N, 11.786°E
    const kg = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' });
    expect(kg).not.toBeNull();
    // distance ~300km × 0.255 kg/km × 1.0 cabin = ~76.5 kg — allow wide range due to haversine precision
    expect(kg!).toBeGreaterThan(50);
    expect(kg!).toBeLessThan(120);
  });

  it('calculates business CO₂ as 2.9× economy for same route', () => {
    const eco = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' })!;
    const biz = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'business' })!;
    expect(biz / eco).toBeCloseTo(CABIN_FACTORS.business / CABIN_FACTORS.economy, 2);
  });

  it('uses long-haul emission factor for distances ≥1500km', () => {
    // FRA (50.033, 8.571) → JFK (40.640, -73.779) ~6200km
    const kgEco = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 40.640, arrLon: -73.779, seatClass: 'economy' })!;
    // 6200km × 0.195 kg/km = ~1209 kg
    expect(kgEco).toBeGreaterThan(800);
    expect(kgEco).toBeLessThan(1800);
  });

  it('defaults to economy factor when seatClass is null', () => {
    const withNull = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: null });
    const withEco  = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' });
    expect(withNull).toBe(withEco);
  });

  it('returns a positive rounded integer', () => {
    const kg = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'first' })!;
    expect(Number.isInteger(kg)).toBe(true);
    expect(kg).toBeGreaterThan(0);
  });
});
```

- [ ] **Run — expect FAIL**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/services/__tests__/co2Calculator.test.ts --forceExit 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../co2Calculator'`

- [ ] **Implement `co2Calculator.ts`**

Create `backend/src/services/co2Calculator.ts`:

```typescript
/**
 * CO₂ Footprint Calculator
 *
 * Formula: distance_km × emissionFactor × cabinFactor
 * Emission factors (kg CO₂ per passenger per km):
 *   Short haul (<1500 km): 0.255 kg/km
 *   Long haul  (≥1500 km): 0.195 kg/km
 *
 * Cabin multipliers based on ICAO Carbon Emissions Calculator methodology:
 *   Economy         1.0  (baseline)
 *   Premium Economy 1.6
 *   Business        2.9
 *   First           4.0
 */

const SHORT_HAUL_THRESHOLD_KM = 1500;
const SHORT_HAUL_FACTOR = 0.255; // kg CO₂ per passenger km
const LONG_HAUL_FACTOR  = 0.195; // kg CO₂ per passenger km

export const CABIN_FACTORS = {
  economy:          1.0,
  premium_economy:  1.6,
  business:         2.9,
  first:            4.0,
} as const;

type SeatClass = keyof typeof CABIN_FACTORS | null | undefined;

interface Co2Input {
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  seatClass: SeatClass;
}

/**
 * Haversine distance in kilometres between two coordinates.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate CO₂ footprint in kg for a single flight leg.
 * Returns null when coordinates are unavailable (cannot compute distance).
 * Returns a positive rounded integer.
 */
export function calculateCo2Kg(input: Co2Input): number | null {
  const { depLat, depLon, arrLat, arrLon, seatClass } = input;

  if (depLat == null || depLon == null || arrLat == null || arrLon == null) {
    return null;
  }

  const distanceKm = haversineKm(depLat, depLon, arrLat, arrLon);
  const emissionFactor = distanceKm < SHORT_HAUL_THRESHOLD_KM ? SHORT_HAUL_FACTOR : LONG_HAUL_FACTOR;
  const cabinFactor = CABIN_FACTORS[seatClass as keyof typeof CABIN_FACTORS] ?? CABIN_FACTORS.economy;

  return Math.round(distanceKm * emissionFactor * cabinFactor);
}
```

- [ ] **Run — expect PASS**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/services/__tests__/co2Calculator.test.ts --forceExit 2>&1 | tail -10
```

Expected: PASS (all 6 tests green)

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/co2Calculator.ts backend/src/services/__tests__/co2Calculator.test.ts
git commit -m "feat: add CO₂ calculator service with cabin class multipliers"
```

---

## Task 3: Backend Zod Schema + Flights Route

**Files:**
- Modify: `backend/src/schemas/flight.ts`
- Modify: `backend/src/routes/flights.ts`

- [ ] **Add `actualDeparture` + `actualArrival` to Zod schema**

In `backend/src/schemas/flight.ts`, find `baseFlightSchema` (the `z.object({...})` starting at line ~57). Add these two fields inside it, after `arrivalTime`:

```typescript
actualDeparture: z.string().datetime().optional().nullable(),
actualArrival:   z.string().datetime().optional().nullable(),
```

- [ ] **Typecheck after schema change**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Wire CO₂ + delay into flight create**

In `backend/src/routes/flights.ts`, add the import at the top of the file (after other service imports):

```typescript
import { calculateCo2Kg } from '../services/co2Calculator';
```

Find the `prisma.flight.create({ data: { ... } })` block (around line 250). Add `co2Kg`, `actualDeparture`, `actualArrival`, `delayMinutes` to the `data` object:

```typescript
// CO₂ calculation
co2Kg: calculateCo2Kg({
  depLat: enriched.departure.lat,
  depLon: enriched.departure.lon,
  arrLat: enriched.arrival.lat,
  arrLon: enriched.arrival.lon,
  seatClass: data.seatClass ?? null,
}),
// Actual times + delay
actualDeparture: data.actualDeparture ? new Date(data.actualDeparture) : null,
actualArrival:   data.actualArrival   ? new Date(data.actualArrival)   : null,
delayMinutes:
  data.actualDeparture
    ? Math.round(
        (new Date(data.actualDeparture).getTime() - new Date(data.departureTime).getTime()) / 60000
      )
    : null,
```

Note: `seatClass` is already stored on the Flight model (not in `baseFlightSchema` — it comes from the extended boarding pass fields). Check if `seatClass` is in `data` at this point. If not, pass `null`.

- [ ] **Wire CO₂ + delay into flight update**

Find the `PATCH /:id` handler in `flights.ts` (around line 500+). In the `updateData` object passed to `prisma.flight.update`, add:

```typescript
// Recalculate CO₂ if position or seatClass changed
...(data.seatClass !== undefined ||
    data.departure?.lat !== undefined ||
    data.arrival?.lat !== undefined
  ? {
      co2Kg: calculateCo2Kg({
        depLat: (data.departure?.lat ?? existingFlight.depLat) ?? null,
        depLon: (data.departure?.lon ?? existingFlight.depLon) ?? null,
        arrLat: (data.arrival?.lat ?? existingFlight.arrLat) ?? null,
        arrLon: (data.arrival?.lon ?? existingFlight.arrLon) ?? null,
        seatClass: (data.seatClass ?? existingFlight.seatClass ?? null) as Parameters<typeof calculateCo2Kg>[0]['seatClass'],
      }),
    }
  : {}),
// Actual times — update if provided, keep existing if omitted
...(data.actualDeparture !== undefined
  ? {
      actualDeparture: data.actualDeparture ? new Date(data.actualDeparture) : null,
      delayMinutes: data.actualDeparture
        ? Math.round(
            (new Date(data.actualDeparture).getTime() -
              (existingFlight.departureTime).getTime()) / 60000
          )
        : null,
    }
  : {}),
...(data.actualArrival !== undefined
  ? { actualArrival: data.actualArrival ? new Date(data.actualArrival) : null }
  : {}),
```

**Important:** Before writing this, read the update handler to understand the existing pattern. Find where `existingFlight` is fetched and how `updateData` is built. Adapt the code to match the actual structure rather than pasting blindly.

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Fix any TypeScript errors before continuing.

- [ ] **Run backend tests**

```bash
cd /d/Projekte/TravStats/backend && npx jest --forceExit 2>&1 | tail -20
```

Expected: Existing tests still pass (new fields are nullable, so no existing tests should break).

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/schemas/flight.ts backend/src/routes/flights.ts
git commit -m "feat: calculate co2Kg and delayMinutes on flight create/update"
```

---

## Task 4: Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Add 4 fields to `Flight` interface**

In `frontend/src/types/index.ts`, find the `Flight` interface. After the `enrichmentHistory` field (end of the interface), add:

```typescript
  // Phase 3: Actual Times, Delay, CO₂
  actualDeparture?: string;   // ISO datetime, user-entered actual wheels-off
  actualArrival?: string;     // ISO datetime, user-entered actual wheels-on
  delayMinutes?: number;      // Positive = late, negative = early, 0 = on time
  co2Kg?: number;             // Per-flight CO₂ in kg
```

- [ ] **Add to `FlightInput` interface**

Find the `FlightInput` interface. Add:

```typescript
  actualDeparture?: string;
  actualArrival?: string;
```

(No need to add `delayMinutes` or `co2Kg` to input — those are server-calculated.)

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/types/index.ts
git commit -m "feat: add actualDeparture, actualArrival, delayMinutes, co2Kg to Flight types"
```

---

## Task 5: i18n Strings

**Files:**
- Modify: `frontend/src/i18n/resources/de/flights.json`
- Modify: `frontend/src/i18n/resources/en/flights.json`

- [ ] **Check existing structure**

```bash
grep -n "delay\|co2\|actualDep\|actualTime" /d/Projekte/TravStats/frontend/src/i18n/resources/de/flights.json | head -10
```

- [ ] **Add to `de/flights.json`**

Find the appropriate top-level section (same level as `form`, `status`, etc.) and add:

```json
"actualTimes": {
  "label": "Tatsächliche Zeiten",
  "actualDeparture": "Tatsächl. Abflug",
  "actualArrival": "Tatsächl. Landung",
  "delayLabel": "Verspätung",
  "earlyLabel": "Früher",
  "onTimeLabel": "Pünktlich",
  "delayMinutes": "{{minutes}} Min. Verspätung",
  "earlyMinutes": "{{minutes}} Min. früher",
  "co2Label": "CO₂",
  "co2Value": "{{kg}} kg CO₂"
}
```

- [ ] **Add to `en/flights.json`**

```json
"actualTimes": {
  "label": "Actual Times",
  "actualDeparture": "Actual Departure",
  "actualArrival": "Actual Arrival",
  "delayLabel": "Delay",
  "earlyLabel": "Early",
  "onTimeLabel": "On Time",
  "delayMinutes": "{{minutes}} min late",
  "earlyMinutes": "{{minutes}} min early",
  "co2Label": "CO₂",
  "co2Value": "{{kg}} kg CO₂"
}
```

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "i18n: add actual times, delay, and CO₂ strings for de/en"
```

---

## Task 6: FlightEditModal — Actual Time Inputs

**Files:**
- Modify: `frontend/src/components/FlightEditModal.tsx`

- [ ] **Write failing test**

Check if a test file exists for FlightEditModal:

```bash
ls /d/Projekte/TravStats/frontend/src/__tests__/components/ 2>/dev/null | grep -i edit
```

Create `frontend/src/__tests__/components/FlightEditModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightEditModal from '../../../components/FlightEditModal';
import type { Flight } from '../../../types';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../components/ReceiptUpload', () => ({
  default: () => null,
}));

const mockFlight: Flight = {
  id: '1',
  userId: 'u1',
  airline: 'LH',
  flightNumber: 'LH123',
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: '2026-06-01T10:00:00.000Z',
  arrivalTime: '2026-06-01T11:00:00.000Z',
  status: 'flown',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('FlightEditModal actual times', () => {
  it('renders actual departure and arrival inputs', () => {
    render(
      <FlightEditModal
        flight={mockFlight}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    // Look for the actual departure input
    expect(screen.getByLabelText(/flights:actualTimes.actualDeparture/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/flights:actualTimes.actualArrival/i)).toBeInTheDocument();
  });
});
```

- [ ] **Run — expect FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/FlightEditModal.test.tsx 2>&1 | tail -15
```

Expected: FAIL — inputs not found

- [ ] **Add actual time fields to FlightEditModal**

Read the full FlightEditModal to understand the `formData` state and the `handleSave` function. Then:

**Step A:** Add to `useState` initial value (in the `formData` state):
```typescript
actualDeparture: flight.actualDeparture
  ? new Date(flight.actualDeparture).toISOString().slice(0, 16)
  : '',
actualArrival: flight.actualArrival
  ? new Date(flight.actualArrival).toISOString().slice(0, 16)
  : '',
```

**Step B:** Add to the `useEffect` reset block (same fields, same pattern as the initial state).

**Step C:** In `handleSave`, include the fields in the `updates` object:
```typescript
actualDeparture: formData.actualDeparture
  ? new Date(formData.actualDeparture).toISOString()
  : undefined,
actualArrival: formData.actualArrival
  ? new Date(formData.actualArrival).toISOString()
  : undefined,
```

**Step D:** Add the UI inputs. Find a good location (e.g., after the status/category section, before notes). Add a section with `aria-label` matching the test:

```tsx
{/* Actual Times */}
<div className="form-section">
  <label className="label" htmlFor="actualDeparture">
    {t("flights:actualTimes.actualDeparture")}
  </label>
  <input
    id="actualDeparture"
    aria-label={t("flights:actualTimes.actualDeparture")}
    type="datetime-local"
    className="input"
    value={formData.actualDeparture}
    onChange={(e) => setFormData({ ...formData, actualDeparture: e.target.value })}
  />
  <label className="label" htmlFor="actualArrival">
    {t("flights:actualTimes.actualArrival")}
  </label>
  <input
    id="actualArrival"
    aria-label={t("flights:actualTimes.actualArrival")}
    type="datetime-local"
    className="input"
    value={formData.actualArrival}
    onChange={(e) => setFormData({ ...formData, actualArrival: e.target.value })}
  />
</div>
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/FlightEditModal.test.tsx 2>&1 | tail -15
```

- [ ] **Full test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/components/FlightEditModal.tsx frontend/src/__tests__/components/FlightEditModal.test.tsx
git commit -m "feat: add actual departure/arrival time inputs to FlightEditModal"
```

---

## Task 7: FlightList — Delay Badge + CO₂ Chip

**Files:**
- Modify: `frontend/src/components/FlightList.tsx`

- [ ] **Write failing test**

Check if a test exists for FlightList:
```bash
ls /d/Projekte/TravStats/frontend/src/__tests__/components/ | grep -i list
```

Create or extend `frontend/src/__tests__/components/FlightList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightList from '../../../components/FlightList';
import type { Flight } from '../../../types';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => opts ? `${k}:${JSON.stringify(opts)}` : k }),
}));

const baseFlight: Flight = {
  id: '1', userId: 'u1', airline: 'LH', flightNumber: 'LH123',
  depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786,
  departureTime: '2026-06-01T10:00:00.000Z', arrivalTime: '2026-06-01T11:00:00.000Z',
  status: 'flown', createdAt: '2026-01-01T00:00:00.000Z',
};

describe('FlightList delay + CO₂ display', () => {
  it('shows delay badge when delayMinutes > 0', () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, delayMinutes: 25 }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/25/)).toBeInTheDocument(); // delay minutes shown
  });

  it('shows early badge when delayMinutes < 0', () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, delayMinutes: -10 }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/10/)).toBeInTheDocument(); // early minutes shown
  });

  it('shows CO₂ chip when co2Kg is present', () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, co2Kg: 78 }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/78/)).toBeInTheDocument();
  });

  it('shows nothing extra when no delay or co2 data', () => {
    const { container } = render(
      <FlightList
        flights={[baseFlight]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    // No delay or co2 indicators
    expect(container.querySelector('[data-testid="delay-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="co2-chip"]')).toBeNull();
  });
});
```

- [ ] **Run — expect FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/FlightList.test.tsx 2>&1 | tail -15
```

Expected: FAIL

- [ ] **Add delay badge and CO₂ chip to FlightList**

Read the FlightList component carefully first to understand its rendering structure. Find where each flight row is rendered. After the status badge (the `getStatusBadge(flight.status)` call), add:

```tsx
{/* Delay badge */}
{flight.delayMinutes != null && flight.delayMinutes !== 0 && (
  <span
    data-testid="delay-badge"
    className={`px-2 py-0.5 rounded text-xs font-medium ${
      flight.delayMinutes > 0
        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    }`}
  >
    {flight.delayMinutes > 0
      ? t('flights:actualTimes.delayMinutes', { minutes: flight.delayMinutes })
      : t('flights:actualTimes.earlyMinutes', { minutes: Math.abs(flight.delayMinutes) })}
  </span>
)}
{/* CO₂ chip */}
{flight.co2Kg != null && (
  <span
    data-testid="co2-chip"
    className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    title={t('flights:actualTimes.co2Label')}
  >
    {t('flights:actualTimes.co2Value', { kg: flight.co2Kg })}
  </span>
)}
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/FlightList.test.tsx 2>&1 | tail -15
```

- [ ] **Full test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/components/FlightList.tsx frontend/src/__tests__/components/FlightList.test.tsx
git commit -m "feat: show delay badge and CO₂ chip per flight in FlightList"
```

---

## Task 8: Full Build Check

- [ ] **Backend: typecheck + lint + tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint && npx jest --forceExit
```

Expected: 0 TypeScript errors, 0 ESLint errors, all tests pass.

- [ ] **Frontend: typecheck + lint + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: 0 TypeScript errors, 0 ESLint errors, all tests pass.

- [ ] **Git log — verify all commits present**

```bash
git log --oneline feature/phase3-actual-times-co2 ^Main | head -15
```

Expected: At least 7 commits (tasks 1–7).

- [ ] **Commit any last fixes**

```bash
cd /d/Projekte/TravStats && git add -p
git commit -m "fix: address final build check issues"
```

---

## Out of Scope

- Automatic enrichment of actual times from flight tracking APIs (e.g. AviationStack) → future enhancement
- CO₂ display in stats aggregate (already exists via `statsCalculator.ts` — Phase 5 can switch it to use stored `co2Kg`)
- Delay statistics (average delay per airline/route) → Phase 5
