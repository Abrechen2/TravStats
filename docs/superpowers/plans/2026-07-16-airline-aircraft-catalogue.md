# Airline & Aircraft Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn airlines and aircraft into seeded Prisma tables (mirroring Ship/Port), resolve flight write-paths against them via a cached resolver, retire the four hand-maintained airline lists, and backfill airline codes onto stored flights.

**Architecture:** Two additive Prisma tables (`airlines`, `aircraft`) seeded at boot from vendored OpenFlights data unioned with the existing curated lists (curated wins). The existing synchronous resolvers keep their signatures but read from an in-memory cache preloaded from the tables and invalidated on admin-create. `Flight` stays a denormalized snapshot — no foreign key. The frontend catalogue is regenerated from the DB seed.

**Tech Stack:** Express + TypeScript, Prisma + PostgreSQL, Zod, Jest (backend), React + Vite + Vitest (frontend), react-i18next.

## Global Constraints

- `any` is FORBIDDEN — use `unknown` + type guards (except `.d.ts`).
- Pino logger: `import logger from '../utils/logger'` (default export). No `console.log`.
- Zod for all user input at route boundaries.
- Immutability: spread `{...obj, field}`, never mutate.
- File size 200–400 lines ideal, 800 hard max.
- Prettier: printWidth 100, `singleQuote: false` (frontend uses double quotes; backend files vary — match the file you edit).
- Frontend user copy: German primary + English mirror, updated together (`admin` i18n namespace).
- Resolver philosophy (#106B): strict-exact match, return `null` never a guess.
- Branch: `feat/airline-aircraft-catalogue` (already created). Commit after every task.
- After schema/data changes touching stored flights, clear the polluted dev logo cache: `rm -rf backend/.travstats-data/cache/airline-logos/`.
- Build gate before merge: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit` and `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

---

## Phase 1 — Schema & migration

### Task 1: Add Airline + Aircraft Prisma models and generate the migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (add two models near the Ship/Port block ~line 1007)
- Create: `backend/prisma/migrations/<timestamp>_airline_aircraft_catalogue/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `Airline` and `Aircraft` (tables `airlines`, `aircraft`) with the exact fields below; `prisma.airline` / `prisma.aircraft` clients.

- [ ] **Step 1: Clear the failed dev migration marker**

The dev DB carries a failed marker for an already-applied migration; clear it so `migrate dev` runs. (Verified 2026-07-16: live dev DB → schema diff is empty, so the column exists.)

Run:
```bash
cd backend
npx prisma migrate resolve --applied 20260712113158_add_logostream_api_key
npx prisma migrate status
```
Expected: status no longer lists a failed migration ("Database schema is up to date" or only shows the not-yet-created new one as absent).

- [ ] **Step 2: Add the two models to `schema.prisma`**

Insert after the `Port` model (`@@map("ports")` block):

```prisma
model Airline {
  id          Int     @id @default(autoincrement())
  iata        String? @unique
  icao        String?
  name        String
  callsign    String?
  country     String?
  active      Boolean @default(true)
  isUserAdded Boolean @default(false) @map("is_user_added")

  @@index([name])
  @@index([icao])
  @@map("airlines")
}

model Aircraft {
  id          Int     @id @default(autoincrement())
  icao        String? @unique
  name        String
  isUserAdded Boolean @default(false) @map("is_user_added")

  @@index([name])
  @@map("aircraft")
}
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
cd backend
npx prisma migrate dev --name airline_aircraft_catalogue
```
Expected: a new migration folder is created containing only `CREATE TABLE "airlines"`, `CREATE TABLE "aircraft"`, and their indexes/unique constraints. NO `ALTER`/`DROP` on unrelated tables. If any unrelated statement appears, STOP — the drift is not actually clean; do not proceed.

- [ ] **Step 4: Verify the migration is additive-only**

Run:
```bash
cd backend
cat prisma/migrations/*_airline_aircraft_catalogue/migration.sql
```
Expected: only `CREATE TABLE`/`CREATE INDEX`/`CREATE UNIQUE INDEX` for `airlines` and `aircraft`.

- [ ] **Step 5: Regenerate the Prisma client**

Run: `cd backend && npx prisma generate`
Expected: success. (Windows DLL lock: if `EPERM`, stop the dev backend first or rename the locked DLL per CLAUDE.local.md.)

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(catalogue): add Airline and Aircraft prisma models + migration"
```

> **Prod pre-flight (record for the eventual deploy, do NOT run against prod now):** before `migrate deploy` ships this, confirm on prod: `prisma migrate status` clean, `prisma migrate diff --from-url "$PROD_DATABASE_URL" --to-schema-datamodel backend/prisma/schema.prisma` empty (pre-this-migration), and prod `_prisma_migrations` has no unresolved logostream marker.

---

## Phase 2 — Vendored data, parsing & dedup

### Task 2: Clean the curated aircraft data bugs

**Files:**
- Modify: `backend/src/data/aircraftTypes.ts:15,23,25`
- Test: `backend/src/data/__tests__/aircraftTypes.test.ts` (create)

**Interfaces:**
- Consumes: `AIRCRAFT_TYPES: AircraftType[]` from `../aircraftTypes`.
- Produces: `AIRCRAFT_TYPES` with unique, 4-char ICAO codes.

- [ ] **Step 1: Write the failing test**

Create `backend/src/data/__tests__/aircraftTypes.test.ts`:
```typescript
import { AIRCRAFT_TYPES } from "../aircraftTypes";

describe("AIRCRAFT_TYPES data integrity", () => {
  it("has no duplicate ICAO codes", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const t of AIRCRAFT_TYPES) {
      if (seen.has(t.icao)) dupes.push(`${t.icao}: "${seen.get(t.icao)}" vs "${t.name}"`);
      seen.set(t.icao, t.name);
    }
    expect(dupes).toEqual([]);
  });

  it("uses 4-character ICAO type designators", () => {
    const bad = AIRCRAFT_TYPES.filter((t) => !/^[A-Z0-9]{4}$/.test(t.icao));
    expect(bad.map((t) => t.icao)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/data/__tests__/aircraftTypes.test.ts`
Expected: FAIL — duplicate `A20N` (A220-100 vs A320neo) and non-4-char `A321XLR`.

- [ ] **Step 3: Fix the data**

In `backend/src/data/aircraftTypes.ts`:
- Line 15: change `{ icao: "A20N", name: "Airbus A220-100" }` → `{ icao: "BCS1", name: "Airbus A220-100" }` (BCS1 is the correct ICAO for the A220-100; `A20N` is the A320neo). Leave the A220-300 entry as `A223`.
- Line 25: change `{ icao: "A321XLR", name: "Airbus A321XLR" }` → `{ icao: "A21N", name: "Airbus A321neo" }` **only if** no existing `A21N` row already covers it. There IS already `{ icao: "A21N", name: "Airbus A321neo" }` at line 24 — so **delete the `A321XLR` row entirely** (the XLR is a subtype of the A321neo, already represented by `A21N`).
- Keep the `A20N` → `Airbus A320neo` row (line 23) — that mapping is correct.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/data/__tests__/aircraftTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/aircraftTypes.ts backend/src/data/__tests__/aircraftTypes.test.ts
git commit -m "fix(catalogue): dedupe curated aircraft ICAO codes (A20N/A321XLR)"
```

### Task 3: Vendor OpenFlights data files

**Files:**
- Create: `backend/data/openflights/airlines.dat`
- Create: `backend/data/openflights/planes.dat`
- Create: `backend/data/openflights/README.md`

- [ ] **Step 1: Download the vendored source files**

Run:
```bash
mkdir -p backend/data/openflights
curl -fsSL https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat -o backend/data/openflights/airlines.dat
curl -fsSL https://raw.githubusercontent.com/jpatokal/openflights/master/data/planes.dat -o backend/data/openflights/planes.dat
wc -l backend/data/openflights/airlines.dat backend/data/openflights/planes.dat
```
Expected: `airlines.dat` ~6100 lines, `planes.dat` ~250 lines. If `curl` has no network, fetch these files manually and place them at those paths — the plan cannot proceed without them.

- [ ] **Step 2: Document provenance**

Create `backend/data/openflights/README.md`:
```markdown
# OpenFlights vendored data

- `airlines.dat`, `planes.dat` — from https://github.com/jpatokal/openflights
  (`data/` dir), Open Database License (ODbL).
- Format `airlines.dat` (headerless CSV, `\N` = null):
  AirlineID, Name, Alias, IATA, ICAO, Callsign, Country, Active("Y"/"N")
- Format `planes.dat` (headerless CSV): Name, IATA, ICAO
- Seeded by `backend/src/data/openflights/*`. Refresh by re-downloading; the
  seeders are idempotent and curated data always wins on conflict.
```

- [ ] **Step 3: Copy the vendored data into the Docker image**

Without this, prod seeds nothing (the seeders `ENOENT`-fall-through silently and logos degrade). Mirror the marnet precedent at `Dockerfile:96`. Add near the other `COPY backend/data/...` lines (after line 104):
```dockerfile
# Vendored OpenFlights airline + aircraft seed data (data/openflights/*.dat),
# consumed by the boot seeders (seedAirlinesFromData / seedAircraftFromData).
# Without these the airline/aircraft tables seed empty and the logo lookup
# degrades to placeholders.
COPY backend/data/openflights/airlines.dat ./data/openflights/airlines.dat
COPY backend/data/openflights/planes.dat ./data/openflights/planes.dat
```

- [ ] **Step 4: Commit**

```bash
git add backend/data/openflights Dockerfile
git commit -m "chore(catalogue): vendor OpenFlights airlines.dat + planes.dat (+ Dockerfile)"
```

### Task 4: OpenFlights parse + dedup module

**Files:**
- Create: `backend/src/data/openflights/parseOpenFlights.ts`
- Test: `backend/src/data/openflights/__tests__/parseOpenFlights.test.ts`

**Interfaces:**
- Produces:
  - `parseAirlinesDat(raw: string): OpenFlightsAirline[]` where `OpenFlightsAirline = { iata: string | null; icao: string | null; name: string; callsign: string | null; country: string | null; active: boolean }`
  - `parsePlanesDat(raw: string): OpenFlightsPlane[]` where `OpenFlightsPlane = { name: string; icao: string | null }`
  - `dedupeAirlinesByIata(rows: OpenFlightsAirline[]): OpenFlightsAirline[]` — drops blank-IATA rows, keeps one row per IATA preferring `active`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/data/openflights/__tests__/parseOpenFlights.test.ts`:
```typescript
import { parseAirlinesDat, parsePlanesDat, dedupeAirlinesByIata } from "../parseOpenFlights";

describe("parseAirlinesDat", () => {
  it("parses fields and maps \\N to null, Active to boolean", () => {
    const raw = `1,"Private flight","\\N","-","N/A",\\N,\\N,"Y"
5,"Lufthansa","\\N","LH","DLH","LUFTHANSA","Germany","Y"
99,"Defunct Air","\\N","LH","OLD","OLDCALL","Nowhere","N"`;
    const rows = parseAirlinesDat(raw);
    expect(rows).toHaveLength(3);
    const lh = rows.find((r) => r.name === "Lufthansa");
    expect(lh).toEqual({
      iata: "LH", icao: "DLH", name: "Lufthansa",
      callsign: "LUFTHANSA", country: "Germany", active: true,
    });
    // "-" and "N/A" IATA/ICAO placeholders normalize to null
    const priv = rows.find((r) => r.name === "Private flight");
    expect(priv?.iata).toBeNull();
    expect(priv?.icao).toBeNull();
  });
});

describe("dedupeAirlinesByIata", () => {
  it("drops blank-IATA rows and prefers the active carrier on collision", () => {
    const rows = parseAirlinesDat(`5,"Lufthansa","\\N","LH","DLH","C","Germany","Y"
99,"Defunct Air","\\N","LH","OLD","C","Nowhere","N"
7,"No Code Air","\\N",\\N,"NCA","C","X","Y"`);
    const out = dedupeAirlinesByIata(rows);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Lufthansa"); // active wins
    expect(out.some((r) => r.iata === null)).toBe(false); // blank dropped
  });
});

describe("parsePlanesDat", () => {
  it("parses name + icao, maps \\N to null", () => {
    const rows = parsePlanesDat(`"Airbus A320","320","A320"
"Some Glider","\\N","\\N"`);
    expect(rows).toContainEqual({ name: "Airbus A320", icao: "A320" });
    expect(rows.find((r) => r.name === "Some Glider")?.icao).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/data/openflights/__tests__/parseOpenFlights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `backend/src/data/openflights/parseOpenFlights.ts`:
```typescript
import { parse } from "csv-parse/sync";

export interface OpenFlightsAirline {
  iata: string | null;
  icao: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  active: boolean;
}

export interface OpenFlightsPlane {
  name: string;
  icao: string | null;
}

// OpenFlights uses "\N" (backslash-N) for null and "-" / "N/A" as placeholder
// IATA/ICAO values. Normalize all of them to null.
function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === "" || v === "\\N" || v === "-" || v === "N/A") return null;
  return v;
}

export function parseAirlinesDat(raw: string): OpenFlightsAirline[] {
  const records = parse(raw, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  return records
    .map((cols): OpenFlightsAirline | null => {
      const name = clean(cols[1]);
      if (!name) return null;
      return {
        name,
        iata: clean(cols[3]),
        icao: clean(cols[4]),
        callsign: clean(cols[5]),
        country: clean(cols[6]),
        active: clean(cols[7])?.toUpperCase() === "Y",
      };
    })
    .filter((r): r is OpenFlightsAirline => r !== null);
}

export function parsePlanesDat(raw: string): OpenFlightsPlane[] {
  const records = parse(raw, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  return records
    .map((cols): OpenFlightsPlane | null => {
      const name = clean(cols[0]);
      if (!name) return null;
      return { name, icao: clean(cols[2]) };
    })
    .filter((r): r is OpenFlightsPlane => r !== null);
}

/**
 * Dedupe airlines by IATA code. Drops rows without an IATA (they cannot feed
 * an IATA-keyed logo lookup) and, on collision, keeps the active carrier
 * (defunct airlines reuse codes). First active wins; if none active, first seen.
 */
export function dedupeAirlinesByIata(rows: OpenFlightsAirline[]): OpenFlightsAirline[] {
  const byIata = new Map<string, OpenFlightsAirline>();
  for (const row of rows) {
    if (!row.iata) continue;
    const existing = byIata.get(row.iata);
    if (!existing) {
      byIata.set(row.iata, row);
    } else if (!existing.active && row.active) {
      byIata.set(row.iata, row);
    }
  }
  return Array.from(byIata.values());
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/data/openflights/__tests__/parseOpenFlights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/openflights/parseOpenFlights.ts backend/src/data/openflights/__tests__/parseOpenFlights.test.ts
git commit -m "feat(catalogue): OpenFlights parse + IATA dedup module"
```

### Task 5: Airline seed builder (OpenFlights ∪ curated, curated wins)

**Files:**
- Create: `backend/src/data/openflights/buildAirlineSeed.ts`
- Test: `backend/src/data/openflights/__tests__/buildAirlineSeed.test.ts`

**Interfaces:**
- Consumes: `parseAirlinesDat`, `dedupeAirlinesByIata` (Task 4); `AIRLINES` from `../airlines`.
- Produces: `buildAirlineSeed(openflightsRaw: string): AirlineSeedRow[]` where `AirlineSeedRow = { iata: string; icao: string | null; name: string; callsign: string | null; country: string | null; active: boolean }`. Curated rows override OpenFlights on IATA (name + icao come from the curated list); every curated IATA is present.

- [ ] **Step 1: Write the failing test**

Create `backend/src/data/openflights/__tests__/buildAirlineSeed.test.ts`:
```typescript
import { buildAirlineSeed } from "../buildAirlineSeed";
import { AIRLINES } from "../../airlines";

const RAW = `5,"Lufthansa GmbH","\\N","LH","LHX","C","Germany","Y"
6,"Swiss International Air Lines","\\N","LX","SWR","C","Switzerland","Y"`;

describe("buildAirlineSeed", () => {
  it("lets the curated list win on name + icao for a shared IATA", () => {
    const seed = buildAirlineSeed(RAW);
    const lh = seed.find((r) => r.iata === "LH");
    // curated airlines.ts has { iata:"LH", icao:"DLH", name:"Lufthansa" }
    expect(lh?.name).toBe("Lufthansa");
    expect(lh?.icao).toBe("DLH");
  });

  it("includes every curated IATA code", () => {
    const seed = buildAirlineSeed(RAW);
    const seedIatas = new Set(seed.map((r) => r.iata));
    for (const a of AIRLINES) expect(seedIatas.has(a.iata)).toBe(true);
  });

  it("keeps OpenFlights-only carriers not in the curated list", () => {
    const seed = buildAirlineSeed(RAW);
    // LX is curated too, so add an OpenFlights-only code to prove passthrough
    const raw2 = RAW + `\n9,"Qantas","\\N","QF","QFA","C","Australia","Y"`;
    const seed2 = buildAirlineSeed(raw2);
    expect(seed2.some((r) => r.iata === "QF")).toBe(true);
  });

  it("produces no duplicate IATA codes", () => {
    const seed = buildAirlineSeed(RAW);
    const iatas = seed.map((r) => r.iata);
    expect(new Set(iatas).size).toBe(iatas.length);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/data/openflights/__tests__/buildAirlineSeed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seed builder**

Create `backend/src/data/openflights/buildAirlineSeed.ts`:
```typescript
import { AIRLINES } from "../airlines";
import { parseAirlinesDat, dedupeAirlinesByIata } from "./parseOpenFlights";

export interface AirlineSeedRow {
  iata: string;
  icao: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  active: boolean;
}

/**
 * Build the airline seed: OpenFlights (deduped by IATA, active-preferred,
 * blank-IATA dropped) UNIONed with the curated AIRLINES list. Curated rows
 * WIN on a shared IATA — they carry the exact display names TravStats has
 * always shown and guarantee resolver parity for known carriers. Every
 * curated IATA is present in the output.
 */
export function buildAirlineSeed(openflightsRaw: string): AirlineSeedRow[] {
  const openflights = dedupeAirlinesByIata(parseAirlinesDat(openflightsRaw));
  const byIata = new Map<string, AirlineSeedRow>();

  for (const r of openflights) {
    // iata is guaranteed non-null after dedupe
    byIata.set(r.iata as string, {
      iata: r.iata as string,
      icao: r.icao,
      name: r.name,
      callsign: r.callsign,
      country: r.country,
      active: r.active,
    });
  }

  // Curated overrides — name + icao from the curated list; preserve any
  // OpenFlights callsign/country if present, else null.
  for (const a of AIRLINES) {
    const existing = byIata.get(a.iata);
    byIata.set(a.iata, {
      iata: a.iata,
      icao: a.icao ?? existing?.icao ?? null,
      name: a.name,
      callsign: existing?.callsign ?? null,
      country: existing?.country ?? null,
      active: existing?.active ?? true,
    });
  }

  return Array.from(byIata.values());
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/data/openflights/__tests__/buildAirlineSeed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/openflights/buildAirlineSeed.ts backend/src/data/openflights/__tests__/buildAirlineSeed.test.ts
git commit -m "feat(catalogue): airline seed builder (OpenFlights union curated, curated wins)"
```

### Task 6: Aircraft seed builder (OpenFlights ∪ curated, curated wins)

**Files:**
- Create: `backend/src/data/openflights/buildAircraftSeed.ts`
- Test: `backend/src/data/openflights/__tests__/buildAircraftSeed.test.ts`

**Interfaces:**
- Consumes: `parsePlanesDat` (Task 4); `AIRCRAFT_TYPES` from `../aircraftTypes`.
- Produces: `buildAircraftSeed(planesRaw: string): AircraftSeedRow[]` where `AircraftSeedRow = { icao: string; name: string }`. Merged on ICAO; curated wins; rows without a valid 4-char ICAO are dropped.

- [ ] **Step 1: Write the failing test**

Create `backend/src/data/openflights/__tests__/buildAircraftSeed.test.ts`:
```typescript
import { buildAircraftSeed } from "../buildAircraftSeed";
import { AIRCRAFT_TYPES } from "../../aircraftTypes";

const RAW = `"Airbus A320","320","A320"
"ATR 72","AT7","AT72"
"Weird Craft","\\N","\\N"`;

describe("buildAircraftSeed", () => {
  it("keeps the curated name on an ICAO shared with OpenFlights", () => {
    const seed = buildAircraftSeed(RAW);
    const a320 = seed.find((r) => r.icao === "A320");
    expect(a320?.name).toBe("Airbus A320"); // curated name
  });

  it("adds OpenFlights ICAO codes absent from the curated list", () => {
    const seed = buildAircraftSeed(RAW);
    // AT72 is curated already; assert an OF-only code passes through
    const raw2 = RAW + `\n"Boeing 707","703","B703"`;
    const seed2 = buildAircraftSeed(raw2);
    expect(seed2.some((r) => r.icao === "B703")).toBe(true);
  });

  it("drops rows without a 4-char ICAO", () => {
    const seed = buildAircraftSeed(RAW);
    expect(seed.every((r) => /^[A-Z0-9]{4}$/.test(r.icao))).toBe(true);
  });

  it("includes every curated aircraft ICAO", () => {
    const seed = buildAircraftSeed(RAW);
    const seedIcaos = new Set(seed.map((r) => r.icao));
    for (const t of AIRCRAFT_TYPES) expect(seedIcaos.has(t.icao)).toBe(true);
  });

  it("produces no duplicate ICAO codes", () => {
    const seed = buildAircraftSeed(RAW);
    const icaos = seed.map((r) => r.icao);
    expect(new Set(icaos).size).toBe(icaos.length);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/data/openflights/__tests__/buildAircraftSeed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seed builder**

Create `backend/src/data/openflights/buildAircraftSeed.ts`:
```typescript
import { AIRCRAFT_TYPES } from "../aircraftTypes";
import { parsePlanesDat } from "./parseOpenFlights";

export interface AircraftSeedRow {
  icao: string;
  name: string;
}

const ICAO_RE = /^[A-Z0-9]{4}$/;

/**
 * Build the aircraft seed: OpenFlights planes.dat UNIONed with the curated
 * AIRCRAFT_TYPES, merged on ICAO. Curated wins on conflict (it encodes the
 * exact display names the app resolves to). Rows without a valid 4-char ICAO
 * are dropped (they cannot key the unique table).
 */
export function buildAircraftSeed(planesRaw: string): AircraftSeedRow[] {
  const byIcao = new Map<string, AircraftSeedRow>();

  for (const p of parsePlanesDat(planesRaw)) {
    if (!p.icao) continue;
    const icao = p.icao.toUpperCase();
    if (!ICAO_RE.test(icao)) continue;
    if (!byIcao.has(icao)) byIcao.set(icao, { icao, name: p.name });
  }

  for (const t of AIRCRAFT_TYPES) {
    const icao = t.icao.toUpperCase();
    if (!ICAO_RE.test(icao)) continue; // curated already cleaned in Task 2
    byIcao.set(icao, { icao, name: t.name }); // curated wins
  }

  return Array.from(byIcao.values());
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/data/openflights/__tests__/buildAircraftSeed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/openflights/buildAircraftSeed.ts backend/src/data/openflights/__tests__/buildAircraftSeed.test.ts
git commit -m "feat(catalogue): aircraft seed builder (OpenFlights union curated, curated wins)"
```

### Task 7: Airline seeder (DB, bulk ports-pattern)

**Files:**
- Create: `backend/src/seedAirlinesFromData.ts`
- Test: `backend/src/__tests__/seedAirlinesFromData.test.ts`

**Interfaces:**
- Consumes: `buildAirlineSeed` (Task 5), `prisma.airline`.
- Produces: `seedAirlinesFromData(): Promise<number>` — reads `backend/data/openflights/airlines.dat`, bulk-inserts new rows only, returns inserted count.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/seedAirlinesFromData.test.ts` (mirrors `seedPortsFromCSV.test.ts` — wipe in `beforeEach`, re-seed in `afterAll`):
```typescript
import { prisma } from "../db";
import { seedAirlinesFromData } from "../seedAirlinesFromData";

describe("seedAirlinesFromData", () => {
  beforeEach(async () => {
    await prisma.airline.deleteMany({});
  });

  afterAll(async () => {
    await seedAirlinesFromData(); // leave dev DB populated
    await prisma.$disconnect();
  });

  it("inserts a large batch on a fresh table", async () => {
    const count = await seedAirlinesFromData();
    expect(count).toBeGreaterThan(140); // curated 147 + OpenFlights
    const lh = await prisma.airline.findUnique({ where: { iata: "LH" } });
    expect(lh?.name).toBe("Lufthansa");
  });

  it("is idempotent: a second run inserts 0", async () => {
    await seedAirlinesFromData();
    const second = await seedAirlinesFromData();
    expect(second).toBe(0);
  });

  it("never overwrites a user-added row", async () => {
    await prisma.airline.create({
      data: { iata: "LH", name: "My Custom LH", isUserAdded: true },
    });
    await seedAirlinesFromData();
    const lh = await prisma.airline.findUnique({ where: { iata: "LH" } });
    expect(lh?.name).toBe("My Custom LH");
    expect(lh?.isUserAdded).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/__tests__/seedAirlinesFromData.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seeder** (ports bulk pattern — one `findMany` of existing IATAs, filter, one `createMany({ skipDuplicates: true })`)

Create `backend/src/seedAirlinesFromData.ts`:
```typescript
import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { buildAirlineSeed } from "./data/openflights/buildAirlineSeed";
import logger from "./utils/logger";

const DATA_PATH = path.resolve(__dirname, "..", "data", "openflights", "airlines.dat");

/**
 * Idempotent airline seeder. Bulk pattern (copied from seedPortsFromCSV):
 * one query loads existing IATAs, one query inserts the new ones. Seeded
 * rows are isUserAdded:false; admin isUserAdded:true rows are matched by the
 * unique IATA and never overwritten.
 */
export async function seedAirlinesFromData(): Promise<number> {
  if (!fs.existsSync(DATA_PATH)) {
    logger.warn({ operation: "seed_airlines_skip", reason: "data_missing", path: DATA_PATH });
    return 0;
  }

  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const seed = buildAirlineSeed(raw);

  const existing = await prisma.airline.findMany({ select: { iata: true } });
  const existingIatas = new Set(
    existing.map((a) => a.iata).filter((i): i is string => Boolean(i)),
  );

  const toInsert = seed
    .filter((r) => !existingIatas.has(r.iata))
    .map((r) => ({
      iata: r.iata,
      icao: r.icao,
      name: r.name,
      callsign: r.callsign,
      country: r.country,
      active: r.active,
      isUserAdded: false,
    }));

  if (toInsert.length === 0) {
    logger.info({ operation: "seed_airlines_done", inserted: 0, total: seed.length });
    return 0;
  }

  const result = await prisma.airline.createMany({ data: toInsert, skipDuplicates: true });
  logger.info({
    operation: "seed_airlines_done",
    inserted: result.count,
    skipped: seed.length - result.count,
    total: seed.length,
  });
  return result.count;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/__tests__/seedAirlinesFromData.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedAirlinesFromData.ts backend/src/__tests__/seedAirlinesFromData.test.ts
git commit -m "feat(catalogue): idempotent airline DB seeder (bulk ports pattern)"
```

### Task 8: Aircraft seeder (DB, bulk pattern)

**Files:**
- Create: `backend/src/seedAircraftFromData.ts`
- Test: `backend/src/__tests__/seedAircraftFromData.test.ts`

**Interfaces:**
- Consumes: `buildAircraftSeed` (Task 6), `prisma.aircraft`.
- Produces: `seedAircraftFromData(): Promise<number>` — reads `backend/data/openflights/planes.dat`, bulk-inserts new rows, returns count.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/seedAircraftFromData.test.ts` (same shape as Task 7's test, keyed on `icao`, asserting `AT72` → "ATR 72-600" curated name survives, idempotent 2nd run = 0, isUserAdded row survives). Use `prisma.aircraft` and `findUnique({ where: { icao: "AT72" } })`.

```typescript
import { prisma } from "../db";
import { seedAircraftFromData } from "../seedAircraftFromData";

describe("seedAircraftFromData", () => {
  beforeEach(async () => { await prisma.aircraft.deleteMany({}); });
  afterAll(async () => { await seedAircraftFromData(); await prisma.$disconnect(); });

  it("inserts a batch and keeps curated names", async () => {
    const count = await seedAircraftFromData();
    expect(count).toBeGreaterThan(100);
    const at72 = await prisma.aircraft.findUnique({ where: { icao: "AT72" } });
    expect(at72?.name).toBe("ATR 72-600");
  });

  it("is idempotent: second run inserts 0", async () => {
    await seedAircraftFromData();
    expect(await seedAircraftFromData()).toBe(0);
  });

  it("never overwrites a user-added row", async () => {
    await prisma.aircraft.create({ data: { icao: "AT72", name: "Custom", isUserAdded: true } });
    await seedAircraftFromData();
    const row = await prisma.aircraft.findUnique({ where: { icao: "AT72" } });
    expect(row?.name).toBe("Custom");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/__tests__/seedAircraftFromData.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seeder**

Create `backend/src/seedAircraftFromData.ts` (identical structure to Task 7 but for aircraft, path `planes.dat`, key `icao`):
```typescript
import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { buildAircraftSeed } from "./data/openflights/buildAircraftSeed";
import logger from "./utils/logger";

const DATA_PATH = path.resolve(__dirname, "..", "data", "openflights", "planes.dat");

export async function seedAircraftFromData(): Promise<number> {
  if (!fs.existsSync(DATA_PATH)) {
    logger.warn({ operation: "seed_aircraft_skip", reason: "data_missing", path: DATA_PATH });
    return 0;
  }

  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const seed = buildAircraftSeed(raw);

  const existing = await prisma.aircraft.findMany({ select: { icao: true } });
  const existingIcaos = new Set(
    existing.map((a) => a.icao).filter((i): i is string => Boolean(i)),
  );

  const toInsert = seed
    .filter((r) => !existingIcaos.has(r.icao))
    .map((r) => ({ icao: r.icao, name: r.name, isUserAdded: false }));

  if (toInsert.length === 0) {
    logger.info({ operation: "seed_aircraft_done", inserted: 0, total: seed.length });
    return 0;
  }

  const result = await prisma.aircraft.createMany({ data: toInsert, skipDuplicates: true });
  logger.info({ operation: "seed_aircraft_done", inserted: result.count, total: seed.length });
  return result.count;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/__tests__/seedAircraftFromData.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedAircraftFromData.ts backend/src/__tests__/seedAircraftFromData.test.ts
git commit -m "feat(catalogue): idempotent aircraft DB seeder"
```

### Task 9: Wire both seeders into boot

**Files:**
- Modify: `backend/src/index.ts` (imports near the other seed imports; call site ~line 346, after `seedShipsFromCSV`)

- [ ] **Step 1: Add imports**

At the top of `backend/src/index.ts`, alongside the existing `seedPortsFromCSV` / `seedShipsFromCSV` imports, add:
```typescript
import { seedAirlinesFromData } from "./seedAirlinesFromData";
import { seedAircraftFromData } from "./seedAircraftFromData";
```
(Match the existing import style in that file.)

- [ ] **Step 2: Add the boot calls**

After the `seedShipsFromCSV()` try/catch block (~line 373), add two matching blocks:
```typescript
    try {
      await seedAirlinesFromData();
      logger.info({ operation: 'server_start_seed_airlines', message: 'Airlines seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_airlines_error',
        message: 'Failed to seed airlines',
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }

    try {
      await seedAircraftFromData();
      logger.info({ operation: 'server_start_seed_aircraft', message: 'Aircraft seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_aircraft_error',
        message: 'Failed to seed aircraft',
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
```

- [ ] **Step 3: Verify boot seeds the tables**

Run (from a clean dev backend start, or a one-off):
```bash
cd backend && npx tsc --noEmit
```
Expected: PASS. Then start the dev backend once and confirm the log lines `server_start_seed_airlines` / `server_start_seed_aircraft` appear and `SELECT count(*)` on both tables is non-zero (via the admin route in Phase 5, or a quick Prisma script).

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(catalogue): seed airlines + aircraft at boot"
```

---

## Phase 3 — DB-backed resolver cache

### Task 10: Airline catalogue cache

**Files:**
- Create: `backend/src/services/airlineCatalogCache.ts`
- Test: `backend/src/services/__tests__/airlineCatalogCache.test.ts`

**Interfaces:**
- Produces:
  - `getAirlineCatalog(): Promise<CachedAirline[]>` where `CachedAirline = { iata: string; icao: string | null; name: string }` — cached; loads from `prisma.airline` on first call / after invalidation.
  - `invalidateAirlineCatalogCache(): void`
  - `getAirlineCatalogSync(): CachedAirline[]` — returns the last-loaded snapshot (empty array until first preload).
  - `preloadAirlineCatalog(): Promise<void>` — force a load (called at boot).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/airlineCatalogCache.test.ts`:
```typescript
import { prisma } from "../../db";
import {
  getAirlineCatalog,
  invalidateAirlineCatalogCache,
  getAirlineCatalogSync,
  preloadAirlineCatalog,
} from "../airlineCatalogCache";

describe("airlineCatalogCache", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("loads airlines from the DB and caches them", async () => {
    const first = await getAirlineCatalog();
    expect(first.length).toBeGreaterThan(140);
    expect(first.find((a) => a.iata === "LH")?.name).toBe("Lufthansa");
  });

  it("exposes a sync snapshot after preload", async () => {
    invalidateAirlineCatalogCache();
    expect(getAirlineCatalogSync()).toEqual([]);
    await preloadAirlineCatalog();
    expect(getAirlineCatalogSync().length).toBeGreaterThan(140);
  });

  it("reloads after invalidation", async () => {
    await preloadAirlineCatalog();
    const before = getAirlineCatalogSync().length;
    await prisma.airline.create({ data: { iata: "ZZ", name: "Test Air", isUserAdded: true } });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    expect(getAirlineCatalogSync().length).toBe(before + 1);
    await prisma.airline.delete({ where: { iata: "ZZ" } });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/services/__tests__/airlineCatalogCache.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cache** (mirrors `cruiseEntityResolver`'s module-scope cache + invalidate idiom)

Create `backend/src/services/airlineCatalogCache.ts`:
```typescript
import { prisma } from "../db";

export interface CachedAirline {
  iata: string;
  icao: string | null;
  name: string;
}

// Module-scope cache. The airlines table is populated at boot and mutated only
// via /airlines POST + the admin reseed (rare, manual), so a version-nulling
// cache with no TTL is correct — stale entries can't drift on their own.
// Single-container prod only; add a TTL/version check if multi-container.
let cache: CachedAirline[] | null = null;

async function load(): Promise<CachedAirline[]> {
  const rows = await prisma.airline.findMany({
    where: { iata: { not: null } },
    select: { iata: true, icao: true, name: true },
  });
  return rows
    .filter((r): r is { iata: string; icao: string | null; name: string } => r.iata !== null)
    .map((r) => ({ iata: r.iata, icao: r.icao, name: r.name }));
}

export async function getAirlineCatalog(): Promise<CachedAirline[]> {
  if (cache === null) cache = await load();
  return cache;
}

export async function preloadAirlineCatalog(): Promise<void> {
  cache = await load();
}

export function getAirlineCatalogSync(): CachedAirline[] {
  return cache ?? [];
}

export function invalidateAirlineCatalogCache(): void {
  cache = null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/services/__tests__/airlineCatalogCache.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/airlineCatalogCache.ts backend/src/services/__tests__/airlineCatalogCache.test.ts
git commit -m "feat(catalogue): DB-backed airline catalogue cache"
```

### Task 11: Aircraft catalogue cache

**Files:**
- Create: `backend/src/services/aircraftCatalogCache.ts`
- Test: `backend/src/services/__tests__/aircraftCatalogCache.test.ts`

**Interfaces:**
- Produces (same shape as Task 10, keyed on icao): `getAircraftCatalogSync(): CachedAircraft[]` (`{ icao: string; name: string }`), `preloadAircraftCatalog()`, `invalidateAircraftCatalogCache()`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/aircraftCatalogCache.test.ts` — same structure as Task 10 but keyed on `icao`, asserting `AT72` → "ATR 72-600" is present after preload, and reload-after-invalidation works.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/services/__tests__/aircraftCatalogCache.test.ts --forceExit`
Expected: FAIL.

- [ ] **Step 3: Implement** — copy Task 10's file, replace `airline`→`aircraft`, drop the `icao`-null filter to a plain `icao: { not: null }`, shape `{ icao, name }`.

```typescript
import { prisma } from "../db";

export interface CachedAircraft { icao: string; name: string; }

let cache: CachedAircraft[] | null = null;

async function load(): Promise<CachedAircraft[]> {
  const rows = await prisma.aircraft.findMany({
    where: { icao: { not: null } },
    select: { icao: true, name: true },
  });
  return rows
    .filter((r): r is { icao: string; name: string } => r.icao !== null)
    .map((r) => ({ icao: r.icao, name: r.name }));
}

export async function preloadAircraftCatalog(): Promise<void> { cache = await load(); }
export function getAircraftCatalogSync(): CachedAircraft[] { return cache ?? []; }
export function invalidateAircraftCatalogCache(): void { cache = null; }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/services/__tests__/aircraftCatalogCache.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/aircraftCatalogCache.ts backend/src/services/__tests__/aircraftCatalogCache.test.ts
git commit -m "feat(catalogue): DB-backed aircraft catalogue cache"
```

### Task 12: Rewire `airlineNormalize.ts` to the cache (parity-guarded)

**Files:**
- Modify: `backend/src/utils/airlineNormalize.ts`
- Test: `backend/src/utils/__tests__/airlineNormalize.parity.test.ts` (create)

**Interfaces:**
- Consumes: `getAirlineCatalogSync`, `preloadAirlineCatalog` (Task 10).
- Produces: unchanged public signatures — `normalizeAirline(name): string`, `resolveAirlineCodes(name): { iata; icao?; name } | null`, `mergeAirlineCounts(...)`. Lookup maps are now rebuilt from the cache snapshot on each call's map-getter (cheap) instead of module-load from `AIRLINES`. The `AIRLINE_ALIASES` and `NAME_TO_IATA` alias tables stay exactly as they are.

- [ ] **Step 1: Write the failing parity test**

Create `backend/src/utils/__tests__/airlineNormalize.parity.test.ts`:
```typescript
import { AIRLINES } from "../../data/airlines";
import { preloadAirlineCatalog } from "../../services/airlineCatalogCache";
import { resolveAirlineCodes } from "../airlineNormalize";
import { prisma } from "../../db";

// Proves the DB-backed resolver returns the SAME iata for every curated
// carrier as the retired static list did — no resolution regression.
describe("airlineNormalize DB parity", () => {
  beforeAll(async () => { await preloadAirlineCatalog(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("resolves every curated IATA code to itself", () => {
    for (const a of AIRLINES) {
      expect(resolveAirlineCodes(a.iata)?.iata).toBe(a.iata);
    }
  });

  it("resolves every curated name to its curated IATA", () => {
    for (const a of AIRLINES) {
      expect(resolveAirlineCodes(a.name)?.iata).toBe(a.iata);
    }
  });

  it("still honours a NAME_TO_IATA alias", () => {
    expect(resolveAirlineCodes("alitalia")?.iata).toBe("AZ");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/utils/__tests__/airlineNormalize.parity.test.ts --forceExit`
Expected: FAIL — the resolver still reads the static `AIRLINES` (this test passes trivially now, so to see RED first, temporarily assert `resolveAirlineCodes` reads the cache: skip this and go to Step 3, then confirm GREEN — this is a refactor guarded by parity, the test's value is preventing regression during Step 3).

> Note: this is a refactor task; the test encodes the invariant that must hold AFTER the change. Write it, watch it pass on the old code, then keep it green through the rewrite.

- [ ] **Step 3: Rewrite the lookup maps to read the cache**

In `backend/src/utils/airlineNormalize.ts`:
- Remove `import { AIRLINES, type Airline } from '../data/airlines';`.
- Add `import { getAirlineCatalogSync, type CachedAirline } from '../services/airlineCatalogCache';`.
- Replace the three module-load `Map`s (`NAME_LOOKUP`, `IATA_LOOKUP`, `ICAO_LOOKUP`, lines 71–84) with lazily-built getters over the cache snapshot:
```typescript
function buildLookups(catalog: CachedAirline[]) {
  const byName = new Map<string, CachedAirline>();
  const byIata = new Map<string, CachedAirline>();
  const byIcao = new Map<string, CachedAirline>();
  for (const a of catalog) {
    byName.set(a.name.toLowerCase(), a);
    byIata.set(a.iata.toUpperCase(), a);
    if (a.icao) byIcao.set(a.icao.toUpperCase(), a);
  }
  return { byName, byIata, byIcao };
}
```
- In `resolveAirlineCodes`, replace references to `IATA_LOOKUP`/`ICAO_LOOKUP`/`NAME_LOOKUP` with `const { byIata, byIcao, byName } = buildLookups(getAirlineCatalogSync());` at the top of the function. The `NAME_TO_IATA` alias branch (step 4) then does `byIata.get(aliasIata)`. Return shape stays `{ iata, icao: hit.icao ?? undefined, name: hit.name }` (map `null` icao → `undefined` to keep the public type `{ iata; icao?; name }`).
- Keep `AIRLINE_ALIASES` and `NAME_TO_IATA` unchanged.
- `normalizeAirline` and `mergeAirlineCounts` need no change (they use `AIRLINE_ALIASES`).

> Because the maps are now built from a possibly-empty sync snapshot, ensure `preloadAirlineCatalog()` runs at boot before the first flight write — added in Task 14.

- [ ] **Step 4: Run the parity test + the existing airlineNormalize tests**

Run: `cd backend && npx jest airlineNormalize --forceExit`
Expected: PASS (parity + any existing `airlineNormalize` tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/airlineNormalize.ts backend/src/utils/__tests__/airlineNormalize.parity.test.ts
git commit -m "refactor(catalogue): resolve airline codes from the DB cache (parity-guarded)"
```

### Task 13: Rewire `aircraftNormalize.ts` to the cache

**Files:**
- Modify: `backend/src/utils/aircraftNormalize.ts`
- Test: `backend/src/utils/__tests__/aircraftNormalize.parity.test.ts` (create)

**Interfaces:**
- Consumes: `getAircraftCatalogSync`, `preloadAircraftCatalog` (Task 11).
- Produces: unchanged `normalizeAircraft(input): string`. The `ALIASES` table stays; only the `byIcao` map (built from `AIRCRAFT_TYPES` at module load) moves to the cache snapshot; the "already canonical name" scan iterates the cache snapshot instead of `AIRCRAFT_TYPES`.

- [ ] **Step 1: Write the parity test**

Create `backend/src/utils/__tests__/aircraftNormalize.parity.test.ts`:
```typescript
import { AIRCRAFT_TYPES } from "../../data/aircraftTypes";
import { preloadAircraftCatalog } from "../../services/aircraftCatalogCache";
import { normalizeAircraft } from "../aircraftNormalize";
import { prisma } from "../../db";

describe("aircraftNormalize DB parity", () => {
  beforeAll(async () => { await preloadAircraftCatalog(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("resolves every curated ICAO to its curated name", () => {
    for (const t of AIRCRAFT_TYPES) {
      expect(normalizeAircraft(t.icao)).toBe(t.name);
    }
  });

  it("still honours an alias", () => {
    expect(normalizeAircraft("atr72")).toBe("ATR 72-600");
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx jest src/utils/__tests__/aircraftNormalize.parity.test.ts --forceExit`
Expected: PASS on old code (refactor-guard; keep green through Step 3).

- [ ] **Step 3: Rewrite to use the cache**

In `backend/src/utils/aircraftNormalize.ts`:
- Remove `import { AIRCRAFT_TYPES } from '../data/aircraftTypes';`.
- Add `import { getAircraftCatalogSync } from '../services/aircraftCatalogCache';`.
- Replace the module-load `byIcao` build loop with a per-call build inside `normalizeAircraft`:
```typescript
export function normalizeAircraft(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();

  const aliased = byAlias.get(lower);
  if (aliased) return aliased;

  const catalog = getAircraftCatalogSync();
  const upper = trimmed.toUpperCase();
  for (const t of catalog) {
    if (t.icao.toUpperCase() === upper) return t.name;
  }
  for (const t of catalog) {
    if (t.name.toLowerCase() === lower) return t.name;
  }
  return trimmed;
}
```
- Keep `byAlias` (built from the unchanged `ALIASES` table). Remove the now-unused `byIcao` module map.

- [ ] **Step 4: Run the parity test**

Run: `cd backend && npx jest aircraftNormalize --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/aircraftNormalize.ts backend/src/utils/__tests__/aircraftNormalize.parity.test.ts
git commit -m "refactor(catalogue): normalize aircraft from the DB cache"
```

### Task 14: Preload both caches at boot

**Files:**
- Modify: `backend/src/index.ts` (after the seed blocks from Task 9, before the aircraft-normalize backfill loop)

- [ ] **Step 1: Add preload calls**

After the `seedAircraftFromData` try/catch (Task 9), add:
```typescript
    try {
      const { preloadAirlineCatalog } = await import("./services/airlineCatalogCache");
      const { preloadAircraftCatalog } = await import("./services/aircraftCatalogCache");
      await preloadAirlineCatalog();
      await preloadAircraftCatalog();
      logger.info({ operation: 'server_start_catalog_preload', message: 'Airline+aircraft caches preloaded' });
    } catch (error) {
      logger.warn({ operation: 'server_start_catalog_preload_error', message: 'Failed to preload catalogues', error });
    }
```
This must run BEFORE the existing aircraft-normalize loop (index.ts:375-383) so that loop uses the DB-backed normalizer.

- [ ] **Step 2: Verify**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(catalogue): preload catalogue caches at boot"
```

---

## Phase 4 — Backfill

### Task 15: Backfill airline codes on stored flights

**Files:**
- Create: `backend/src/scripts/backfillAirlineCodes.ts`
- Test: `backend/src/scripts/__tests__/backfillAirlineCodes.test.ts`
- Modify: `backend/src/index.ts` (run once at boot, after cache preload)

**Interfaces:**
- Consumes: `resolveAirlineCodes` (Task 12), `getAirlineCatalogSync`.
- Produces: `backfillAirlineCodes(): Promise<number>` — for flights with an `airline` name but missing `airlineIata`, resolve and fill `airlineIata`/`airlineIcao`; returns updated count; idempotent.

- [ ] **Step 1: Write the failing test**

Create `backend/src/scripts/__tests__/backfillAirlineCodes.test.ts`:
```typescript
import { prisma } from "../../db";
import { preloadAirlineCatalog } from "../../services/airlineCatalogCache";
import { backfillAirlineCodes } from "../backfillAirlineCodes";

describe("backfillAirlineCodes", () => {
  let userId: string;
  beforeAll(async () => {
    await preloadAirlineCatalog();
    const u = await prisma.user.create({
      data: { username: `bf_${Date.now()}`, passwordHash: "x", role: "user" },
    });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("fills iata/icao from a resolvable name and is idempotent", async () => {
    const f = await prisma.flight.create({
      data: {
        userId, airline: "Lufthansa", airlineIata: null, airlineIcao: null,
        depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, // minimal required fields
        date: new Date("2024-01-01"),
      },
    });
    const n1 = await backfillAirlineCodes();
    expect(n1).toBeGreaterThanOrEqual(1);
    const after = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after?.airlineIata).toBe("LH");
    // second run is a no-op for this row
    const n2 = await backfillAirlineCodes();
    const after2 = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after2?.airlineIata).toBe("LH");
    expect(n2).toBeLessThan(n1 + 1); // did not re-touch the filled row
  });

  it("never overwrites an existing structured code", async () => {
    const f = await prisma.flight.create({
      data: {
        userId, airline: "Lufthansa", airlineIata: "XX", airlineIcao: null,
        depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, date: new Date("2024-01-02"),
      },
    });
    await backfillAirlineCodes();
    const after = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after?.airlineIata).toBe("XX");
  });
});
```
> Verify the exact required non-null `Flight` fields against `schema.prisma` before finalizing the test data (dep/arr lat/lon are required floats; add any other non-null columns).

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/scripts/__tests__/backfillAirlineCodes.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the backfill**

Create `backend/src/scripts/backfillAirlineCodes.ts`:
```typescript
import { prisma } from "../db";
import { resolveAirlineCodes } from "../utils/airlineNormalize";
import logger from "../utils/logger";

/**
 * One-shot, idempotent backfill: for flights that have a free-text `airline`
 * name but no structured `airlineIata`, resolve the codes from the catalogue
 * and fill them. Never overwrites an existing airlineIata. Safe to re-run.
 */
export async function backfillAirlineCodes(): Promise<number> {
  const flights = await prisma.flight.findMany({
    where: { airline: { not: null }, airlineIata: null },
    select: { id: true, airline: true },
  });

  let updated = 0;
  for (const f of flights) {
    if (!f.airline) continue;
    const resolved = resolveAirlineCodes(f.airline);
    if (!resolved) continue;
    await prisma.flight.update({
      where: { id: f.id },
      data: { airlineIata: resolved.iata, airlineIcao: resolved.icao ?? null },
    });
    updated++;
  }

  if (updated > 0) {
    logger.info({ operation: "backfill_airline_codes_done", updated, scanned: flights.length });
  }
  return updated;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx jest src/scripts/__tests__/backfillAirlineCodes.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Wire into boot**

In `backend/src/index.ts`, after the cache-preload block (Task 14), add:
```typescript
    try {
      const { backfillAirlineCodes } = await import("./scripts/backfillAirlineCodes");
      const n = await backfillAirlineCodes();
      if (n > 0) logger.info({ operation: 'server_start_backfill_airline_codes', message: `Backfilled ${n} flights` });
    } catch (error) {
      logger.warn({ operation: 'server_start_backfill_airline_codes_error', message: 'Failed to backfill airline codes', error });
    }
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/backfillAirlineCodes.ts backend/src/scripts/__tests__/backfillAirlineCodes.test.ts backend/src/index.ts
git commit -m "feat(catalogue): backfill airline codes on stored flights at boot"
```

---

## Phase 5 — Routes

### Task 16: `/api/v1/airlines` route

**Files:**
- Create: `backend/src/routes/airlines.ts`
- Modify: `backend/src/index.ts` (mount ~line 254 near `/ships` `/ports`)
- Test: `backend/src/routes/__tests__/airlines.route.test.ts`

**Interfaces:**
- Consumes: `prisma.airline`, `invalidateAirlineCatalogCache` + `preloadAirlineCatalog` (Task 10).
- Produces: `GET /api/v1/airlines?q=&limit=` (list/search) and `POST /api/v1/airlines` (create, `isUserAdded:true`, invalidates+preloads cache). Guard: `authenticate` + `requireWriteScope`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/airlines.route.test.ts` — use the project's existing route-test harness (supertest + a test auth token; copy the setup from `backend/src/routes/__tests__/*.test.ts` that already exercises an authenticated route). Assert:
```
GET /api/v1/airlines?q=luft  → 200, data contains { iata: "LH", name: "Lufthansa" }
POST /api/v1/airlines { iata:"Q2", name:"Test Air" } → 201, isUserAdded true
  → GET ?q=test now returns it
POST with missing name → 400
```
(Model the file on an existing authenticated route test; reuse its `beforeAll` login/token helper.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest src/routes/__tests__/airlines.route.test.ts --forceExit`
Expected: FAIL — route not mounted.

- [ ] **Step 3: Implement the route** (mirror `ports.ts` structure, ILIKE search on name/iata/icao, no raw-SQL unaccent needed)

Create `backend/src/routes/airlines.ts`:
```typescript
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  invalidateAirlineCatalogCache,
  preloadAirlineCatalog,
} from "../services/airlineCatalogCache";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createAirlineSchema = z.object({
  iata: z.string().min(2).max(3).optional(),
  icao: z.string().min(3).max(4).optional(),
  name: z.string().min(1).max(120),
  callsign: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q, limit } = parsed.data;

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { iata: { equals: q.toUpperCase() } },
            { icao: { equals: q.toUpperCase() } },
          ],
        }
      : {};

    const airlines = await prisma.airline.findMany({
      where,
      take: limit,
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: airlines });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createAirlineSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const airline = await prisma.airline.create({
      data: {
        ...parsed.data,
        iata: parsed.data.iata?.toUpperCase() ?? null,
        icao: parsed.data.icao?.toUpperCase() ?? null,
        isUserAdded: true,
      },
    });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    logger.info({ operation: "airline_create", airlineId: airline.id, userId: req.userId });
    res.status(201).json({ success: true, data: airline });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Mount the route**

In `backend/src/index.ts`, near the `/ships` `/ports` mounts (~line 254):
```typescript
import airlinesRouter from "./routes/airlines";
// ...
app.use("/api/v1/airlines", airlinesRouter);
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd backend && npx jest src/routes/__tests__/airlines.route.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/airlines.ts backend/src/index.ts backend/src/routes/__tests__/airlines.route.test.ts
git commit -m "feat(catalogue): /api/v1/airlines list + create route"
```

### Task 17: `/api/v1/aircraft` route

**Files:**
- Create: `backend/src/routes/aircraft.ts`
- Modify: `backend/src/index.ts` (mount)
- Test: `backend/src/routes/__tests__/aircraft.route.test.ts`

**Interfaces:**
- Same shape as Task 16 keyed on `icao`. `POST` invalidates+preloads the aircraft cache.

- [ ] **Step 1: Write the failing test** — same shape as Task 16: `GET ?q=a320` returns `{ icao:"A320", name:"Airbus A320" }`; `POST { icao:"TEST", name:"Test Craft" }` → 201 `isUserAdded`; missing name → 400.

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** — copy Task 16's file, replace `airline`→`aircraft`, cache imports → `aircraftCatalogCache`, create schema `{ icao: z.string().min(3).max(4).optional(), name: z.string().min(1).max(120) }`, search `OR: [{ name contains }, { icao equals uppercased }]`.

- [ ] **Step 4: Mount** `app.use("/api/v1/aircraft", aircraftRouter);` in index.ts.

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/aircraft.ts backend/src/index.ts backend/src/routes/__tests__/aircraft.route.test.ts
git commit -m "feat(catalogue): /api/v1/aircraft list + create route"
```

### Task 18: Admin reseed routes for airlines + aircraft

**Files:**
- Modify: `backend/src/routes/admin/system.ts` (add reseed + status endpoints near the `/airports/reseed` block ~line 88)
- Test: `backend/src/routes/admin/__tests__/catalogueReseed.test.ts`

**Interfaces:**
- Consumes: `seedAirlinesFromData` (Task 7), `seedAircraftFromData` (Task 8), the two cache invalidators, `adminReseedLimiter`.
- Produces: `POST /admin/airlines/reseed`, `POST /admin/aircraft/reseed` (both invalidate+preload the matching cache, return inserted count).

- [ ] **Step 1: Write the failing test** — authenticated-admin POST to `/api/v1/admin/airlines/reseed` returns `{ inserted: <number> }` (0 on an already-seeded dev DB) and 202/200. Copy the admin-auth setup from `backend/src/routes/admin/__tests__/airlineLogoRefresh.test.ts`.

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** — in `system.ts`, after the airports reseed block:
```typescript
router.post('/airlines/reseed', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { seedAirlinesFromData } = await import('../../seedAirlinesFromData');
    const { invalidateAirlineCatalogCache, preloadAirlineCatalog } = await import('../../services/airlineCatalogCache');
    const inserted = await seedAirlinesFromData();
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    logger.info({ operation: 'admin_airline_reseed', context: { inserted, triggeredBy: req.userId } });
    res.json({ inserted });
  } catch (error) {
    next(error);
  }
});

router.post('/aircraft/reseed', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { seedAircraftFromData } = await import('../../seedAircraftFromData');
    const { invalidateAircraftCatalogCache, preloadAircraftCatalog } = await import('../../services/aircraftCatalogCache');
    const inserted = await seedAircraftFromData();
    invalidateAircraftCatalogCache();
    await preloadAircraftCatalog();
    logger.info({ operation: 'admin_aircraft_reseed', context: { inserted, triggeredBy: req.userId } });
    res.json({ inserted });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/system.ts backend/src/routes/admin/__tests__/catalogueReseed.test.ts
git commit -m "feat(catalogue): admin reseed routes for airlines + aircraft"
```

### Task 19: Convert `suggestions.ts` to DB-backed, searchable

**Files:**
- Modify: `backend/src/routes/suggestions.ts`
- Test: `backend/src/routes/__tests__/suggestions.catalogue.test.ts`

**Interfaces:**
- Consumes: `prisma.airline`, `prisma.aircraft`, `normalizeAircraft`.
- Produces: `GET /suggestions/airlines?q=` and `/suggestions/aircraft?q=` — DB-backed, capped, merged with the user's own flight values. Never dumps all 6k names.

- [ ] **Step 1: Write the failing test** — `GET /suggestions/airlines?q=luft` returns suggestions including "Lufthansa" and the result length is ≤ a cap (e.g. 50). Reuse an authenticated-user test setup.

- [ ] **Step 2: Run it** → FAIL (current code imports the static list, returns all names).

- [ ] **Step 3: Rewrite** the two handlers:
- Remove `import { AIRLINES } from '../data/airlines';` and `import { AIRCRAFT_TYPES } from '../data/aircraftTypes';`.
- Airlines handler: read an optional `q` (Zod, max 100). Query `prisma.airline.findMany({ where: q ? { name: { contains: q, mode: "insensitive" } } : {}, take: 50, orderBy: { name: "asc" }, select: { name: true } })`. Merge with the user's distinct flight airlines (existing query) filtered by `q` (client-side `includes` case-insensitive), dedupe, cap 50, sort.
- Aircraft handler: same against `prisma.aircraft`, keep `normalizeAircraft` on the user rows.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/suggestions.ts backend/src/routes/__tests__/suggestions.catalogue.test.ts
git commit -m "refactor(catalogue): DB-backed searchable airline/aircraft suggestions"
```

---

## Phase 6 — Frontend catalogue retirement & regen

### Task 20: Regenerate the frontend catalogue from the DB

**Files:**
- Modify: `backend/scripts/generate-airline-catalog.ts`
- Regenerate: `frontend/src/lib/generated/airlineCatalog.ts`
- Modify: `backend/src/__tests__/dataIntegrity.airlineCatalog.test.ts`

**Interfaces:**
- Produces: `generateAirlineCatalogContents(airlines: {iata; icao?; name}[]): string` (unchanged signature) sourced from the DB seed instead of the static `AIRLINES`.

- [ ] **Step 1: Repoint the generator to the seed builder**

In `backend/scripts/generate-airline-catalog.ts`:
- Replace `import { AIRLINES, type Airline } from '../src/data/airlines';` with a load from the DB seed builder:
```typescript
import fs from "fs";
import path from "path";
import { buildAirlineSeed } from "../src/data/openflights/buildAirlineSeed";

function loadSeed() {
  const raw = fs.readFileSync(
    path.join(__dirname, "../data/openflights/airlines.dat"), "utf-8",
  );
  return buildAirlineSeed(raw).map((r) => ({ iata: r.iata, icao: r.icao ?? undefined, name: r.name }));
}
```
- In `main()`, `const airlines = loadSeed();` and pass to `generateAirlineCatalogContents(airlines)`. Keep the emitted `AirlineCatalogEntry` shape identical.
- Update the file header comment: source is now `backend/data/openflights/airlines.dat` (via `buildAirlineSeed`), not `airlines.ts`.

- [ ] **Step 2: Regenerate**

Run:
```bash
cd backend && npx tsx scripts/generate-airline-catalog.ts
wc -l ../frontend/src/lib/generated/airlineCatalog.ts
```
Expected: writes ~6000 entries.

- [ ] **Step 3: Update the drift-guard test**

In `backend/src/__tests__/dataIntegrity.airlineCatalog.test.ts`: change the "source of truth" from `AIRLINES` to `buildAirlineSeed(fs.readFileSync(airlines.dat))`, asserting the generated file content equals `generateAirlineCatalogContents(loadedSeed)` (the generated mirror matches the seed builder output). Keep it as a regeneration-freshness guard.

- [ ] **Step 4: Run the drift-guard test**

Run: `cd backend && npx jest dataIntegrity.airlineCatalog --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/generate-airline-catalog.ts frontend/src/lib/generated/airlineCatalog.ts backend/src/__tests__/dataIntegrity.airlineCatalog.test.ts
git commit -m "feat(catalogue): regenerate frontend airline catalogue from the DB seed (~6k)"
```

### Task 21: Retire the `constants.ts` AIRLINES list

**Files:**
- Modify: `frontend/src/lib/constants.ts` (~line 88 `AIRLINES`)
- Modify: `frontend/src/components/Filters.tsx:393,415,418`

- [ ] **Step 1: Inspect current usage**

Read `frontend/src/lib/constants.ts` around `AIRLINES` and `Filters.tsx:390-420` to see the exact shape consumed (likely `{ code, name }` for a dropdown).

- [ ] **Step 2: Derive from the generated catalogue**

Replace the hand-typed `AIRLINES` array in `constants.ts` with a derivation from `AIRLINE_CATALOG`:
```typescript
import { AIRLINE_CATALOG } from "./generated/airlineCatalog";

export const AIRLINES = AIRLINE_CATALOG.map((a) => ({ code: a.iata, name: a.name }));
```
Match the exact property names `Filters.tsx` expects (adjust the map to `{ iata, name }` or `{ code, name }` per what the component reads). Update `Filters.tsx` only if the property names change.

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run src/lib`
Expected: PASS. Manually confirm the Filters airline dropdown still renders.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/constants.ts frontend/src/components/Filters.tsx
git commit -m "refactor(catalogue): derive Filters airline list from the generated catalogue"
```

### Task 22: Retire the `bcbpHelpers.ts` airline map

**Files:**
- Modify: `frontend/src/lib/airline-parsers/bcbpHelpers.ts:127`

- [ ] **Step 1: Inspect**

Read `bcbpHelpers.ts` around line 127 to see the hardcoded map's shape and how it's used (boarding-pass IATA → name resolution).

- [ ] **Step 2: Replace with the shared resolver**

Swap the local map for `resolveAirlineDisplay` / the `AIRLINE_CATALOG`-derived maps from `frontend/src/lib/airlineUtils.ts` (or `resolveAirlineIata`), whichever matches the call. If a raw `Record<string,string>` is needed, build it from `AIRLINE_CATALOG` at module load. Do NOT keep a second hand-typed table.

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run src/lib/airline-parsers`
Expected: PASS (existing bcbp tests still green).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/airline-parsers/bcbpHelpers.ts
git commit -m "refactor(catalogue): resolve BCBP airline names from the shared catalogue"
```

### Task 23: Reframe `backend/src/data/airlines.ts` as curated-override input (NO deletion)

**Files:**
- Modify: `backend/src/data/airlines.ts` (header comment only)
- Verify: no runtime resolver still imports it (only `buildAirlineSeed` may).

- [ ] **Step 1: Find remaining importers**

Run: `cd backend && grep -rn "data/airlines" src scripts | grep -v node_modules`
Expected: after Tasks 12, 19, 20 only `buildAirlineSeed.ts` should import it (curated union source). That import is intentional — the curated 147 remain the override source. So `airlines.ts` is NOT deleted; it stays as the curated-override input.

- [ ] **Step 2: Decision — keep `airlines.ts` as curated-override data**

`airlines.ts` is no longer the runtime resolver source (that's the DB), but it remains the vendored curated-override list consumed by `buildAirlineSeed`. Update its header comment to say so:
```typescript
/**
 * Curated airline override list (~147). No longer the runtime resolver source
 * — that is the `airlines` DB table. This list is UNIONed into the seed by
 * backend/src/data/openflights/buildAirlineSeed.ts and WINS on a shared IATA,
 * preserving the exact display names TravStats shows for common carriers.
 */
```

- [ ] **Step 3: Verify no stale resolver imports remain**

Run: `cd backend && grep -rn "from '../data/airlines'\|from './data/airlines'" src | grep -v buildAirlineSeed`
Expected: empty (only `buildAirlineSeed` imports it).

- [ ] **Step 4: Commit**

```bash
git add backend/src/data/airlines.ts
git commit -m "docs(catalogue): reframe airlines.ts as curated-override seed input"
```

---

## Phase 7 — Admin UI & flight-form picker

### Task 24: Frontend API client

**Files:**
- Create: `frontend/src/lib/api/catalogue.ts`

**Interfaces:**
- Produces: `airlinesApi.search(q)`, `airlinesApi.create(payload)`, `aircraftApi.search(q)`, `aircraftApi.create(payload)` — mirror `frontend/src/lib/api/cruise.ts` (`shipsApi`/`portsApi`), same axios instance with `withCredentials: true`.

- [ ] **Step 1: Inspect the mirror**

Read `frontend/src/lib/api/cruise.ts` for the exact axios client + `shipsApi`/`portsApi` shapes.

- [ ] **Step 2: Implement** the analogous `airlinesApi`/`aircraftApi` hitting `/api/v1/airlines` and `/aircraft`.

- [ ] **Step 3: Verify** `cd frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api/catalogue.ts
git commit -m "feat(catalogue): frontend airlines/aircraft API client"
```

### Task 25: Admin "Airlines & Aircraft" master-data section

**Files:**
- Create: `frontend/src/components/Admin/AirlineAircraftMasterData.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx` (import :~26, ActiveSection union :~61, TAB_FOR_SECTION :~70-81 → pin to "flight" tab, sidebar :~509, render :~673)
- Modify: `frontend/src/i18n/locales/de/admin.json` + `en/admin.json` (new keys)
- Test: `frontend/src/components/Admin/__tests__/AirlineAircraftMasterData.test.tsx`

**Interfaces:**
- Consumes: `airlinesApi`/`aircraftApi` (Task 24).
- Produces: an `AirlinesSection` + `AircraftSection` component (debounced search, inline add-custom form, list `.slice(0,50)` with an `isUserAdded` pill), mounted as a new `ActiveSection` under the flight tab.

- [ ] **Step 1: Inspect the mirror**

Read `frontend/src/components/Admin/CruiseMasterData.tsx` in full — replicate its structure (two sections, `useState`, debounced search, add form, list rendering, i18n `admin` namespace).

- [ ] **Step 2: Write a render/smoke test**

Create `AirlineAircraftMasterData.test.tsx`: render with a mocked `airlinesApi.search` returning `[{ iata:"LH", name:"Lufthansa", isUserAdded:false }]`, assert the airline name renders and the add-form inputs exist. Mirror the Vitest+RTL setup used by other Admin component tests.

- [ ] **Step 3: Run it** → FAIL (component missing).

- [ ] **Step 4: Implement** `AirlineAircraftMasterData.tsx` mirroring `CruiseMasterData.tsx`, swapping ships/ports → airlines/aircraft and `shipsApi`/`portsApi` → `airlinesApi`/`aircraftApi`. Add DE+EN i18n keys under a new `airlineAircraftMasterData.*` block (mirror `cruiseMasterData.*`).

- [ ] **Step 5: Mount in `AdminPage.tsx`** under the flight tab (add to `ActiveSection` union, `TAB_FOR_SECTION`, sidebar entry, and the render switch), mirroring how `CruiseMasterData` is pinned to the cruise tab.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run src/components/Admin`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Admin/AirlineAircraftMasterData.tsx frontend/src/pages/AdminPage.tsx frontend/src/i18n/locales/de/admin.json frontend/src/i18n/locales/en/admin.json frontend/src/components/Admin/__tests__/AirlineAircraftMasterData.test.tsx
git commit -m "feat(catalogue): admin Airlines & Aircraft master-data section"
```

### Task 26: In-form airline picker

**Files:**
- Modify: `frontend/src/components/FlightForm/FlightSelectStep.tsx` (airline input)
- Test: extend the relevant FlightForm test

**Interfaces:**
- Consumes: `airlinesApi.search` (Task 24).

- [ ] **Step 1: Inspect** how `FlightSelectStep.tsx` currently sources airline suggestions (today: catalogue + `/suggestions/airlines`).

- [ ] **Step 2: Decide the minimal change** — the datalist can keep using `/suggestions/airlines` (now DB-backed + searchable from Task 19), so the picker may need NO change beyond confirming it passes a `q`. If it fetches all suggestions once, switch it to a debounced search calling `airlinesApi.search(q)` (or `/suggestions/airlines?q=`).

- [ ] **Step 3: Implement** the debounced search wiring if needed; otherwise document that Task 19 already covers it.

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run src/components/FlightForm`
Expected: PASS. Manually confirm typing in the airline field returns catalogue matches.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FlightForm/FlightSelectStep.tsx
git commit -m "feat(catalogue): airline picker searches the live catalogue"
```

---

## Phase 8 — Full verification & branch wrap

### Task 27: Full build gate + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Clean the polluted dev logo cache**

Run: `rm -rf backend/.travstats-data/cache/airline-logos/`

- [ ] **Step 2: Backend gate**

Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
Expected: PASS (note the 2 known-flaky suites per memory `feedback_backend_suite_flakes` — cruise teardown + parser live-LLM timeout — are non-blockers).

- [ ] **Step 3: Frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: PASS.

- [ ] **Step 4: Manual browser smoke** (dev servers running per CLAUDE.local.md; re-seed dev admin if the suite wiped it: `cd backend && npm run seed:dev-admin`)
  - Admin → flight tab → Airlines & Aircraft: search "Lufthansa" resolves; add a custom airline; it appears with the user-added pill.
  - A flight with a known carrier shows its logo (kiwi tile) and correct name.
  - Filters airline dropdown still populated.
  - Restart the backend once: confirm `server_start_seed_airlines`, `server_start_catalog_preload`, and (if any legacy rows) `server_start_backfill_airline_codes` log lines.

- [ ] **Step 5: Re-index GitNexus + final commit**

Run: `npx gitnexus analyze` (per CLAUDE.md; a PostToolUse hook may do this automatically).
Then ensure the working tree is clean and all tasks committed.

- [ ] **Step 6: Report + isolated merge question**

Report the branch is complete and green. Then ask — as a single isolated question — whether to merge `feat/airline-aircraft-catalogue` into `main` (the RELEASE decision), per the owner rule. Do NOT bundle the merge into a list of next steps.

---

## Notes for the executor
- The 147-row curated `airlines.ts` and the cleaned `aircraftTypes.ts` are **retained** as curated-override seed inputs — do not delete them.
- Every catalogue POST must invalidate AND preload the matching cache, or the resolver serves a stale snapshot until reboot.
- The migration (Task 1) is the only prod-risk step; its prod pre-flight checklist runs at deploy time, not during implementation.
