# UI Completeness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all UI completeness gaps identified in the audit: i18n hardcoded strings, empty map state, AirportTooltip ICAO display, and FlightEditModal missing fields.

**Architecture:** Four independent tasks. Task 1 (i18n/cleanup) can run before others but doesn't block them. Tasks 2–4 are fully independent of each other.

**Tech Stack:** React 18, TypeScript strict, react-i18next (via custom `useTranslation` wrapper from `../hooks/useTranslation`), Vitest, Prettier pre-commit hook

---

### Task 1: i18n Fixes + ContextualHint Cleanup

**Files:**
- Modify: `frontend/src/i18n/resources/de/dashboard.json`
- Modify: `frontend/src/i18n/resources/en/dashboard.json`
- Modify: `frontend/src/components/FlightPanel.tsx:187`
- Modify: `frontend/src/components/AirportTooltip.tsx`
- Modify: `frontend/src/pages/FlightsTablePage.tsx:8`

**Background:** Three hardcoded German strings exist in the UI, and `ContextualHint` is imported but never rendered in `FlightsTablePage.tsx` (dead import).

- [ ] **Step 1: Add i18n keys to `de/dashboard.json`**

Open `frontend/src/i18n/resources/de/dashboard.json`. Add these entries **before the closing `}`**:

```json
  "trips": {
    "noTrips": "Keine Trips vorhanden"
  },
  "map": {
    "view2d": "2D-Ansicht",
    "view3d": "3D-Ansicht",
    "help2d": "Zur 2D-Ansicht wechseln",
    "help3d": "Zur 3D-Ansicht wechseln",
    "helpExpanded": "Wechseln Sie zwischen 2D- und 3D-Kartenansicht. Die 3D-Ansicht zeigt die Flugrouten mit Höheninformationen.",
    "airport": {
      "flightsTotal_one": "Flug gesamt",
      "flightsTotal_other": "Flüge gesamt",
      "topRoutes": "Häufigste Routen",
      "flown": "geflogen"
    }
  }
```

NOTE: The `map.*` keys (`view2d`, `view3d` etc.) already exist in the current file — check before adding to avoid duplicates. Only add the `trips` and `map.airport` sub-keys. The current file ends with `"unknownDate": "Unbekanntes Datum"`. Add the new sections before the final `}`:

```json
  "trips": {
    "noTrips": "Keine Trips vorhanden"
  },
  "airport": {
    "flightsTotal_one": "Flug gesamt",
    "flightsTotal_other": "Flüge gesamt",
    "topRoutes": "Häufigste Routen",
    "flown": "geflogen"
  }
```

(Use `airport` at top level of dashboard namespace, not nested under `map`, for simplicity.)

- [ ] **Step 2: Add i18n keys to `en/dashboard.json`**

Open `frontend/src/i18n/resources/en/dashboard.json`. Add before the closing `}`:

```json
  "trips": {
    "noTrips": "No trips yet"
  },
  "airport": {
    "flightsTotal_one": "flight total",
    "flightsTotal_other": "flights total",
    "topRoutes": "Top Routes",
    "flown": "flown"
  }
```

- [ ] **Step 3: Fix FlightPanel.tsx hardcoded string**

In `frontend/src/components/FlightPanel.tsx` line 187, replace:
```tsx
    Keine Trips vorhanden
```
with:
```tsx
    {t("dashboard:trips.noTrips")}
```

Full context of the change (lines 182–190):
```tsx
) : trips.length === 0 ? (
  <div
    className="px-4 py-8 text-center text-xs"
    style={{ color: "var(--text-muted)" }}
  >
    {t("dashboard:trips.noTrips")}
  </div>
)
```

- [ ] **Step 4: Fix AirportTooltip hardcoded German strings**

In `frontend/src/components/AirportTooltip.tsx`, add `useTranslation` import and hook:

```tsx
import { useTranslation } from "../hooks/useTranslation";
```

Inside the `AirportTooltip` function, after `const locale = useLocale();`:
```tsx
const { t } = useTranslation(["dashboard"]);
```

Then replace the three hardcoded strings:

**Line ~101** — replace:
```tsx
<span style={{ color: "var(--text-muted)" }}>{total !== 1 ? "Flüge" : "Flug"} gesamt</span>
```
with:
```tsx
<span style={{ color: "var(--text-muted)" }}>
  {t("dashboard:airport.flightsTotal", { count: total })}
</span>
```

**Line ~112** — replace:
```tsx
<div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
  Häufigste Routen
</div>
```
with:
```tsx
<div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
  {t("dashboard:airport.topRoutes")}
</div>
```

**Line ~138** — replace:
```tsx
{formatKm(stats.totalKm, locale)} geflogen
```
with:
```tsx
{formatKm(stats.totalKm, locale)} {t("dashboard:airport.flown")}
```

- [ ] **Step 5: Remove dead ContextualHint import from FlightsTablePage.tsx**

In `frontend/src/pages/FlightsTablePage.tsx` line 8, delete this line:
```tsx
import ContextualHint from "../components/Onboarding/ContextualHint";
```

- [ ] **Step 6: Type-check, run tests, commit**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run
git add frontend/src/i18n/resources/de/dashboard.json \
  frontend/src/i18n/resources/en/dashboard.json \
  frontend/src/components/FlightPanel.tsx \
  frontend/src/components/AirportTooltip.tsx \
  frontend/src/pages/FlightsTablePage.tsx
git commit -m "fix: replace hardcoded German strings with i18n keys, remove dead ContextualHint import"
```

---

### Task 2: Empty Map State

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

**Background:** When a user has 0 flights, the map shows an empty globe with no guidance. The translation key `dashboard:noFlights` already exists in both de and en files with the correct text. The variable `totalFlightsCount` tracks this in state. The function `setShowFlightForm` opens the add-flight form.

The empty state overlay goes inside the map wrapper `<div className="absolute inset-0">` but **after** the ErrorBoundary/MapContainer3D, as an absolute overlay that only appears when `totalFlightsCount === 0`.

- [ ] **Step 1: Add empty state overlay in DashboardPage.tsx**

In `frontend/src/pages/DashboardPage.tsx`, find this block (around line 697–732):

```tsx
{/* Main area: map fills everything */}
<div className="flex-1 relative overflow-hidden">
  {/* Map Layer */}
  <div className="absolute inset-0">
    <ErrorBoundary
      fallback={...}
    >
      <MapContainer3D ... />
    </ErrorBoundary>
  </div>
```

After the closing `</div>` of the `absolute inset-0` div (after the ErrorBoundary), add:

```tsx
        {/* Empty state — shown when user has no flights yet */}
        {totalFlightsCount === 0 && !loadingFlights && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none"
          >
            <div
              className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl text-center pointer-events-auto"
              style={{
                background: "rgba(15,23,42,0.85)",
                border: "1px solid var(--color-border)",
                backdropFilter: "blur(12px)",
                maxWidth: "340px",
              }}
            >
              <span style={{ fontSize: "2.5rem" }}>✈️</span>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("dashboard:noFlights")}
              </p>
              <button
                onClick={() => setShowFlightForm(true)}
                className="btn-primary text-sm px-4 py-2"
              >
                {t("dashboard:addFlight")}
              </button>
            </div>
          </div>
        )}
```

Find `loadingFlights` in DashboardPage — grep for `loadingFlights` or `loading` state. Use whichever loading state guards flight data. If it's called `loading`, use `!loading`. If it doesn't exist, use `totalFlightsCount === 0 && geoFlights !== null`.

Actually, check the actual variable name: grep `const \[load` in DashboardPage. Use the correct one.

- [ ] **Step 2: Type-check and commit**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add empty map state with CTA when user has no flights"
```

---

### Task 3: AirportTooltip — Show ICAO Code

**Files:**
- Modify: `frontend/src/components/AirportTooltip.tsx`

**Background:** The `AirportTooltip` receives `flights: Flight[]` and `iata: string`. The `Flight` type has `depIcao` and `arrIcao` fields. We can extract the ICAO for this airport by looking for a flight where `depIata === iata` (then use `depIcao`) or `arrIata === iata` (then use `arrIcao`).

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/AirportTooltip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AirportTooltip } from "./AirportTooltip";
import type { Flight } from "../types";

// Minimal flight stub
function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "1",
    userId: "u1",
    depIata: "MUC",
    depIcao: "EDDM",
    arrIata: "FRA",
    arrIcao: "EDDF",
    depName: "Munich Airport",
    arrName: "Frankfurt Airport",
    depLat: 48.354,
    depLon: 11.786,
    arrLat: 50.033,
    arrLon: 8.571,
    airline: "Lufthansa",
    status: "flown",
    ...overrides,
  } as Flight;
}

describe("AirportTooltip", () => {
  it("shows IATA code", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFlight()]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("MUC")).toBeInTheDocument();
  });

  it("shows ICAO code from departure flight", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFlight({ depIata: "MUC", depIcao: "EDDM" })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("EDDM")).toBeInTheDocument();
  });

  it("shows ICAO code from arrival flight", () => {
    render(
      <AirportTooltip
        iata="FRA"
        screenX={100}
        screenY={100}
        flights={[makeFlight({ arrIata: "FRA", arrIcao: "EDDF" })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("EDDF")).toBeInTheDocument();
  });

  it("does not show ICAO when unavailable", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFlight({ depIcao: undefined, arrIcao: undefined })]}
        onClose={() => {}}
      />
    );
    // Should not crash; ICAO section absent
    expect(screen.queryByText(/^[A-Z]{4}$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — ICAO not rendered yet)**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/components/AirportTooltip.test.tsx
```

Expected: FAIL on the ICAO tests.

- [ ] **Step 3: Extract ICAO in useMemo and render it**

In `frontend/src/components/AirportTooltip.tsx`, extend the `stats` useMemo to also compute the ICAO:

Add `icao: null as string | null` to the initial values before the loop:

```typescript
const stats = useMemo(() => {
  let name: string | null = null;
  let icao: string | null = null;   // ← add this
  let departures = 0;
  // ... rest unchanged
```

Inside the loop, after setting `name`, add ICAO extraction:

```typescript
      if (isDep) {
        departures++;
        if (!name && f.depName) name = f.depName;
        if (!icao && f.depIcao) icao = f.depIcao;   // ← add
        // ...
      }
      if (isArr) {
        arrivals++;
        if (!name && f.arrName) name = f.arrName;
        if (!icao && f.arrIcao) icao = f.arrIcao;   // ← add
        // ...
      }
```

Add `icao` to the returned object:

```typescript
    return {
      name,
      icao,           // ← add
      departures,
      arrivals,
      totalKm,
      topRoutes,
      airlines: [...airlinesSet].slice(0, 6),
    };
```

In the JSX header section (the `<div className="flex items-baseline gap-2 mb-1">` block), add the ICAO after the IATA span:

```tsx
      {/* IATA + ICAO + name */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono font-bold text-base" style={{ color: "rgb(232,160,69)" }}>
          {iata}
        </span>
        {stats.icao && (
          <span
            className="font-mono text-xs px-1 rounded"
            style={{ background: "rgba(232,160,69,0.12)", color: "rgba(232,160,69,0.7)" }}
          >
            {stats.icao}
          </span>
        )}
        {stats.name && (
          <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {stats.name}
          </span>
        )}
      </div>
```

- [ ] **Step 4: Run test (expect PASS)**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/components/AirportTooltip.test.tsx
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Type-check and full test run**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AirportTooltip.tsx \
  frontend/src/components/AirportTooltip.test.tsx
git commit -m "feat: show ICAO code in AirportTooltip header"
```

---

### Task 4: FlightEditModal — Add gate, terminal, boardingGroup, companions

**Files:**
- Modify: `frontend/src/components/FlightEditModal.tsx`

**Background:** The FlightEditModal currently does not include gate, terminal, boardingGroup (string), and companions (string[]) fields, even though they are editable via the backend `updateFlightSchema`. All translation keys already exist in `flights.json`:
- `flights:form.gate`, `flights:form.placeholders.gate`
- `flights:form.terminal`, `flights:form.placeholders.terminal`
- `flights:form.boardingGroup`, `flights:form.placeholders.boardingGroup`
- `flights:form.companions`, `flights:form.placeholders.companions`

The companions field in the Flight type is `string[]`. In the edit form it's stored as a comma-separated string (same pattern as `tags`).

- [ ] **Step 1: Add missing fields to formData initial state**

In `FlightEditModal.tsx`, the `useState` for `formData` (lines 21–43) currently ends with `actualArrival`. Add the new fields:

```typescript
  const [formData, setFormData] = useState({
    airline: flight.airline || "",
    operatingAirline: flight.operatingAirline || "",
    flightNumber: flight.flightNumber || "",
    aircraft: flight.aircraft || "",
    status: flight.status || "scheduled",
    category: flight.category || "",
    seatClass: flight.seatClass || "",
    seatNumber: flight.seatNumber || "",
    gate: flight.gate || "",                                          // ← add
    terminal: flight.terminal || "",                                  // ← add
    boardingGroup: flight.boardingGroup || "",                        // ← add
    companions: flight.companions?.join(", ") || "",                  // ← add
    price: flight.price || 0,
    currency: flight.currency || "EUR",
    taxes: flight.taxes || 0,
    fees: flight.fees || 0,
    notes: flight.notes || "",
    tags: flight.tags?.join(", ") || "",
    receiptUrl: flight.receiptUrl || "",
    actualDeparture: flight.actualDeparture
      ? new Date(flight.actualDeparture).toISOString().slice(0, 16)
      : "",
    actualArrival: flight.actualArrival
      ? new Date(flight.actualArrival).toISOString().slice(0, 16)
      : "",
  });
```

- [ ] **Step 2: Add missing fields to the useEffect reset (lines 48–74)**

The `useEffect` that resets form when `flight` changes is a copy of the initial state. Add the same four fields there:

```typescript
  useEffect(() => {
    setFormData({
      airline: flight.airline || "",
      operatingAirline: flight.operatingAirline || "",
      flightNumber: flight.flightNumber || "",
      aircraft: flight.aircraft || "",
      status: flight.status || "scheduled",
      category: flight.category || "",
      seatClass: flight.seatClass || "",
      seatNumber: flight.seatNumber || "",
      gate: flight.gate || "",                                        // ← add
      terminal: flight.terminal || "",                                // ← add
      boardingGroup: flight.boardingGroup || "",                      // ← add
      companions: flight.companions?.join(", ") || "",                // ← add
      price: flight.price || 0,
      currency: flight.currency || "EUR",
      taxes: flight.taxes || 0,
      fees: flight.fees || 0,
      notes: flight.notes || "",
      tags: flight.tags?.join(", ") || "",
      receiptUrl: flight.receiptUrl || "",
      actualDeparture: flight.actualDeparture
        ? new Date(flight.actualDeparture).toISOString().slice(0, 16)
        : "",
      actualArrival: flight.actualArrival
        ? new Date(flight.actualArrival).toISOString().slice(0, 16)
        : "",
    });
    setError("");
  }, [flight]);
```

- [ ] **Step 3: Add missing fields to handleSubmit updates**

In `handleSubmit` (lines 82–109), add the four fields to the `updates` object:

```typescript
      const updates: Partial<Flight> = {
        airline: formData.airline || undefined,
        operatingAirline: formData.operatingAirline || undefined,
        flightNumber: formData.flightNumber || undefined,
        aircraft: formData.aircraft || undefined,
        status: formData.status as Flight["status"],
        category: (formData.category || undefined) as Flight["category"],
        seatClass: (formData.seatClass || undefined) as Flight["seatClass"],
        seatNumber: formData.seatNumber || undefined,
        gate: formData.gate || undefined,                             // ← add
        terminal: formData.terminal || undefined,                     // ← add
        boardingGroup: formData.boardingGroup || undefined,           // ← add
        companions: formData.companions
          ? formData.companions
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
          : [],                                                        // ← add
        price: formData.price > 0 ? formData.price : undefined,
        currency: formData.currency as Flight["currency"],
        taxes: formData.taxes > 0 ? formData.taxes : undefined,
        fees: formData.fees > 0 ? formData.fees : undefined,
        notes: formData.notes || undefined,
        tags: formData.tags
          ? formData.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        receiptUrl: formData.receiptUrl || undefined,
        actualDeparture: formData.actualDeparture
          ? new Date(formData.actualDeparture).toISOString()
          : undefined,
        actualArrival: formData.actualArrival
          ? new Date(formData.actualArrival).toISOString()
          : undefined,
      };
```

- [ ] **Step 4: Add form fields in the JSX**

After the existing `seatNumber` input (after line ~281, the `<div>` containing `flights:form.seat`), add a new section for gate/terminal/boardingGroup/companions:

```tsx
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">{t("flights:form.gate")}</label>
              <input
                type="text"
                value={formData.gate}
                onChange={(e) => setFormData({ ...formData, gate: e.target.value })}
                className="input"
                placeholder={t("flights:form.placeholders.gate")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.terminal")}</label>
              <input
                type="text"
                value={formData.terminal}
                onChange={(e) => setFormData({ ...formData, terminal: e.target.value })}
                className="input"
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.boardingGroup")}</label>
              <input
                type="text"
                value={formData.boardingGroup}
                onChange={(e) => setFormData({ ...formData, boardingGroup: e.target.value })}
                className="input"
                placeholder={t("flights:form.placeholders.boardingGroup")}
              />
            </div>
          </div>

          <div>
            <label className="label">{t("flights:form.companions")}</label>
            <input
              type="text"
              value={formData.companions}
              onChange={(e) => setFormData({ ...formData, companions: e.target.value })}
              className="input"
              placeholder={t("flights:form.placeholders.companions")}
            />
          </div>
```

- [ ] **Step 5: Type-check and run tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FlightEditModal.tsx
git commit -m "feat: add gate, terminal, boardingGroup, companions fields to FlightEditModal"
```

---

## Self-Review

**Spec coverage:**
- ✅ Hardcoded "Keine Trips vorhanden" → Task 1
- ✅ Hardcoded "Häufigste Routen" / "Flüge gesamt" / "geflogen" → Task 1
- ✅ Dead ContextualHint import → Task 1
- ✅ Empty map state for new users → Task 2
- ✅ AirportTooltip ICAO code → Task 3
- ✅ FlightEditModal: gate, terminal, boardingGroup, companions → Task 4

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**
- `formData.gate`, `formData.terminal`, `formData.boardingGroup`, `formData.companions` — string type, consistent across useState/useEffect/handleSubmit
- `stats.icao: string | null` — returned from useMemo, rendered conditionally
- `t("dashboard:airport.flightsTotal", { count: total })` — uses i18next plural convention (`_one`/`_other` keys)
