# Historical Flights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to log route-only flights without exact times via a checkbox in the existing flight form, stored as status `"historical"`, shown with grey arcs on the map and a HISTORISCH badge, excluded from time-based statistics but included in distance/airport/country counts.

**Architecture:** Add `"historical"` to the status enum in the Zod schema and Flight type. Make `departureTime`/`arrivalTime` optional in the schema when status is historical. In the frontend form, a checkbox toggles historical mode which relaxes date/time validation and sets status automatically. The routes layer renders historical arcs in grey.

**Tech Stack:** Prisma (String status, no migration needed), Zod validation, React form state, deck.gl ArcLayer

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/schemas/flight.ts` | Modify | Add `historical` to status enum, make times optional for historical |
| `backend/src/routes/flights.ts` | Modify | Handle null times in flight creation |
| `backend/src/routes/stats.ts` | Modify | Include historical in distance/airport counts |
| `backend/src/utils/achievements.ts` | Modify | Historical counts for geo achievements |
| `frontend/src/types/index.ts` | Modify | Add `"historical"` to Flight.status union |
| `frontend/src/components/SimplifiedFlightForm.tsx` | Modify | Checkbox + conditional validation |
| `frontend/src/components/FlightPanel/FlightEntry.tsx` | Modify | HISTORISCH badge |
| `frontend/src/components/layers/routesLayer.ts` | Modify | Grey arcs for historical routes |
| `frontend/src/pages/AdvancedStatsPage.tsx` | Modify | Exclude historical from time stats |
| i18n DE/EN files | Modify | New keys |

---

### Task 1: Backend Schema — Add Historical Status + Optional Times

**Files:**
- Modify: `backend/src/schemas/flight.ts`

- [ ] **Step 1: Update the status enum and make times conditional**

In `backend/src/schemas/flight.ts`, change the `baseFlightSchema`:

```typescript
// Line 79-80: Change from required to optional
departureTime: z.string().datetime().optional().nullable(),
arrivalTime: z.string().datetime().optional().nullable(),

// Line 83: Add 'historical' to the enum
status: z.enum(['scheduled', 'flown', 'cancelled', 'historical']).default('scheduled'),
```

Then update `createFlightSchema` to only validate duration when both times are present:

```typescript
export const createFlightSchema = baseFlightSchema.refine(
  data => {
    // Historical flights don't need times
    if (data.status === 'historical') return true;
    // Non-historical flights require times
    if (!data.departureTime || !data.arrivalTime) return false;

    const depTime = new Date(data.departureTime);
    const arrTime = new Date(data.arrivalTime);
    const diffHours = (arrTime.getTime() - depTime.getTime()) / (1000 * 60 * 60);
    return diffHours >= -12 && diffHours <= 24;
  },
  {
    message: 'Non-historical flights require departure and arrival times with valid duration',
    path: ['arrivalTime'],
  }
);
```

- [ ] **Step 2: Update the flight creation route to handle null times**

In `backend/src/routes/flights.ts`, in the `POST /` handler, the `departureTime` and `arrivalTime` are used directly from the validated data. Since they can now be null, wrap the Prisma create to use fallback dates for historical flights:

Find the `prisma.flight.create` call and ensure times are passed as-is (Prisma accepts null for nullable DateTime fields). The `departureTime` column in Prisma schema is `DateTime` — check if it's nullable.

Read `backend/prisma/schema.prisma` line ~87 to check. If `departureTime` is `DateTime` (not nullable), we need a Prisma migration to make it nullable. If it IS nullable, no migration needed.

**If migration needed:** Create migration:
```bash
cd backend && npx prisma migrate dev --name make_times_nullable
```

The migration SQL would be:
```sql
ALTER TABLE "flights" ALTER COLUMN "departure_time" DROP NOT NULL;
ALTER TABLE "flights" ALTER COLUMN "arrival_time" DROP NOT NULL;
```

- [ ] **Step 3: Verify build**

Run: `cd /d/Projekte/TravStats/backend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/flight.ts backend/prisma/
git commit -m "feat: add historical status with optional times to flight schema"
```

---

### Task 2: Backend Stats — Include Historical in Distance/Airport Counts

**Files:**
- Modify: `backend/src/routes/stats.ts`

- [ ] **Step 1: Update computeSummary to include historical flights in distance counts**

In `backend/src/routes/stats.ts`, the `computeSummary` function uses `flownWhere` which only includes `status: 'flown'`. Change the distance/airport query to also include `historical`:

```typescript
// Change from:
const flownWhere: Prisma.FlightWhereInput = { ...where, status: 'flown' };

// To: Use flown for time stats, flownOrHistorical for distance/airport stats
const flownWhere: Prisma.FlightWhereInput = { ...where, status: 'flown' };
const geoWhere: Prisma.FlightWhereInput = {
  ...where,
  status: { in: ['flown', 'historical'] },
};
```

Then use `geoWhere` for the flight query that computes distance (but keep using `flownWhere` for the time computation). This means splitting the single query into two, or querying with `geoWhere` and computing time only for flights with non-null times.

Simplest approach — query with `geoWhere`, compute distance for all, compute time only when times are present:

```typescript
const flightTime = (flight.departureTime && flight.arrivalTime)
  ? tzAwareDurationMinutes(flight.departureTime, flight.arrivalTime, depTz, arrTz)
  : 0;
```

- [ ] **Step 2: Verify build**

Run: `cd /d/Projekte/TravStats/backend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/stats.ts
git commit -m "feat: include historical flights in distance/airport stats"
```

---

### Task 3: Backend Achievements — Historical for Geo Achievements

**Files:**
- Modify: `backend/src/utils/achievements.ts`

- [ ] **Step 1: Include historical flights in the main flight query**

Change line ~46 from:
```typescript
where: { userId, status: 'flown' },
```
to:
```typescript
where: { userId, status: { in: ['flown', 'historical'] } },
```

Then in `calculateUserStats`, skip time/duration calculations when times are null:

```typescript
// Around line where flight hours are computed:
if (flight.departureTime && flight.arrivalTime) {
  const durationHours = /* existing calculation */;
  stats.totalFlightHours += durationHours;
}
```

And skip `flightsCount` increment for historical flights (they shouldn't count toward flight-count achievements):

```typescript
// At the top of calculateUserStats, filter for counting:
const flownOnly = flights.filter(f => f.status === 'flown');
stats.flightsCount = flownOnly.length;
```

But keep ALL flights (including historical) for airport/country/continent counting.

- [ ] **Step 2: Verify build**

Run: `cd /d/Projekte/TravStats/backend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/achievements.ts
git commit -m "feat: historical flights count toward geo achievements"
```

---

### Task 4: Frontend Types + i18n

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/i18n/resources/de/flights.json`
- Modify: `frontend/src/i18n/resources/en/flights.json`

- [ ] **Step 1: Add historical to Flight status type**

In `frontend/src/types/index.ts` line 41:
```typescript
// Change from:
status: "scheduled" | "flown" | "cancelled";
// To:
status: "scheduled" | "flown" | "cancelled" | "historical";
```

Also update `FlightInput` (line 139) and `FlightFilters` (line 228) similarly.

- [ ] **Step 2: Add i18n keys**

In `frontend/src/i18n/resources/de/flights.json`, add inside `"status"`:
```json
"historical": "Historisch"
```

Add new keys:
```json
"historicalCheckbox": "Historischer Flug (nur Route bekannt)",
"historicalHint": "Nur Abflug- und Ankunftsflughafen erforderlich. Alle weiteren Angaben sind optional."
```

In `frontend/src/i18n/resources/en/flights.json`:
```json
"historical": "Historical"
```
```json
"historicalCheckbox": "Historical flight (route only)",
"historicalHint": "Only departure and arrival airports required. All other fields are optional."
```

- [ ] **Step 3: Verify build**

Run: `cd /d/Projekte/TravStats/frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/i18n/
git commit -m "feat: add historical flight type and i18n keys"
```

---

### Task 5: Frontend Form — Historical Checkbox

**Files:**
- Modify: `frontend/src/components/SimplifiedFlightForm.tsx`

- [ ] **Step 1: Add historical state and checkbox**

Add state:
```typescript
const [historical, setHistorical] = useState(false);
```

Update status type to include historical:
```typescript
const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
```

When `historical` is toggled on, set status to `"historical"`. When toggled off, revert to auto-detect (flown/scheduled based on date).

- [ ] **Step 2: Update validation in handleSubmit**

In `handleSubmit`, change the date validation:
```typescript
if (!departure || !arrival) {
  setError(t("flights:form.validation.selectAirports"));
  return;
}

// Only require date for non-historical flights
if (!historical && !departureDate) {
  setError(t("flights:form.validation.selectDate"));
  return;
}
```

Update the submit payload to send null times when historical and no times entered:
```typescript
const departureDateTime = departureDate
  ? new Date(`${departureDate}T${departureTime || "00:00"}:00`).toISOString()
  : null;
const arrivalDateTime = (arrivalDate || departureDate)
  ? new Date(`${arrivalDate || departureDate}T${arrivalTime || "00:00"}:00`).toISOString()
  : null;

await onSubmit({
  ...otherFields,
  departureTime: departureDateTime ?? undefined,
  arrivalTime: arrivalDateTime ?? undefined,
  status: historical ? "historical" : status,
});
```

- [ ] **Step 3: Add checkbox UI**

Above the status dropdown in the form JSX, add:
```tsx
<div className="col-span-2">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={historical}
      onChange={(e) => {
        setHistorical(e.target.checked);
        if (e.target.checked) setStatus("historical");
        else setStatus(new Date(departureDate) < new Date() ? "flown" : "scheduled");
      }}
      className="rounded"
    />
    <span className="text-sm" style={{ color: "var(--text-primary)" }}>
      {t("flights:historicalCheckbox")}
    </span>
  </label>
  {historical && (
    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
      {t("flights:historicalHint")}
    </p>
  )}
</div>
```

Also add `"historical"` option to the status dropdown:
```tsx
<option value="historical">{t("flights:status.historical")}</option>
```

- [ ] **Step 4: Verify build + tests**

Run: `cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SimplifiedFlightForm.tsx
git commit -m "feat: historical flight checkbox in flight form"
```

---

### Task 6: Frontend — HISTORISCH Badge + Grey Map Arcs

**Files:**
- Modify: `frontend/src/components/FlightPanel/FlightEntry.tsx`
- Modify: `frontend/src/components/layers/routesLayer.ts`
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`

- [ ] **Step 1: Add HISTORISCH badge in FlightEntry**

In `FlightEntry.tsx`, after the existing `cancelled` badge block, add:
```tsx
{flight.status === "historical" && (
  <span
    className="text-[9px] font-sans font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider"
    style={{ background: "rgba(150,150,150,0.2)", color: "rgb(160,160,160)" }}
  >
    historisch
  </span>
)}
```

- [ ] **Step 2: Grey arcs for historical routes on the map**

In `routesLayer.ts`, after the `allScheduled` check, add an `allHistorical` check:
```typescript
const allHistorical = flightIdsForRoute.every((fid) =>
  flights.some((fl) => fl.properties.id === fid && fl.properties.status === "historical")
);
```

Update the color/alpha logic:
```typescript
const alpha = allScheduled ? 180 : allHistorical ? 140 : (Math.min(100 + count * 14, 230) as number);
const color = allScheduled
  ? ([100, 200, 220] as [number, number, number])
  : allHistorical
    ? ([150, 150, 150] as [number, number, number])
    : getHeatmapColor(count, q25, q50, q75, themeColors);
```

And the width:
```typescript
if (d.isScheduled) return 1.5;
if (d.isHistorical) return 1.2;
```

Add `isHistorical` to the arcMap entry:
```typescript
isScheduled: allScheduled,
isHistorical: allHistorical,
```

In `layerTypes.ts`, add to `ArcDatum`:
```typescript
isHistorical?: boolean;
```

- [ ] **Step 3: Exclude historical from frontend time stats**

In `AdvancedStatsPage.tsx`, the filter already excludes non-flown. Just verify the existing filter handles it:
```typescript
setFlights(allFlights.filter((f) => f.status === "flown"));
```
This already excludes `historical` — no change needed.

- [ ] **Step 4: Verify build + tests**

Run: `cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FlightPanel/FlightEntry.tsx \
  frontend/src/components/layers/routesLayer.ts \
  frontend/src/components/layers/layerTypes.ts
git commit -m "feat: historical flight badge and grey map arcs"
```

---

### Task 7: Visual Testing

- [ ] **Step 1: Start dev server and test historical flight creation**

Open http://localhost:3000, click "Flug hinzufügen" → "Suche überspringen".
Check the "Historischer Flug" checkbox.
Verify: date/time fields are no longer required.
Enter only MUC → CDG, leave everything else empty.
Click save — should succeed.

- [ ] **Step 2: Verify sidebar badge**

Open flight list. The new flight should show "HISTORISCH" badge in grey.

- [ ] **Step 3: Verify map**

The MUC→CDG route should appear as a thin grey arc.

- [ ] **Step 4: Verify statistics**

Open /stats. The historical flight should NOT appear in flight time/count stats but SHOULD appear in distance and airport counts.

- [ ] **Step 5: Run full test suite**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd ../backend && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Commit any polish**

```bash
git add -A
git commit -m "feat: historical flights — route-only entries"
```
