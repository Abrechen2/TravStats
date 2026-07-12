# Flights Table Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the flights table (`FlightsTablePage`) to the owner-approved mockup: one merged Zeit column (weekday + compact date + airport-local time, `+N` overnight marker), a bare status pill, the data-source info behind an ℹ tooltip next to icon action buttons, country flags on the route, and the airline shown as its **wordmark logo instead of the written name** (owner decision 2026-07-12).

**Architecture:** Small focused cell components under `frontend/src/components/flightsTable/` compose the new row; pure display logic (flag emoji, day-shift, source-info lines) lives in testable `lib/` functions. The backend flights list handler — which already builds an airport map for timezone-aware durations — additionally returns `depCountry/arrCountry/depTimezone/arrTimezone` per flight. Logos come from the airline-logo proxy built on the parent branch (`AirlineLogo` with `variant="logo"`).

**Tech Stack:** React 18 + TypeScript strict, Vitest + Testing Library, Express + Jest (one backend touch), i18n via the project's `useTranslation` wrapper.

## Global Constraints

- **Branch:** `feat/flights-table-redesign`, created **off `feat/airline-logo-proxy`** (stacked — this feature needs the logo proxy's `variant` prop and backend route). Never merge anything yourself.
- `any` is FORBIDDEN (`unknown` + type guards); strict TS; ESLint+Prettier printWidth 100, double quotes.
- No `console.log`; frontend logging via `frontend/src/lib/logger` if needed (display components should not log).
- i18n: user-facing strings via `t()`; **DE first, EN mirrored in the same change** (`frontend/src/i18n/resources/{de,en}/flights.json`). `useTranslation` is imported from `../hooks/useTranslation` (project wrapper), NEVER directly from react-i18next.
- Existing i18n keys reuse: the source-labels already exist under `flights:dataSource.*` — do not duplicate them.
- Files 200–400 lines ideal, 800 hard max. `FlightsTablePage.tsx` is already ~700 lines — the new cells MUST live in separate files so the page shrinks, not grows.
- Colours: never hardcode hexes for status/text — use the CSS vars (`var(--text-muted)`, `var(--accent)`, …) exactly as the current page does. The status pill keeps its existing colour logic.
- Backend: Zod at boundaries (no new inputs here — response-only change), Pino logger only.
- Run GitNexus impact before modifying existing symbols; `detect_changes` before commits.
- Frontend gate per task: `npx tsc --noEmit && npm run lint && npx vitest --run <touched test files>`; full `npx vitest --run` in the final task.

## Pinned facts (verified 2026-07-12)

- **`FlightList.tsx` is dead code** — only its own test imports it. It is OUT OF SCOPE (follow-up: delete). The redesign touches `FlightsTablePage.tsx` + `FlightRowActions.tsx` only.
- Current table markup: `frontend/src/pages/FlightsTablePage.tsx` — columns at ~lines 380–600: Airline (text via `resolveAirlineDisplay`), Flugnr., Route (2-line, `max-w-[16rem]`), Abflugdatum, Ankunftsdatum (`formatDate` = date-only in the USER's display timezone), Status (pill + `<DataSourceBadges/>` stacked, lines 527–554), Dauer (`formatFlightDurationCell`), Flugzeug, Preis (`price.toFixed(2) + currency`), Reise (trip chip), Aktionen (`<FlightRowActions/>`).
- `FlightRowActions.tsx` (95 lines): three text buttons; duplicate opens a controlled dropdown (`openDuplicateMenuFor` owned by the page, `data-duplicate-menu` attribute used by the page's outside-click listener — keep both).
- Backend `routes/flights.ts` GET `/` (line 486): already calls `getCachedAirports(allCodes)` and builds a `tzMap` for `durationMinutes`. `AirportData` (services/airportCache.ts) already carries `country` (ISO-2) and `timezone`. The response spreads `...f` + `durationMinutes` — countries/timezones are NOT returned today.
- Frontend `Flight` type (`frontend/src/types/index.ts`): has `depTimezone?/arrTimezone?` (lines 261–263) and `depTimeSemantics?/arrTimeSemantics?: "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC"`; NO `depCountry/arrCountry` yet.
- Date helpers: `frontend/src/lib/dateUtils.ts` exports `formatDateInTimezone`, `formatTimeInTimezone`, `formatDateTimeInTimezone`.
- `resolveAirlineDisplay(flight)` / `resolveAirlineIata(flight)` from `frontend/src/lib/airlineUtils.ts`.
- `AirlineLogo` (parent branch) renders `/api/v1/airline-logos/{code}?variant=` with an internal letterbox fallback; props: `iata, icao, flightNumber, size, bg (no-op), className, alt, variant`.
- Demo-seed flights carry NO `airline_iata` (0/123) — the wordmark cell will frequently hit its fallback in dev; that is expected, the fallback IS the airline name.
- `DataSourceBadges.tsx` encodes the source semantics to preserve: primary source badge from `flight.dataSource` (icons ✏️📧🎫🔍🔄🌐📊📥↻, labels `flights:dataSource.*`), combined "Live + Auto-Update" when `dataSource==="live_update" && lastModifiedBy==="auto_update"`, enrichment badge when `enrichmentHistory.length > 0` (label `flights:enrichmentCount` for >1, tooltip with `confidence` + `sourceFlightsCount`), auto-update badge when `lastModifiedBy==="auto_update"` and not already covered.
- Mockup reference (visual truth): https://claude.ai/code/artifact/84aaf960-a858-478a-a482-343b26431e0e — final concept table.

## File structure

```
backend/src/routes/flights.ts                      (modify: enrich list response)
frontend/src/types/index.ts                        (modify: Flight += depCountry/arrCountry)
frontend/src/lib/countryFlag.ts                    (new: ISO-2 -> emoji)
frontend/src/lib/flightSourceInfo.ts               (new: source lines for the tooltip)
frontend/src/lib/dayShift.ts                       (new: overnight +N calculation)
frontend/src/components/AirlineLogo.tsx            (modify: optional custom fallback node)
frontend/src/components/flightsTable/AirlineWordmarkCell.tsx  (new)
frontend/src/components/flightsTable/RouteCell.tsx            (new)
frontend/src/components/flightsTable/TimeCell.tsx             (new)
frontend/src/components/flightsTable/SourceInfoDot.tsx        (new)
frontend/src/components/FlightRowActions.tsx       (modify: icon buttons)
frontend/src/pages/FlightsTablePage.tsx            (modify: new columns)
frontend/src/i18n/resources/de/flights.json        (modify) + en mirror
```

---

### Task 0: Branch setup

- [ ] **Step 1:**

```bash
cd D:/TravStats_Projekt/TravStats
git checkout feat/airline-logo-proxy
git checkout -b feat/flights-table-redesign
```

No commit — setup only. All later tasks run on this branch.

---

### Task 1: Backend — return countries + timezones in the flights list

**Files:**
- Modify: `backend/src/routes/flights.ts` (GET `/` handler, the enrichment block around lines 545–575)
- Test: `backend/src/routes/__tests__/flights.listEnrichment.test.ts`

**Interfaces:**
- Produces: every flight object in `GET /api/v1/flights` additionally carries `depCountry: string | null`, `arrCountry: string | null`, `depTimezone: string | null`, `arrTimezone: string | null` (resolved IATA-first, then ICAO, from the airports catalog). Additive — no existing field changes.

- [ ] **Step 1: Write the failing test**

Copy the auth-cookie setup from `backend/src/routes/admin/__tests__/apiKeys.logostream.test.ts` (generateToken + `auth_token` cookie), but with a plain (non-admin) user. Seed one flight for that user via prisma with `depIata: "MUC"`, `arrIata: "JFK"` (both exist in the airports table of the dev DB; assert that in the test setup with a `prisma.airport.findFirst` guard and skip-fail with a clear message if the catalog is empty).

```ts
// backend/src/routes/__tests__/flights.listEnrichment.test.ts
it("returns dep/arr country and timezone resolved from the airports catalog", async () => {
  const res = await request(app).get("/api/v1/flights?limit=5").set("Cookie", authCookie);
  expect(res.status).toBe(200);
  const flight = res.body.flights.find((f: { id: string }) => f.id === seededFlightId);
  expect(flight.depCountry).toBe("DE");
  expect(flight.arrCountry).toBe("US");
  expect(typeof flight.depTimezone).toBe("string"); // e.g. "Europe/Berlin"
  expect(typeof flight.arrTimezone).toBe("string");
});
```

Run: `cd backend && npx jest src/routes/__tests__/flights.listEnrichment.test.ts --forceExit` — expected FAIL (`depCountry` undefined).

- [ ] **Step 2: Implement**

In the GET `/` handler, next to the existing `tzMap`, build a `countryMap` from the SAME `getCachedAirports` result (one extra loop, zero extra queries):

```ts
const countryMap = new Map<string, string>();
// inside the existing `for (const [code, data] of airports.entries())` loop:
if (data?.country) countryMap.set(code, data.country);
```

In `enrichedFlights`, after `durationMinutes`:

```ts
return {
  ...f,
  durationMinutes: rawDuration === null ? null : Math.round(rawDuration),
  depCountry: (f.depIata && countryMap.get(f.depIata)) || (f.depIcao && countryMap.get(f.depIcao)) || null,
  arrCountry: (f.arrIata && countryMap.get(f.arrIata)) || (f.arrIcao && countryMap.get(f.arrIcao)) || null,
  depTimezone: depTz,
  arrTimezone: arrTz,
};
```

(`depTz`/`arrTz` already exist in that scope.)

- [ ] **Step 3: Run test → PASS**, plus `npx tsc --noEmit && npm run lint`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/flights.ts backend/src/routes/__tests__/flights.listEnrichment.test.ts
git commit -m "feat(flights): return airport countries and timezones in the list response"
```

---

### Task 2: Pure display helpers — flag emoji, day shift, source info

**Files:**
- Create: `frontend/src/lib/countryFlag.ts` + Test: `frontend/src/lib/countryFlag.test.ts`
- Create: `frontend/src/lib/dayShift.ts` + Test: `frontend/src/lib/dayShift.test.ts`
- Create: `frontend/src/lib/flightSourceInfo.ts` + Test: `frontend/src/lib/flightSourceInfo.test.ts`
- Modify: `frontend/src/types/index.ts` (add `depCountry?: string | null; arrCountry?: string | null;` to the `Flight` interface, next to `depTimezone`)

**Interfaces (produces):**
- `countryFlag(iso2: string | null | undefined): string | null` — "DE" → "🇩🇪"; null/short/non-alpha input → null.
- `dayShift(depIso: string, arrIso: string, depTz: string | null | undefined, arrTz: string | null | undefined): number` — calendar-day difference between arrival (in arrTz) and departure (in depTz); missing tz falls back to UTC; ≥1 means overnight.
- `type SourceInfoLine = { icon: string; label: string; detail?: string }`
- `getFlightSourceInfo(flight: Flight, t: TFunction): SourceInfoLine[]` — empty array when there is nothing to tell (plain manual flight, no enrichment, no auto-update); preserves ALL of DataSourceBadges' semantics (pinned facts above). `TFunction` = `(key: string, options?: Record<string, unknown>) => string` (match how `DataSourceBadges` types its `t`).

- [ ] **Step 1: Failing tests**

```ts
// countryFlag.test.ts
import { countryFlag } from "./countryFlag";
it("maps ISO-2 to a regional-indicator emoji", () => {
  expect(countryFlag("DE")).toBe("🇩🇪");
  expect(countryFlag("us")).toBe("🇺🇸");
});
it("returns null for invalid input", () => {
  expect(countryFlag(null)).toBeNull();
  expect(countryFlag("")).toBeNull();
  expect(countryFlag("DEU")).toBeNull();
  expect(countryFlag("1A")).toBeNull();
});
```

```ts
// dayShift.test.ts
import { dayShift } from "./dayShift";
it("is 0 for a same-day flight", () => {
  expect(dayShift("2026-08-15T08:20:00Z", "2026-08-15T10:05:00Z", "Europe/Berlin", "Europe/Copenhagen")).toBe(0);
});
it("is 1 for an overnight eastbound flight", () => {
  // dep 21:40 Berlin (19:40Z), arr 06:45 Dubai next local day (02:45Z next day)
  expect(dayShift("2026-05-02T19:40:00Z", "2026-05-03T02:45:00Z", "Europe/Berlin", "Asia/Dubai")).toBe(1);
});
it("can be negative for westbound across midnight the other way", () => {
  // dep 01:00 Tokyo local on the 2nd (16:00Z on the 1st), arr 17:00 LA local on the 1st
  expect(dayShift("2026-05-01T16:00:00Z", "2026-05-02T00:00:00Z", "Asia/Tokyo", "America/Los_Angeles")).toBe(-1);
});
it("falls back to UTC when tz missing", () => {
  expect(dayShift("2026-05-02T23:00:00Z", "2026-05-03T01:00:00Z", null, null)).toBe(1);
});
```

```ts
// flightSourceInfo.test.ts
import { getFlightSourceInfo } from "./flightSourceInfo";
import type { Flight } from "../types";
const t = (key: string, opts?: Record<string, unknown>) =>
  opts?.count !== undefined ? `${key}:${opts.count}` : key;
const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("is empty for a plain manual flight", () => {
  expect(getFlightSourceInfo({ ...base, dataSource: "manual" }, t)).toEqual([]);
});
it("reports an email import", () => {
  const lines = getFlightSourceInfo({ ...base, dataSource: "email_import" }, t);
  expect(lines).toHaveLength(1);
  expect(lines[0].label).toBe("flights:dataSource.email_import");
  expect(lines[0].icon).toBe("📧");
});
it("combines live_update + auto_update into one line", () => {
  const lines = getFlightSourceInfo(
    { ...base, dataSource: "live_update", lastModifiedBy: "auto_update" }, t);
  expect(lines).toHaveLength(1);
  expect(lines[0].label).toBe("flights:dataSource.live_update_auto");
});
it("adds an enrichment line with confidence detail", () => {
  const lines = getFlightSourceInfo({
    ...base, dataSource: "manual",
    enrichmentHistory: [{ type: "historical", timestamp: "2026-07-04T00:00:00Z", confidence: 92, sourceFlightsCount: 14 }],
  } as unknown as Flight, t);
  expect(lines).toHaveLength(1);
  expect(lines[0].icon).toBe("🔍");
  expect(lines[0].detail).toContain("92");
});
```

Note the FIRST test: **`manual` alone yields an empty array** — the mockup decision is that the ℹ appears only when there is something to tell; "manually created" is the default and not worth a line. (This deliberately differs from DataSourceBadges, which showed a Manuell pill.) EXCEPTION: manual + enrichment → the enrichment line still appears (test 4 covers this).

- [ ] **Step 2: Run all three → FAIL (modules missing).**

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/countryFlag.ts
/** ISO 3166-1 alpha-2 → regional-indicator emoji ("DE" → 🇩🇪). */
export function countryFlag(iso2: string | null | undefined): string | null {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return null;
  const upper = iso2.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65)
  );
}
```

```ts
// frontend/src/lib/dayShift.ts
/**
 * Calendar-day difference between arrival and departure, each expressed in
 * its own airport-local timezone. 0 = same local day, 1 = "+1" overnight,
 * negative when crossing the date line westbound. Missing timezones fall
 * back to UTC so the marker degrades gracefully instead of lying.
 */
export function dayShift(
  depIso: string,
  arrIso: string,
  depTz: string | null | undefined,
  arrTz: string | null | undefined
): number {
  const localDate = (iso: string, tz: string | null | undefined): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date(iso)); // YYYY-MM-DD
  const dep = localDate(depIso, depTz);
  const arr = localDate(arrIso, arrTz);
  return Math.round((Date.parse(arr) - Date.parse(dep)) / 86_400_000);
}
```

```ts
// frontend/src/lib/flightSourceInfo.ts
import type { Flight } from "../types";

export type SourceInfoLine = { icon: string; label: string; detail?: string };
type TFunction = (key: string, options?: Record<string, unknown>) => string;

const SOURCE_ICONS: Record<string, string> = {
  email_import: "📧",
  boarding_pass_scan: "🎫",
  historical_enrichment: "🔍",
  live_update: "🔄",
  api_lookup: "🌐",
  imported_fr24: "📊",
  imported_generic_csv: "📥",
  imported_roundtrip: "↻",
};

/**
 * Data-provenance lines for the row's ℹ tooltip. Empty array = nothing worth
 * telling (a plain manual flight) — the ℹ is not rendered then. Mirrors the
 * retired DataSourceBadges semantics, minus the "Manuell" badge, which is
 * the default state rather than information.
 */
export function getFlightSourceInfo(flight: Flight, t: TFunction): SourceInfoLine[] {
  const lines: SourceInfoLine[] = [];
  const combined = flight.dataSource === "live_update" && flight.lastModifiedBy === "auto_update";

  if (combined) {
    lines.push({ icon: "🔄", label: t("flights:dataSource.live_update_auto") });
  } else if (flight.dataSource && flight.dataSource !== "manual") {
    const icon = SOURCE_ICONS[flight.dataSource];
    if (icon) lines.push({ icon, label: t(`flights:dataSource.${flight.dataSource}`) });
  }

  const history = flight.enrichmentHistory;
  if (history && history.length > 0 && flight.dataSource !== "historical_enrichment") {
    const latest = history[history.length - 1];
    const details: string[] = [];
    if (latest.confidence) details.push(`${t("flights:confidence")}: ${latest.confidence}%`);
    if (latest.sourceFlightsCount)
      details.push(t("flights:sourceFlightsCount", { count: latest.sourceFlightsCount }));
    lines.push({
      icon: "🔍",
      label:
        history.length > 1
          ? t("flights:enrichmentCount", { count: history.length })
          : t("flights:dataSource.historical_enrichment"),
      detail: details.length ? details.join(" · ") : undefined,
    });
  }

  if (
    !combined &&
    flight.lastModifiedBy === "auto_update" &&
    flight.dataSource !== "live_update" &&
    flight.dataSource !== "manual"
  ) {
    lines.push({ icon: "🔄", label: t("flights:dataSource.auto_update") });
  }

  return lines;
}
```

Also add to the `Flight` interface in `frontend/src/types/index.ts` (next to `depTimezone`):

```ts
depCountry?: string | null;
arrCountry?: string | null;
```

- [ ] **Step 4: Run the three test files → PASS**, then `npx tsc --noEmit && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/countryFlag.ts frontend/src/lib/countryFlag.test.ts frontend/src/lib/dayShift.ts frontend/src/lib/dayShift.test.ts frontend/src/lib/flightSourceInfo.ts frontend/src/lib/flightSourceInfo.test.ts frontend/src/types/index.ts
git commit -m "feat(flights-table): flag emoji, day-shift and source-info display helpers"
```

---

### Task 3: `AirlineLogo` custom fallback + `AirlineWordmarkCell`

**Files:**
- Modify: `frontend/src/components/AirlineLogo.tsx` (add optional `fallback?: React.ReactNode` prop; when set, render it instead of the letterbox on error/no-code; also allow non-square rendering via optional `width` prop)
- Create: `frontend/src/components/flightsTable/AirlineWordmarkCell.tsx`
- Test: `frontend/src/components/flightsTable/__tests__/AirlineWordmarkCell.test.tsx` and extend `frontend/src/components/__tests__/AirlineLogo.test.tsx`

**Interfaces:**
- `AirlineLogo` gains `fallback?: React.ReactNode` (rendered instead of the letterbox when the image errors or no code resolves) and `width?: number` (when set, the img gets `width` × `size` box instead of square; `object-contain` keeps the aspect).
- `AirlineWordmarkCell({ flight }: { flight: Flight })` — white rounded chip (`bg-white rounded-md px-2 py-1`, height 28px, max-width 120px) containing `<AirlineLogo variant="logo" size={20} width={96} ...>`; fallback = the airline display name as plain text (`resolveAirlineDisplay(flight) || flight.flightNumber || "—"`) in `var(--text-primary)`, no chip. The chip carries `title={resolveAirlineDisplay(flight) ?? undefined}` so the name stays discoverable on hover (the column no longer shows it as text — owner decision).

- [ ] **Step 1: Failing tests**

Extend `AirlineLogo.test.tsx`:

```tsx
it("renders the custom fallback instead of the letterbox", () => {
  render(<AirlineLogo iata="LH" fallback={<em>Lufthansa</em>} />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Lufthansa")).toBeInTheDocument();
  expect(screen.queryByText("LH")).not.toBeInTheDocument();
});
```

New `AirlineWordmarkCell.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import AirlineWordmarkCell from "../AirlineWordmarkCell";
import type { Flight } from "../../../types";

const flight = {
  id: "1", airline: "Lufthansa", airlineIata: "LH", flightNumber: "LH2462",
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
} as unknown as Flight;

it("requests the wordmark variant from the proxy", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
});

it("falls back to the airline name text when the logo fails", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Lufthansa")).toBeInTheDocument();
});

it("falls back to the name immediately when no code resolves", () => {
  render(<AirlineWordmarkCell flight={{ ...flight, airlineIata: undefined, flightNumber: undefined } as unknown as Flight} />);
  expect(screen.getByText("Lufthansa")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`AirlineLogo.tsx` — in the fallback branch (`if (!url || errored)`), before the letterbox: `if (fallback !== undefined) return <>{fallback}</>;`. Add `width` to props and to the img style/attrs: `width={width ?? size}` and `style={{ width: width ?? size, height: size }}`. Keep everything else identical; add both props to `AirlineLogoProps` with doc comments.

```tsx
// frontend/src/components/flightsTable/AirlineWordmarkCell.tsx
import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: the carrier's wordmark logo on a white chip (dark
 * logos stay readable on the dark theme). The written airline name is
 * deliberately NOT shown next to it (owner decision 2026-07-12) — it
 * remains available as the chip's title tooltip and as the text fallback
 * when no logo resolves.
 */
export default function AirlineWordmarkCell({ flight }: { flight: Flight }): JSX.Element {
  const name = resolveAirlineDisplay(flight);
  const fallback = (
    <span className="font-medium" style={{ color: "var(--text-primary)" }}>
      {name || flight.flightNumber || "—"}
    </span>
  );
  const iata = resolveAirlineIata(flight);
  if (!iata && !flight.airlineIcao) return fallback;
  return (
    <span
      className="inline-flex items-center justify-center bg-white rounded-md px-2"
      style={{ height: 28, maxWidth: 120 }}
      title={name ?? undefined}
    >
      <AirlineLogo
        iata={iata}
        icao={flight.airlineIcao}
        flightNumber={flight.flightNumber}
        variant="logo"
        size={20}
        width={96}
        className="object-contain"
        alt={name ?? "Airline logo"}
        fallback={fallback}
      />
    </span>
  );
}
```

NOTE the wrinkle: when the logo ERRORS, the fallback renders **inside the white chip** — a dark name on a white chip is fine, but the spec wants plain text. Solve it the simple way: lift the error state by keying off `AirlineLogo`'s fallback with a wrapper that renders the chip only around the `<img>`: pass `fallback={fallback}` AND make the chip styling part of the `className` on the img itself instead of an outer span — i.e. final implementation: NO outer chip span; `<AirlineLogo ... className="bg-white rounded-md px-2 py-1 object-contain" />` with `width={96}`/`size={28}` and `fallback={fallback}` — the white chip is the img's own background, so the fallback branch renders without it automatically. The test stays the same. Prefer this variant; the code above shows the intent, the img-className variant is the implementation.

- [ ] **Step 4: Run tests → PASS**; `npx tsc --noEmit && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AirlineLogo.tsx frontend/src/components/__tests__/AirlineLogo.test.tsx frontend/src/components/flightsTable/
git commit -m "feat(flights-table): wordmark airline cell with name fallback"
```

---

### Task 4: `TimeCell` and `RouteCell`

**Files:**
- Create: `frontend/src/components/flightsTable/TimeCell.tsx`
- Create: `frontend/src/components/flightsTable/RouteCell.tsx`
- Test: `frontend/src/components/flightsTable/__tests__/TimeCell.test.tsx`, `.../RouteCell.test.tsx`

**Interfaces:**
- `TimeCell({ flight }: { flight: Flight })` — two rows `ab` / `an` (labels via `t("flights:table.timeDep")` / `t("flights:table.timeArr")`): weekday short + compact date + time in **airport-local** timezone (`flight.depTimezone`/`arrTimezone`, fallback UTC). `+N` accent marker on the arrival row when `dayShift(...) >= 1`. Flights with `depTimeSemantics === "DATE_ONLY" | "UNKNOWN"` show the date only (no fake "00:00", no marker). Missing `departureTime` → "—".
- `RouteCell({ flight }: { flight: Flight })` — line 1: `{flag} {depCode} ─✈─ {flag} {arrCode}`; **flags via the EXISTING SVG component `FlagImg` from `frontend/src/lib/countryFlag.tsx`** (`<FlagImg country={flight.depCountry} height={12} />` — renders nothing for null/unknown). Do NOT use emoji flags: the repo abandoned them because Windows/Chrome renders regional-indicator pairs as raw letters (documented at the top of countryFlag.tsx). Codes `depIata || depIcao`; line 2: truncated airport names exactly as today (keep the existing `title` tooltip with both full names).

- [ ] **Step 1: Failing tests**

```tsx
// TimeCell.test.tsx  — mock useTranslation like AirlineLogo.test does
import { render, screen } from "@testing-library/react";
import TimeCell from "../TimeCell";
import type { Flight } from "../../../types";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("shows airport-local times and a +1 marker for an overnight flight", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T19:40:00Z", arrivalTime: "2026-05-03T02:45:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Asia/Dubai",
  } as unknown as Flight} />);
  expect(screen.getByText(/21:40/)).toBeInTheDocument();
  expect(screen.getByText(/06:45/)).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
});

it("shows date-only rows without marker for DATE_ONLY flights", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T12:00:00Z",
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.queryByText(/12:00/)).not.toBeInTheDocument();
  expect(screen.queryByText("+1")).not.toBeInTheDocument();
});

it("renders an em dash when no departure time exists", () => {
  render(<TimeCell flight={base} />);
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});
```

```tsx
// RouteCell.test.tsx
import { render, screen } from "@testing-library/react";
import RouteCell from "../RouteCell";
import type { Flight } from "../../../types";

const flight = {
  id: "1", depIata: "MUC", arrIata: "DXB", depCountry: "DE", arrCountry: "AE",
  depName: "Munich Airport", arrName: "Dubai International",
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
} as unknown as Flight;

it("renders SVG flags, codes and the names line", () => {
  const { container } = render(<RouteCell flight={flight} />);
  expect(container.querySelector('img[src*="flagcdn.com/de"]')).not.toBeNull();
  expect(container.querySelector('img[src*="flagcdn.com/ae"]')).not.toBeNull();
  expect(screen.getByText("MUC")).toBeInTheDocument();
  expect(screen.getByText("DXB")).toBeInTheDocument();
  expect(screen.getByText(/Munich Airport/)).toBeInTheDocument();
});

it("omits flags gracefully when countries are missing", () => {
  const { container } = render(<RouteCell flight={{ ...flight, depCountry: null, arrCountry: null } as unknown as Flight} />);
  expect(container.querySelector('img[src*="flagcdn"]')).toBeNull();
  expect(screen.getByText("MUC")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/flightsTable/TimeCell.tsx
import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { dayShift } from "../../lib/dayShift";

const dateFmt = (iso: string, tz: string, lang: string): string =>
  new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: tz,
  }).format(new Date(iso));

const timeFmt = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz })
    .format(new Date(iso));

/** One ab/an row pair: weekday + compact date + airport-local time, +N overnight marker. */
export default function TimeCell({ flight }: { flight: Flight }): JSX.Element {
  const { t, i18n } = useTranslation(["flights"]);
  const dateOnly =
    flight.depTimeSemantics === "DATE_ONLY" || flight.depTimeSemantics === "UNKNOWN";
  const depTz = flight.depTimezone || "UTC";
  const arrTz = flight.arrTimezone || "UTC";
  const shift =
    !dateOnly && flight.departureTime && flight.arrivalTime
      ? dayShift(flight.departureTime, flight.arrivalTime, depTz, arrTz)
      : 0;

  const row = (label: string, iso: string | null | undefined, tz: string, marker?: number) => (
    <div className="flex items-baseline gap-2 whitespace-nowrap text-[12.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="w-4 text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      {iso ? (
        <>
          <span style={{ color: "var(--text-primary)" }}>{dateFmt(iso, tz, i18n.language)}</span>
          {!dateOnly && <span style={{ color: "var(--text-muted)" }}>{timeFmt(iso, tz)}</span>}
          {marker !== undefined && marker >= 1 && (
            <span className="text-[10px] font-semibold" style={{ color: "var(--accent)" }}>+{marker}</span>
          )}
        </>
      ) : (
        <span style={{ color: "var(--text-muted)" }}>—</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {row(t("flights:table.timeDep"), flight.departureTime, depTz)}
      {row(t("flights:table.timeArr"), flight.arrivalTime, arrTz, shift)}
    </div>
  );
}
```

```tsx
// frontend/src/components/flightsTable/RouteCell.tsx
import type { Flight } from "../../types";
import { FlagImg } from "../../lib/countryFlag";

/** Route cell: SVG flags + IATA codes with a plane connector, airport names below. */
export default function RouteCell({ flight }: { flight: Flight }): JSX.Element {
  const namesTitle =
    flight.depName && flight.arrName ? `${flight.depName} → ${flight.arrName}` : undefined;
  return (
    <div className="max-w-[16rem]">
      <div className="flex items-center gap-1.5">
        <FlagImg country={flight.depCountry} height={12} />
        <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>
          {flight.depIata || flight.depIcao}
        </span>
        <span className="inline-flex items-center opacity-60" style={{ color: "var(--text-muted)" }}>
          <span className="inline-block w-3 h-px" style={{ background: "var(--color-border)" }} />
          <span className="text-[13px] mx-0.5 inline-block" style={{ transform: "rotate(45deg)" }}>✈</span>
          <span className="inline-block w-3 h-px" style={{ background: "var(--color-border)" }} />
        </span>
        <FlagImg country={flight.arrCountry} height={12} />
        <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>
          {flight.arrIata || flight.arrIcao}
        </span>
      </div>
      <div className="text-xs truncate" style={{ color: "var(--text-muted)" }} title={namesTitle}>
        {flight.depName} → {flight.arrName}
      </div>
    </div>
  );
}
```

i18n additions in this task (DE first, EN mirror) under the existing `table` object in `frontend/src/i18n/resources/de/flights.json`:

```json
"timeDep": "ab",
"timeArr": "an"
```

`en/flights.json`:

```json
"timeDep": "dep",
"timeArr": "arr"
```

- [ ] **Step 4: Run tests → PASS**; frontend gate on touched files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/flightsTable/ frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "feat(flights-table): merged time cell and flagged route cell"
```

---

### Task 5: `SourceInfoDot` + icon `FlightRowActions`

**Files:**
- Create: `frontend/src/components/flightsTable/SourceInfoDot.tsx` + Test: `.../SourceInfoDot.test.tsx`
- Modify: `frontend/src/components/FlightRowActions.tsx` (text buttons → icon buttons; dropdown + controlled-menu contract unchanged)
- Test: extend/create `frontend/src/components/__tests__/FlightRowActions.test.tsx` if none exists (it does not today — create it)

**Interfaces:**
- `SourceInfoDot({ flight }: { flight: Flight })` — returns `null` when `getFlightSourceInfo` is empty. Otherwise an 18px round ℹ button; tooltip opens on hover (CSS) AND on click (state toggle — the touch fallback), closes on outside click via a document listener. Tooltip lines: `{icon} {label}` + muted `detail` line.
- `FlightRowActions` — same props as today (`flight, openDuplicateMenuFor, onToggleDuplicateMenu, onEdit, onDuplicate, onDelete`); renders three 28×28 icon buttons (pencil / copy / trash inline SVGs, `stroke="currentColor"`, colors: edit `#388bfd` hover, duplicate `var(--text-muted)`, delete `var(--danger)` hover) each with `aria-label` + `title` from the SAME i18n keys used today (`common:buttons.edit`, `flights:table.duplicate.label`, `common:buttons.delete`). Keep `data-duplicate-menu` and the controlled dropdown exactly as-is.

- [ ] **Step 1: Failing tests**

```tsx
// SourceInfoDot.test.tsx — mock useTranslation as in TimeCell.test
import { render, screen, fireEvent } from "@testing-library/react";
import SourceInfoDot from "../SourceInfoDot";
import type { Flight } from "../../../types";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("renders nothing for a plain manual flight", () => {
  const { container } = render(<SourceInfoDot flight={{ ...base, dataSource: "manual" } as unknown as Flight} />);
  expect(container.firstChild).toBeNull();
});

it("shows the tooltip on click (touch fallback) and hides on second click", () => {
  render(<SourceInfoDot flight={{ ...base, dataSource: "email_import" } as unknown as Flight} />);
  const dot = screen.getByRole("button");
  fireEvent.click(dot);
  expect(screen.getByText("flights:dataSource.email_import")).toBeInTheDocument();
  fireEvent.click(dot);
  expect(screen.queryByText("flights:dataSource.email_import")).not.toBeInTheDocument();
});
```

```tsx
// FlightRowActions.test.tsx — mock useTranslation the same way
import { render, screen, fireEvent } from "@testing-library/react";
import FlightRowActions from "../FlightRowActions";
import type { Flight } from "../../types";
const flight = { id: "f1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;
const noop = () => {};

it("renders icon buttons with accessible labels and no text labels", () => {
  render(<FlightRowActions flight={flight} openDuplicateMenuFor={null}
    onToggleDuplicateMenu={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  expect(screen.getByLabelText("common:buttons.edit")).toBeInTheDocument();
  expect(screen.getByLabelText("flights:table.duplicate.label")).toBeInTheDocument();
  expect(screen.getByLabelText("common:buttons.delete")).toBeInTheDocument();
  // no visible text labels anymore
  expect(screen.queryByText("common:buttons.edit")).not.toBeInTheDocument();
});

it("keeps the controlled duplicate dropdown contract", () => {
  const onToggle = vi.fn();
  render(<FlightRowActions flight={flight} openDuplicateMenuFor={null}
    onToggleDuplicateMenu={onToggle} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  fireEvent.click(screen.getByLabelText("flights:table.duplicate.label"));
  expect(onToggle).toHaveBeenCalledWith("f1");
});

it("shows the dropdown entries when open", () => {
  render(<FlightRowActions flight={flight} openDuplicateMenuFor="f1"
    onToggleDuplicateMenu={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  expect(screen.getByText("flights:table.duplicate.same")).toBeInTheDocument();
  expect(screen.getByText("flights:table.duplicate.return")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL** (SourceInfoDot missing; FlightRowActions still shows text).

- [ ] **Step 3: Implement**

`SourceInfoDot.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightSourceInfo } from "../../lib/flightSourceInfo";

/**
 * ℹ dot next to the row actions carrying the data-provenance tooltip.
 * Renders nothing when there is nothing to tell. Hover shows the tooltip
 * via CSS (group-hover); click toggles it (touch fallback) and a document
 * listener closes it again.
 */
export default function SourceInfoDot({ flight }: { flight: Flight }): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const lines = getFlightSourceInfo(flight, t);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (lines.length === 0) return null;

  return (
    <span ref={rootRef} className="relative inline-flex group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("flights:table.sourceInfo")}
        aria-expanded={open}
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border text-[10.5px] italic font-semibold"
        style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
      >
        i
      </button>
      <span
        className={`absolute right-0 top-full mt-2 z-20 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-lg ${open ? "block" : "hidden group-hover:block"}`}
        style={{ background: "var(--bg-base)", borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        role="tooltip"
      >
        {lines.map((line, i) => (
          <span key={i} className="block">
            <span className="font-medium">{line.icon} {line.label}</span>
            {line.detail && (
              <span className="block" style={{ color: "var(--text-muted)" }}>{line.detail}</span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
```

`FlightRowActions.tsx` — replace the three text buttons with icon buttons; the pencil/copy/trash SVGs (24-viewBox, `fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"`, w-4 h-4):

- pencil: `<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />`
- copy: `<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />`
- trash: `<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />`

Button shell (each): `className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[var(--bg-muted)]"` with `style={{ color: "var(--text-muted)" }}` and per-button hover colour via inline `onMouseEnter/Leave` NOT needed — use Tailwind arbitrary variants instead: edit `hover:text-[#388bfd]`, duplicate `hover:text-[var(--text-primary)]`, delete `hover:text-[var(--danger)]`. Each gets `aria-label` and `title` from the same keys as before. The duplicate button keeps its wrapper `<div className="relative" data-duplicate-menu>` and the identical dropdown markup/handlers.

i18n addition (DE / EN) under `table`:

```json
"sourceInfo": "Datenquelle"        // de
"sourceInfo": "Data source"        // en
```

- [ ] **Step 4: Run tests → PASS**; frontend gate on touched files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/flightsTable/ frontend/src/components/FlightRowActions.tsx frontend/src/components/__tests__/FlightRowActions.test.tsx frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "feat(flights-table): source-info tooltip dot and icon action buttons"
```

---

### Task 6: Rebuild the table in `FlightsTablePage`

**Files:**
- Modify: `frontend/src/pages/FlightsTablePage.tsx`
- Modify: `frontend/src/i18n/resources/de/flights.json` + en mirror (new column header key)
- Test: `frontend/src/pages/__tests__/FlightsTablePage.columns.test.tsx` (new — no page test exists today)

**Interfaces:**
- Consumes: `AirlineWordmarkCell`, `RouteCell`, `TimeCell`, `SourceInfoDot` (Tasks 3–5), `FlightRowActions` (icon version).
- Produces: column layout `Airline | Flugnr. | Route | Zeit | Status | Dauer | Flugzeug | Preis | Reise | Aktionen` — the two date columns merge into one Zeit column; `DataSourceBadges` import and usage REMOVED from this page; status cell = the pill alone (existing colour logic untouched); price cell gets `style={{ fontVariantNumeric: "tabular-nums" }}` with the currency in a muted smaller span; actions cell = `<FlightRowActions .../>` followed by `<SourceInfoDot flight={flight} />` inside the same right-aligned flex container, with a fixed-width 18px slot (`<span className="inline-flex w-[18px] justify-center">`) so rows without an ℹ stay aligned.

- [ ] **Step 1: Failing test**

Testing the full page needs heavy mocking (stores, router, API). Keep it surgical — render only the row-composition contract via a lightweight harness: extract the row into `frontend/src/pages/flightsTableRow.tsx`? NO — that would churn the page twice. Instead assert the page module's structure statically:

```tsx
// frontend/src/pages/__tests__/FlightsTablePage.columns.test.tsx
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(resolve(__dirname, "../FlightsTablePage.tsx"), "utf-8");

it("uses the new cell components and drops DataSourceBadges + the second date column", () => {
  expect(src).toContain("<AirlineWordmarkCell");
  expect(src).toContain("<RouteCell");
  expect(src).toContain("<TimeCell");
  expect(src).toContain("<SourceInfoDot");
  expect(src).not.toContain("DataSourceBadges");
  expect(src).not.toContain("table.arrivalDate"); // merged into the Zeit column
});
```

(A source-scan test is the honest cheap gate here — the real behaviour is covered by the cell tests in Tasks 3–5 and the browser verification in Task 7.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement the page changes**

1. Imports: drop `DataSourceBadges`; add the four new cells.
2. Header row: replace the two date `<th>`s with one: `{t("flights:table.time")}`. All other headers unchanged.
3. Airline cell: replace the `resolveAirlineDisplay` text div with `<AirlineWordmarkCell flight={flight} />`, keep the `specialType` badge line below it unchanged.
4. Route cell: replace the two-line markup with `<RouteCell flight={flight} />`.
5. Date cells → single `<td className="px-4 py-3"><TimeCell flight={flight} /></td>`.
6. Status cell: remove the `flex flex-col gap-2` stack and `<DataSourceBadges/>` — the pill stays exactly as-is.
7. Price cell:

```tsx
<td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
  {flight.price ? (
    <>
      {flight.price.toFixed(2)}
      <span className="ml-1 text-[11px]">{flight.currency || "EUR"}</span>
    </>
  ) : (
    t("common:labels.notAvailable")
  )}
</td>
```

8. Actions cell:

```tsx
<td className="px-4 py-3 text-right whitespace-nowrap">
  <div className="flex items-center justify-end gap-1.5">
    <FlightRowActions ... (unchanged props) />
    <span className="inline-flex w-[18px] justify-center">
      <SourceInfoDot flight={flight} />
    </span>
  </div>
</td>
```

9. Remove the now-unused `formatDate` helper if nothing else in the file uses it (check first — the mobile/card section of the page, if any, may use it).
10. i18n: add under `table` — DE `"time": "Zeit"`, EN `"time": "Time"`. Check whether `table.departureDate`/`table.arrivalDate` keys become orphaned; if no other file uses them, REMOVE them from both locales (the commonKeys i18n scan only checks `common:*`, so orphan removal is safe but grep first).

- [ ] **Step 4: Run the new test → PASS.** Full frontend gate: `npx tsc --noEmit && npm run lint && npx vitest --run` (full suite — page-level change).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FlightsTablePage.tsx frontend/src/pages/__tests__/FlightsTablePage.columns.test.tsx frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "feat(flights-table): merged time column, wordmark airline, flags, bare status, icon actions"
```

---

### Task 7: End-to-end verification (browser, real data)

**Files:** none (verification only)

- [ ] **Step 1:** Start a fresh dev pair on FREE ports (check with netstat first; 8000/8002/8004/8006/8008/8010/3002/3004/3006/3008/3010 are known-occupied by orphans):

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" PORT=<BE> FRONTEND_URL=http://localhost:<FE> CORS_ORIGIN=http://localhost:<FE> NODE_ENV=development COOKIE_SECURE=false npx tsx src/index.ts
cd frontend && VITE_API_URL=http://localhost:<BE> npx vite --port <FE> --strictPort
```

Orphan check: `curl http://localhost:<BE>/api/v1/airline-logos/LH` must return 401 (not 404).

- [ ] **Step 2:** Browser (`admin`/`admin123` — reseed via `npm run seed:dev-admin` if 401): open `/flights` and verify against the mockup: one Zeit column with ab/an + weekday + local times; +1 on an overnight flight (EK050 in the demo set); flags before the IATA codes; airline column shows wordmark chips where a logo resolves and the plain name otherwise; status = bare pill; icon actions; ℹ only on rows with provenance (email-import/enrichment) and its tooltip on hover AND click; row height visibly reduced. Screenshot for the owner.
- [ ] **Step 3:** Confirm no request to `daisycon` in DevTools network; logo requests go to `/api/v1/airline-logos/...?variant=logo`.
- [ ] **Step 4:** Full gates: backend `npx tsc --noEmit && npm run lint` + the Task 1 test; frontend full `npx tsc --noEmit && npm run lint && npx vitest --run`. `gitnexus detect_changes` scope check. Report to the owner — the merge question (this branch is stacked on `feat/airline-logo-proxy`) is the owner's isolated decision.

---

## Explicitly out of scope

- `FlightList.tsx` — dead code (only its own test imports it); follow-up: delete it + its test.
- The old `DataSourceBadges.tsx` stays in the repo after this feature only if another consumer exists — Task 6 removes the last known usage; deleting the component + its i18n "manual" pill key is a follow-up cleanup, not part of this branch.
- Sorting changes (the sort menu keeps departure-time sorting; no per-column sort headers).
- The trip chip column and Filters bar — unchanged.
- TravStatsApp parity.
