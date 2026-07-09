# Unresolved Cruise Port — First-Class Stop State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop losing an imported cruise port when it can't be matched to the catalog — carry its name in a new `unresolvedPortName` field as a first-class third stop state instead of silently downgrading it to a sea day.

**Architecture:** Add a nullable `CruiseStop.unresolvedPortName` column (additive hand-written migration + one-time backfill of legacy `[unmatched: X]` sea days). The Zod stop schema moves from a 2-state to a 3-state invariant. The import resolver stops faking `isAtSea=true` and instead emits an unresolved stop. Reads flow the column through unchanged (raw Prisma passthrough). The frontend gains a third row kind in the stops editor (🔶 + PortPicker to resolve), a 🔶 timeline marker, and counts unresolved stops as port calls.

**Tech Stack:** Prisma (PostgreSQL), Zod, Express/TypeScript backend (Jest), React/Vite/TypeScript frontend (Vitest), react-i18next (DE/EN).

## Global Constraints

- **Branch/worktree:** all work happens in the `all-view-colors` worktree
  (`D:/TravStats_Projekt/TravStats/.claude/worktrees/all-view-colors`) on
  branch `dev/v2.3`. NEVER touch `backend/VERSION` or `CHANGELOG.md` (owned by
  `/deploy` on `main`).
- **Migration:** hand-written under `backend/prisma/migrations/`, additive only
  — do NOT run `prisma migrate dev` (it bundles pre-existing schema drift and
  breaks prod). Apply to dev via `prisma migrate deploy`.
- **`any` is FORBIDDEN** — use `unknown` + type guards. Pino logger only, no
  `console.log`. Async = `async/await`, never `.then()`. Immutable updates
  (spread), no in-place mutation.
- **Prisma DLL lock (Windows):** if `prisma generate` throws `EPERM ... rename
  query_engine-windows.dll.node`, a backend process holds the DLL — ask the
  user to stop it (NEVER run `taskkill`), or rename the locked DLL per
  CLAUDE.local.md, then re-run.
- **Dev DB:** `postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev`.
- **i18n:** every new user-facing string is added to BOTH
  `frontend/src/i18n/resources/de/cruise.json` and `.../en/cruise.json` in the
  same change. DE is primary.
- **Stop state invariant (the whole point):** each `CruiseStop` is exactly one
  of — (1) **matched port** `portId` set, `isAtSea=false`,
  `unresolvedPortName=null`; (2) **sea day** `isAtSea=true`, `portId=null`,
  `unresolvedPortName=null`; (3) **unresolved port** *(new)* `portId=null`,
  `isAtSea=false`, `unresolvedPortName` non-empty.
- **Commands (from the worktree root):** backend checks
  `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`;
  frontend checks `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — add `unresolvedPortName` to `model CruiseStop`.
- `backend/prisma/migrations/20260705120000_cruise_unresolved_port/migration.sql` — **create**: ALTER + backfill.
- `backend/src/schemas/cruise.ts` — add field to `stopSchema`, replace 2-state refine with 3-state.
- `backend/src/services/cruiseEntityResolver.ts` — `mapStop`: emit unresolved stop instead of sea-day downgrade.
- `backend/src/routes/cruises.ts` — carry `unresolvedPortName` through the create + update write-mappers.
- `backend/src/utils/cruiseStats.ts` — `CruiseStopData` gains the field; loop counts unresolved as a port call in `totalPortCalls`.
- `backend/src/routes/stats.ts` — the `cruiseStatsInput` stop mapper carries the field.

**Frontend**
- `frontend/src/types/cruise.ts` — `CruiseStop` + `CruiseStopInput` gain `unresolvedPortName`.
- `frontend/src/components/Cruise/cruisePorts.ts` — `countUniquePorts` adds distinct unresolved names; `EffectiveTimelineEntry` + `buildEffectiveTimeline` carry the field.
- `frontend/src/components/Cruise/CruiseStopsEditor.tsx` — render the unresolved row kind.
- `frontend/src/components/Cruise/CruiseEditModal.tsx` — carry the field when seeding the editor from an existing cruise.
- `frontend/src/pages/CruiseDetailPage.tsx` — timeline title shows 🔶 + name for unresolved stops.
- `frontend/src/i18n/resources/{de,en}/cruise.json` — new strings.

**Tests (all exist — append to them)**
- `backend/src/schemas/__tests__/cruise.test.ts`
- `backend/src/services/__tests__/cruiseEntityResolver.test.ts`
- `backend/src/utils/__tests__/cruiseStats.test.ts`
- `frontend/src/__tests__/components/Cruise/cruisePorts.test.ts`
- `frontend/src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx`

---

## Task 1: Data model — Prisma field + hand-written migration + backfill

**Files:**
- Modify: `backend/prisma/schema.prisma:869-886` (model `CruiseStop`)
- Create: `backend/prisma/migrations/20260705120000_cruise_unresolved_port/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: DB column `cruise_stops.unresolved_port_name text NULL`; Prisma
  field `CruiseStop.unresolvedPortName: String? @map("unresolved_port_name")`.
  Legacy sea days whose `excursion_note` contains `[unmatched: X]` are converted
  to unresolved ports.

- [ ] **Step 1: Add the Prisma field**

In `backend/prisma/schema.prisma`, inside `model CruiseStop`, add the column
after `excursionNote`:

```prisma
model CruiseStop {
  id            String    @id @default(uuid())
  cruiseId      String    @map("cruise_id")
  portId        Int?      @map("port_id")
  dayNumber     Int       @map("day_number")
  date          DateTime?
  isAtSea       Boolean   @default(false) @map("is_at_sea")
  arrivalTime   DateTime? @map("arrival_time")
  departureTime DateTime? @map("departure_time")
  excursionNote String?   @map("excursion_note")
  // Third stop state: a port whose name could not be matched to the catalog on
  // import. portId=null AND isAtSea=false AND this set => unresolved port.
  unresolvedPortName String? @map("unresolved_port_name")

  cruise Cruise @relation(fields: [cruiseId], references: [id], onDelete: Cascade)
  port   Port?  @relation(fields: [portId], references: [id], onDelete: SetNull)

  @@index([cruiseId])
  @@index([portId])
  @@map("cruise_stops")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `backend/prisma/migrations/20260705120000_cruise_unresolved_port/migration.sql`:

```sql
-- Unresolved cruise port as a first-class third stop state (v2.3).
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Nullable column add — safe + additive.

ALTER TABLE "cruise_stops" ADD COLUMN "unresolved_port_name" TEXT;

-- One-time backfill: recover ports that earlier imports downgraded to sea days
-- with the name stuffed into excursion_note as "[unmatched: X]". Turn them back
-- into unresolved ports and strip the tag from the note. Idempotent: the LIKE
-- guard finds nothing on a re-run after cleanup.
UPDATE "cruise_stops"
SET unresolved_port_name = substring(excursion_note from '\[unmatched: (.+?)\]'),
    is_at_sea = false,
    excursion_note = NULLIF(trim(regexp_replace(excursion_note, '\s*\[unmatched: .+?\]', '')), '')
WHERE is_at_sea = true AND excursion_note LIKE '%[unmatched:%';
```

- [ ] **Step 3: Apply the migration to the dev DB and regenerate the client**

Ensure the dev backend is stopped first (avoid the DLL lock). Run from
`backend/`:

```bash
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate deploy
npx prisma generate
```

Expected: `migrate deploy` reports `1 migration applied`
(`20260705120000_cruise_unresolved_port`); `generate` succeeds. If `generate`
throws `EPERM ... query_engine-windows.dll.node`, follow the DLL-lock workaround
in Global Constraints.

- [ ] **Step 4: Verify the column and backfill behavior against the dev DB**

Run from `backend/`:

```bash
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const r=await p.\$queryRawUnsafe(\"SELECT column_name FROM information_schema.columns WHERE table_name='cruise_stops' AND column_name='unresolved_port_name'\");console.log('column present:',r.length===1);await p.\$disconnect();})()"
```

Expected: `column present: true`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260705120000_cruise_unresolved_port/migration.sql
git commit -m "feat(cruise): add CruiseStop.unresolvedPortName column + backfill migration"
```

---

## Task 2: Zod — 3-state stop invariant

**Files:**
- Modify: `backend/src/schemas/cruise.ts:26-43` (`stopSchema`)
- Test: `backend/src/schemas/__tests__/cruise.test.ts`

**Interfaces:**
- Consumes: nothing (schema-only).
- Produces: `stopSchema` accepts `unresolvedPortName: string|null|undefined`
  (trimmed, min length 1 when present) and enforces the 3-state invariant.
  `CruiseInput` (`z.infer<typeof baseCruiseSchema>`) stops now carry
  `unresolvedPortName?: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/schemas/__tests__/cruise.test.ts` (import
`createCruiseSchema` the same way existing tests in the file do; a stop needs a
`dayNumber`). Add a `describe("stop 3-state invariant", ...)`:

```typescript
import { createCruiseSchema } from "../cruise";

describe("stop 3-state invariant", () => {
  const withStop = (stop: Record<string, unknown>) =>
    createCruiseSchema.safeParse({ stops: [{ dayNumber: 1, ...stop }] });

  it("accepts a matched port", () => {
    expect(withStop({ portId: 5, isAtSea: false }).success).toBe(true);
  });

  it("accepts a sea day", () => {
    expect(withStop({ isAtSea: true }).success).toBe(true);
  });

  it("accepts an unresolved port", () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: "Taranto" }).success).toBe(true);
  });

  it("rejects an empty stop (no port, not at sea, no unresolved name)", () => {
    expect(withStop({ isAtSea: false }).success).toBe(false);
  });

  it("rejects portId together with unresolvedPortName", () => {
    expect(withStop({ portId: 5, isAtSea: false, unresolvedPortName: "X" }).success).toBe(false);
  });

  it("rejects a sea day carrying an unresolved name", () => {
    expect(withStop({ isAtSea: true, unresolvedPortName: "X" }).success).toBe(false);
  });

  it("rejects a whitespace-only unresolved name", () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: "   " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest src/schemas/__tests__/cruise.test.ts -t "3-state" --forceExit`
Expected: FAIL (the unresolved-port and contradiction cases don't behave yet).

- [ ] **Step 3: Implement the schema change**

In `backend/src/schemas/cruise.ts`, replace the `stopSchema` definition
(lines 26-43) with:

```typescript
const stopSchema = z
  .object({
    portId: z.number().int().positive().nullable().optional(),
    dayNumber: z.number().int().min(1).max(365),
    // Calendar date of the stop. Booking confirmations list a date per stop
    // (often without clock times), so this captures it even when arrival/
    // departure times are absent. Coerced to a full ISO instant via isoDateTime
    // ("2027-10-08" -> "2027-10-08T00:00:00.000Z").
    date: isoDateTime,
    isAtSea: z.boolean().default(false),
    arrivalTime: isoDateTime,
    departureTime: isoDateTime,
    excursionNote: z.string().max(500).optional(),
    // Third stop state: an imported port whose name could not be matched to the
    // catalog. Carried as a name-only stop (no portId, not a sea day) so it is
    // never lost; the user resolves it later via the PortPicker.
    unresolvedPortName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  // 3-state invariant: a stop is valid iff it is a sea day, OR references a
  // port, OR carries an unresolved port name — and never mixes those.
  .superRefine((s, ctx) => {
    const hasPort = s.portId !== null && s.portId !== undefined;
    const hasUnresolved = s.unresolvedPortName !== null && s.unresolvedPortName !== undefined;
    if (!s.isAtSea && !hasPort && !hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A stop must be at sea, reference a port, or carry an unresolved port name",
        path: ["portId"],
      });
    }
    if (hasPort && hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A stop cannot be both a matched port and an unresolved port",
        path: ["unresolvedPortName"],
      });
    }
    if (s.isAtSea && (hasPort || hasUnresolved)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A sea day cannot reference a port or an unresolved port name",
        path: ["isAtSea"],
      });
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/schemas/__tests__/cruise.test.ts --forceExit`
Expected: PASS (new invariant tests + all pre-existing cruise-schema tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/cruise.ts backend/src/schemas/__tests__/cruise.test.ts
git commit -m "feat(cruise): 3-state Zod stop invariant with unresolvedPortName"
```

---

## Task 3: Backend resolver — emit unresolved stop instead of sea-day downgrade

**Files:**
- Modify: `backend/src/services/cruiseEntityResolver.ts:275-321` (`mapStop`) and the doc comment at lines 225-228.
- Test: `backend/src/services/__tests__/cruiseEntityResolver.test.ts`

**Interfaces:**
- Consumes: `stopSchema`'s `unresolvedPortName` (Task 2); `CruiseInput["stops"]`
  now permits `unresolvedPortName`.
- Produces: `mapStop` returns, for an unmatched named non-sea-day stop,
  `{ portId: null, isAtSea: false, unresolvedPortName: stop.portName,
  excursionNote: <clean> }` and still pushes `{ dayNumber, portName }` to
  `unmatched`. Matched ports and sea days are unchanged.

- [ ] **Step 1: Update the failing tests**

In `backend/src/services/__tests__/cruiseEntityResolver.test.ts`, the existing
test `"flags unmatched ports and forces isAtSea=true to satisfy the Zod
refinement"` (around line 94) now encodes the OLD behavior. Replace its body so
it asserts the NEW unresolved-stop behavior, and rename it:

```typescript
  it("maps an unmatched named port to an unresolved stop (no sea-day downgrade)", async () => {
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false, portName: "Atlantis" }],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.unmatchedPorts).toEqual([{ dayNumber: 1, portName: "Atlantis" }]);
    const [stop] = result.input.stops!;
    expect(stop.portId).toBeNull();
    expect(stop.isAtSea).toBe(false);
    expect(stop.unresolvedPortName).toBe("Atlantis");
    // The name lives in its own field now — the excursion note is not tagged.
    expect(stop.excursionNote ?? "").not.toContain("[unmatched:");
  });

  it("keeps a real excursion note clean on an unresolved stop", async () => {
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false, portName: "Atlantis", excursionNote: "City tour" }],
    });
    const result = await resolveCruiseEntities(cruise);
    const [stop] = result.input.stops!;
    expect(stop.unresolvedPortName).toBe("Atlantis");
    expect(stop.excursionNote).toBe("City tour");
  });
```

Leave the "does not let a short catalog name swallow a longer parsed name" test
(around line 122) but update its assertion `expect(stop.isAtSea).toBe(true)` if
present — check that test: it only asserts `portId` is null and `unmatchedPorts`,
so no change needed there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest src/services/__tests__/cruiseEntityResolver.test.ts -t "unresolved" --forceExit`
Expected: FAIL (`unresolvedPortName` is `undefined`, `isAtSea` is `true`).

- [ ] **Step 3: Implement the resolver change**

In `backend/src/services/cruiseEntityResolver.ts`, replace the non-sea-day
portion of `mapStop` (lines 293-320, from `const match = findBestPort(` through
the trailing `return { ... };`) with:

```typescript
  const match = findBestPort(
    { name: stop.portName, city: stop.city, country: stop.country },
    ports,
  );
  if (!match && stop.portName) {
    unmatched.push({ dayNumber: index + 1, portName: stop.portName });
  }

  // Unmatched named ports become a first-class unresolved stop: the name is
  // preserved in its own field, the stop stays a port (not a sea day), and the
  // user can resolve it to a catalog port later. The excursion note stays clean.
  return {
    portId: match?.id ?? null,
    dayNumber: index + 1,
    date: stop.date,
    isAtSea: false,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    excursionNote: stop.excursionNote,
    unresolvedPortName: match ? undefined : (stop.portName ?? undefined),
  };
```

Also update the doc comment at lines 225-228 so it no longer says unmatched
ports become "a stub excursionNote"; make it read:

```typescript
 * Convert a parsed cruise from the LLM into a CruiseInput shape that the
 * `/api/v1/cruises` POST endpoint accepts. Unmatched ports become unresolved
 * stops (portId=null, isAtSea=false, unresolvedPortName set) so the name is
 * never lost and the user can pick the catalog port later in the UI.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/services/__tests__/cruiseEntityResolver.test.ts --forceExit`
Expected: PASS (all resolver tests, including the untouched matched/sea-day/exonym cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/cruiseEntityResolver.ts backend/src/services/__tests__/cruiseEntityResolver.test.ts
git commit -m "feat(cruise): resolver emits unresolved stop instead of sea-day downgrade"
```

---

## Task 4: Persistence — carry unresolvedPortName through create + update

**Files:**
- Modify: `backend/src/routes/cruises.ts:295-304` (create write-mapper) and `backend/src/routes/cruises.ts:352-361` (update write-mapper)

**Interfaces:**
- Consumes: `stopSchema.unresolvedPortName` (Task 2), the Prisma column (Task 1).
- Produces: created/updated `CruiseStop` rows persist `unresolvedPortName`. The
  cruise GET/POST/PATCH responses already return it via the raw `CRUISE_INCLUDE`
  passthrough (no serializer change needed).

- [ ] **Step 1: Verify the leg filter is unaffected (read-only check)**

Confirm `backend/src/services/cruiseDistance/cruiseLegService.ts:34` still reads
`where: { cruiseId, isAtSea: false, portId: { not: null } }`. Unresolved stops
(`portId: null`) are naturally excluded from legs/distance — no change. Note it,
do not edit.

- [ ] **Step 2: Add the field to the create write-mapper**

In `backend/src/routes/cruises.ts`, the POST handler's `createMany` data
(lines 295-304), add `unresolvedPortName`:

```typescript
        await tx.cruiseStop.createMany({
          data: stops.map((s) => ({
            cruiseId: created.id,
            portId: s.portId ?? null,
            dayNumber: s.dayNumber,
            date: s.date ? new Date(s.date) : null,
            isAtSea: s.isAtSea,
            arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
            departureTime: s.departureTime ? new Date(s.departureTime) : null,
            excursionNote: s.excursionNote ?? null,
            unresolvedPortName: s.unresolvedPortName ?? null,
          })),
        });
```

- [ ] **Step 3: Add the field to the update write-mapper**

In the same file, the PATCH handler's `createMany` data (lines 352-361), add the
same line:

```typescript
          await tx.cruiseStop.createMany({
            data: stops.map((s) => ({
              cruiseId: existing.id,
              portId: s.portId ?? null,
              dayNumber: s.dayNumber,
              date: s.date ? new Date(s.date) : null,
              isAtSea: s.isAtSea,
              arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
              departureTime: s.departureTime ? new Date(s.departureTime) : null,
              excursionNote: s.excursionNote ?? null,
              unresolvedPortName: s.unresolvedPortName ?? null,
            })),
          });
```

- [ ] **Step 4: Type-check the backend**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS with no errors (the Prisma client from Task 1 now types
`unresolvedPortName` on `CruiseStopCreateManyInput`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/cruises.ts
git commit -m "feat(cruise): persist unresolvedPortName on cruise create/update"
```

---

## Task 5: Backend stats — count unresolved stops as port calls

**Files:**
- Modify: `backend/src/utils/cruiseStats.ts:16-23` (`CruiseStopData`) and `backend/src/utils/cruiseStats.ts:178-227` (the stop loop)
- Modify: `backend/src/routes/stats.ts:1114-1134` (`cruiseStatsInput` stop mapper)
- Test: `backend/src/utils/__tests__/cruiseStats.test.ts`

**Interfaces:**
- Consumes: the Prisma column (Task 1).
- Produces: `CruiseStopData` carries `unresolvedPortName?: string | null`;
  `totalPortCalls` counts unresolved stops (`!isAtSea && !port &&
  unresolvedPortName`). Unique-port sets (`cruisePortsUnique`,
  `cruisePortsSingleMax`) stay matched-port-only per spec — do NOT add unresolved
  to those.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/utils/__tests__/cruiseStats.test.ts`. Follow the file's
existing helper/fixture style for building a `CruiseData`; a minimal cruise with
one matched port, one sea day, one unresolved stop:

```typescript
import { calculateCruiseStats } from "../cruiseStats";

describe("unresolved stops count as port calls", () => {
  it("adds an unresolved stop to totalPortCalls but not to unique ports", () => {
    const stats = calculateCruiseStats([
      {
        id: "c1",
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        departurePort: null,
        arrivalPort: null,
        legDistancesKm: [],
        stops: [
          {
            portId: 1,
            port: {
              id: 1, name: "Kiel", city: "Kiel", country: "Germany",
              region: "baltic", unlocode: "DEKEL", lat: 54.32, lon: 10.14,
              timezone: null, isUserAdded: false,
            },
            dayNumber: 1,
            isAtSea: false,
          },
          { portId: null, port: null, dayNumber: 2, isAtSea: true },
          {
            portId: null, port: null, dayNumber: 3, isAtSea: false,
            unresolvedPortName: "Taranto",
          },
        ],
      },
    ]);
    expect(stats.totalPortCalls).toBe(2); // Kiel + Taranto
    expect(stats.cruisePortsUnique).toBe(1); // only the matched Kiel
    expect(stats.seaDays).toBe(1);
  });
});
```

(If the file already exports a fixture builder like `makeCruise`, use it and
pass only the differing fields — repeat the literal above only if none exists.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/cruiseStats.test.ts -t "unresolved" --forceExit`
Expected: FAIL — `totalPortCalls` is `1` (unresolved stop not counted); may also
be a TS error until `CruiseStopData` gains the field.

- [ ] **Step 3: Add the field to `CruiseStopData`**

In `backend/src/utils/cruiseStats.ts`, extend the interface (lines 16-23):

```typescript
export interface CruiseStopData {
  portId: number | null;
  port: CruisePortData | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: Date | null;
  departureTime?: Date | null;
  /** Set on an unresolved port (portId=null, isAtSea=false). Counts as a port call. */
  unresolvedPortName?: string | null;
}
```

- [ ] **Step 4: Count unresolved stops in the loop**

In the same file, inside the `for (const stop of effectiveStops)` loop, the
`else` branch currently increments port stats only `if (stop.port)`. Add an
`else if` for the unresolved case. Change the block (lines 183-225) so the
`else` reads:

```typescript
      } else {
        currentSeaStreak = 0;
        if (stop.port) {
          portIds.add(stop.port.id);
          cruisePortCount += 1;
          totalPortCalls += 1;
          if (stop.port.country) countries.add(stop.port.country);
          if (stop.port.region) {
            regions.add(stop.port.region);
            regionVisitCounts[stop.port.region] =
              (regionVisitCounts[stop.port.region] ?? 0) + 1;
          }
          if (stop.port.unlocode && CANAL_UNLOCODES.has(stop.port.unlocode)) hasCanalTransit = true;
          if (stop.port.region && POLAR_REGIONS.has(stop.port.region)) hasPolar = true;
          if (
            (stop.port.country && COLD_WATER_COUNTRIES.has(stop.port.country)) ||
            (stop.port.region && COLD_WATER_REGIONS.has(stop.port.region))
          ) {
            hasColdWater = true;
          }
          // Distance per leg: prefer persisted cruise_legs values
          // (routed by the cruiseDistance pipeline), fall back to
          // inline haversine when none are available. Sea days don't
          // add distance — they're inside the leg between surrounding
          // port calls.
          const here = { lat: stop.port.lat, lon: stop.port.lon };
          if (prevPortPoint !== null) {
            const legIdx = portCallIndex - 1;
            const legKm =
              usePersistedLegs && persistedLegs
                ? persistedLegs[legIdx]
                : haversineKm(prevPortPoint, here);
            totalDistanceKm += legKm;
            if (legKm > longestLegKm) longestLegKm = legKm;
            // Antimeridian crossing: large absolute longitude span
            // (>180°) collapses to a shorter great-circle path that
            // skips the dateline. Detect via raw longitude jump.
            const lonSpan = Math.abs(here.lon - prevPortPoint.lon);
            if (lonSpan > 180) hasDatelineCrossing = true;
          }
          prevPortPoint = here;
          portCallIndex += 1;
        } else if (stop.unresolvedPortName) {
          // Unresolved port: a real port call (name preserved) but coordinate-
          // less, so it counts toward port-call totals only — no distance, no
          // unique-port id, no country/region. It does not advance
          // prevPortPoint/portCallIndex (those track routed legs between
          // catalog ports).
          totalPortCalls += 1;
        }
      }
```

- [ ] **Step 5: Carry the field in the stats route mapper**

In `backend/src/routes/stats.ts`, the `cruiseStatsInput` stop mapper
(lines 1114-1134), add `unresolvedPortName` after `departureTime`:

```typescript
        stops: c.stops.map((s) => ({
          portId: s.portId,
          port: s.port
            ? {
                id: s.port.id,
                name: s.port.name,
                city: s.port.city,
                country: s.port.country,
                region: s.port.region,
                unlocode: s.port.unlocode,
                lat: s.port.lat,
                lon: s.port.lon,
                timezone: s.port.timezone,
                isUserAdded: s.port.isUserAdded,
              }
            : null,
          dayNumber: s.dayNumber,
          isAtSea: s.isAtSea,
          arrivalTime: s.arrivalTime,
          departureTime: s.departureTime,
          unresolvedPortName: s.unresolvedPortName,
        })),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/cruiseStats.test.ts --forceExit`
Expected: PASS (new test + all pre-existing cruiseStats tests unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/cruiseStats.ts backend/src/routes/stats.ts backend/src/utils/__tests__/cruiseStats.test.ts
git commit -m "feat(cruise): count unresolved stops as port calls in stats"
```

---

## Task 6: Frontend types + i18n strings

**Files:**
- Modify: `frontend/src/types/cruise.ts:26-38` (`CruiseStop`) and `frontend/src/types/cruise.ts:76-88` (`CruiseStopInput`)
- Modify: `frontend/src/i18n/resources/de/cruise.json` and `.../en/cruise.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `CruiseStop.unresolvedPortName: string | null` and
  `CruiseStopInput.unresolvedPortName?: string | null`; i18n keys
  `stops.unresolved` (row label) and `stops.unresolvedHint`.

- [ ] **Step 1: Add the field to both interfaces**

In `frontend/src/types/cruise.ts`, add to `CruiseStop` (after `excursionNote`):

```typescript
export interface CruiseStop {
  id: string;
  cruiseId: string;
  portId: number | null;
  port: Port | null;
  dayNumber: number;
  /** Calendar date of the stop (ISO) or null. */
  date: string | null;
  isAtSea: boolean;
  arrivalTime: string | null;
  departureTime: string | null;
  excursionNote: string | null;
  /** Set on an unresolved port: name-only stop, portId=null, isAtSea=false. */
  unresolvedPortName: string | null;
}
```

And to `CruiseStopInput` (after `excursionNote?`):

```typescript
export interface CruiseStopInput {
  portId: number | null;
  dayNumber: number;
  date?: string | null;
  isAtSea: boolean;
  arrivalTime?: string | null;
  departureTime?: string | null;
  excursionNote?: string;
  /** Unresolved port name (import couldn't match the catalog). Cleared when
   *  the user picks a real port. */
  unresolvedPortName?: string | null;
  /** UI-only: the resolved Port for this stop, so the stops editor can show
   *  the selected port when editing an existing cruise. Not sent to the
   *  backend — the submit mapper strips it (backend Zod also ignores it). */
  port?: Port | null;
}
```

- [ ] **Step 2: Add the DE i18n strings**

In `frontend/src/i18n/resources/de/cruise.json`, inside the `"stops"` object,
add:

```json
    "unresolved": "Nicht aufgelöster Hafen",
    "unresolvedHint": "Wähle einen Hafen aus dem Katalog, um diesen Stopp aufzulösen."
```

- [ ] **Step 3: Add the EN i18n strings**

In `frontend/src/i18n/resources/en/cruise.json`, inside the `"stops"` object,
add:

```json
    "unresolved": "Unresolved port",
    "unresolvedHint": "Pick a port from the catalog to resolve this stop."
```

- [ ] **Step 4: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/cruise.ts frontend/src/i18n/resources/de/cruise.json frontend/src/i18n/resources/en/cruise.json
git commit -m "feat(cruise): frontend types + i18n for unresolved port stop"
```

---

## Task 7: Frontend — countUniquePorts + timeline carry unresolved

**Files:**
- Modify: `frontend/src/components/Cruise/cruisePorts.ts` (`countUniquePorts`, `EffectiveTimelineEntry`, `buildEffectiveTimeline`)
- Test: `frontend/src/__tests__/components/Cruise/cruisePorts.test.ts`

**Interfaces:**
- Consumes: `CruiseStop.unresolvedPortName` (Task 6).
- Produces: `countUniquePorts` adds distinct trimmed/case-insensitive unresolved
  names to the count (no cross-dedupe against catalog ports).
  `EffectiveTimelineEntry` gains `unresolvedPortName: string | null`;
  `buildEffectiveTimeline` populates it from each stop.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/components/Cruise/cruisePorts.test.ts` (reuse
the file's existing cruise-fixture helper; a stop needs
`unresolvedPortName`). Add:

```typescript
import { countUniquePorts, buildEffectiveTimeline } from "../../../components/Cruise/cruisePorts";

describe("countUniquePorts with unresolved stops", () => {
  it("counts an unresolved stop as a port and dedupes by name", () => {
    const cruise = makeCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [
        makeStop({ portId: 1, port: makePort({ id: 1 }), isAtSea: false }),
        makeStop({ portId: null, port: null, isAtSea: false, unresolvedPortName: "Taranto" }),
        makeStop({ portId: null, port: null, isAtSea: false, unresolvedPortName: " taranto " }),
        makeStop({ portId: null, port: null, isAtSea: true }),
      ],
    });
    expect(countUniquePorts(cruise)).toBe(2); // Kiel(id 1) + one Taranto
  });
});

describe("buildEffectiveTimeline carries unresolvedPortName", () => {
  it("exposes the unresolved name on the entry", () => {
    const cruise = makeCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [makeStop({ portId: null, port: null, isAtSea: false, unresolvedPortName: "Taranto" })],
    });
    const entry = buildEffectiveTimeline(cruise).find((e) => e.unresolvedPortName);
    expect(entry?.unresolvedPortName).toBe("Taranto");
    expect(entry?.isAtSea).toBe(false);
  });
});
```

(If the file has no `makeCruise`/`makeStop`/`makePort` helpers, build the objects
as inline literals matching the `Cruise`/`CruiseStop`/`Port` types, filling every
required field the same way the existing tests in the file do — do not use
`any`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/cruisePorts.test.ts`
Expected: FAIL (`countUniquePorts` returns 1; `entry.unresolvedPortName` is
`undefined` / a type error).

- [ ] **Step 3: Update `countUniquePorts`**

In `frontend/src/components/Cruise/cruisePorts.ts`, replace `countUniquePorts`:

```typescript
/** Unique ports across departure / arrival / port-call stops, including
 *  unresolved (coordinate-less) ports counted by distinct trimmed name. A
 *  matched port and an unresolved same-named port are counted separately. */
export function countUniquePorts(cruise: Cruise): number {
  const portIds = new Set<number>();
  if (cruise.departurePort?.id != null) portIds.add(cruise.departurePort.id);
  if (cruise.arrivalPort?.id != null) portIds.add(cruise.arrivalPort.id);
  const unresolvedNames = new Set<string>();
  for (const stop of cruise.stops) {
    if (stop.isAtSea) continue;
    if (stop.port?.id != null) {
      portIds.add(stop.port.id);
    } else if (stop.unresolvedPortName) {
      unresolvedNames.add(stop.unresolvedPortName.trim().toLowerCase());
    }
  }
  return portIds.size + unresolvedNames.size;
}
```

- [ ] **Step 4: Update `EffectiveTimelineEntry` + `buildEffectiveTimeline`**

In the same file, add to the `EffectiveTimelineEntry` interface (after
`isAtSea`):

```typescript
  isAtSea: boolean;
  /** Unresolved port name when this entry is an unresolved stop, else null. */
  unresolvedPortName: string | null;
```

Then in `buildEffectiveTimeline`, set it on each mapped stop entry and on the two
synthetic departure/arrival entries. The stop map (`cruise.stops.map((stop) =>
({...}))`) gains `unresolvedPortName: stop.unresolvedPortName ?? null`; the
`entries.unshift({...})` departure entry and `entries.push({...})` arrival entry
each gain `unresolvedPortName: null`:

```typescript
  const entries: EffectiveTimelineEntry[] = cruise.stops.map((stop) => ({
    key: stop.id,
    stop,
    port: stop.port ?? null,
    isAtSea: stop.isAtSea,
    unresolvedPortName: stop.unresolvedPortName ?? null,
    // Prefer the explicit per-stop date; fall back to the arrival timestamp for
    // older stops imported before the date field existed.
    date: stop.date ?? stop.arrivalTime ?? null,
    excursionNote: stop.excursionNote ?? null,
  }));
```

Add `unresolvedPortName: null,` to both the `entries.unshift({ ... })` departure
object and the `entries.push({ ... })` arrival object (each already sets `key`,
`stop: null`, `port`, `isAtSea: false`, `date`, `excursionNote: null`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/cruisePorts.test.ts`
Expected: PASS (new tests + all pre-existing cruisePorts tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Cruise/cruisePorts.ts frontend/src/__tests__/components/Cruise/cruisePorts.test.ts
git commit -m "feat(cruise): count unresolved ports + carry name in timeline"
```

---

## Task 8: Frontend — stops editor renders + resolves the unresolved row

**Files:**
- Modify: `frontend/src/components/Cruise/CruiseStopsEditor.tsx`
- Modify: `frontend/src/components/Cruise/CruiseEditModal.tsx:95-104` (seed editor state with the field)
- Test: `frontend/src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx`

**Interfaces:**
- Consumes: `CruiseStopInput.unresolvedPortName` (Task 6); the `stops.unresolved`
  / `stops.unresolvedHint` i18n keys.
- Produces: an unresolved stop (`!isAtSea && !portId && unresolvedPortName`)
  renders a 🔶 banner with the name + hint above the PortPicker; picking a port
  sets `portId`/`port` and clears `unresolvedPortName`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx`
(reuse the file's render helpers / mocked `PortPicker` pattern):

```typescript
  it("shows a 🔶 unresolved banner for an unresolved stop and clears the name on resolve", async () => {
    const onChange = vi.fn();
    render(
      <CruiseStopsEditor
        stops={[{ portId: null, dayNumber: 1, isAtSea: false, unresolvedPortName: "Taranto" }]}
        onChange={onChange}
      />,
    );
    // The unresolved name is visible.
    expect(screen.getByText(/Taranto/)).toBeInTheDocument();
    // Resolving via the PortPicker sets portId and clears unresolvedPortName.
    // (The test's PortPicker mock exposes a way to emit a Port — follow the
    // existing "selects a port" test in this file for the exact trigger.)
    // After emitting a port with id 42:
    // expect(onChange).toHaveBeenCalledWith([
    //   expect.objectContaining({ portId: 42, unresolvedPortName: null }),
    // ]);
  });
```

Fill in the PortPicker-resolve assertion by mirroring the existing port-select
test in the same file (use its mock trigger to emit `{ id: 42, ... }` and assert
`onChange` was called with `portId: 42` and `unresolvedPortName: null`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx -t "unresolved"`
Expected: FAIL (no banner renders "Taranto").

- [ ] **Step 3: Render the unresolved banner + clear name on resolve**

In `frontend/src/components/Cruise/CruiseStopsEditor.tsx`:

Update `handlePortChange` to clear the unresolved name when a port is picked:

```typescript
  const handlePortChange = (index: number, port: Port): void => {
    update(index, { portId: port.id, port, unresolvedPortName: null });
  };
```

Inside the `{!stop.isAtSea && ( <> ... </> )}` block, before the `<PortPicker>`,
add the 🔶 banner shown only when the stop is unresolved:

```tsx
          {!stop.isAtSea && (
            <>
              {stop.portId == null && stop.unresolvedPortName ? (
                <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                  <span className="font-medium">🔶 {t("stops.unresolved")}:</span>{" "}
                  {stop.unresolvedPortName}
                  <div className="mt-0.5 text-[11px] text-amber-300/80">
                    {t("stops.unresolvedHint")}
                  </div>
                </div>
              ) : null}
              <PortPicker
                value={stop.port ?? null}
                onChange={(p): void => handlePortChange(i, p)}
              />
              {/* …existing arrival/departure inputs + excursion textarea unchanged… */}
```

(Keep the rest of the block — the arrival/departure grid and excursion textarea —
exactly as-is; only the banner and the `handlePortChange` clear are new.)

- [ ] **Step 4: Seed the editor state with the field in CruiseEditModal**

In `frontend/src/components/Cruise/CruiseEditModal.tsx`, the initial `stops`
state mapper (lines 95-104) must carry `unresolvedPortName` so editing an
existing cruise preserves it:

```typescript
  const [stops, setStops] = useState<CruiseStopInput[]>(
    (cruise?.stops ?? []).map((s) => ({
      portId: s.portId,
      port: s.port,
      dayNumber: s.dayNumber,
      date: s.date,
      isAtSea: s.isAtSea,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      excursionNote: s.excursionNote ?? undefined,
      unresolvedPortName: s.unresolvedPortName,
    }))
  );
```

The submit mapper (`stops.map(({ port: _port, ...rest }) => rest)`) already
forwards `unresolvedPortName` — no change there. The import-preview modal seeds
via `...s` spread — also already covered.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx`
Expected: PASS (new test + all pre-existing editor tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Cruise/CruiseStopsEditor.tsx frontend/src/components/Cruise/CruiseEditModal.tsx frontend/src/__tests__/components/Cruise/CruiseStopsEditor.test.tsx
git commit -m "feat(cruise): stops editor renders + resolves unresolved port rows"
```

---

## Task 9: Frontend — cruise detail timeline shows 🔶 for unresolved

**Files:**
- Modify: `frontend/src/pages/CruiseDetailPage.tsx:96-105` (timeline event mapping)

**Interfaces:**
- Consumes: `EffectiveTimelineEntry.unresolvedPortName` (Task 7); the
  `stops.unresolved` i18n key (Task 6).
- Produces: an unresolved timeline entry renders `🔶 <name>` as its title
  instead of the em-dash placeholder.

- [ ] **Step 1: Update the timeline event mapping**

In `frontend/src/pages/CruiseDetailPage.tsx`, replace the `events` mapping
(lines 96-105) so an unresolved entry shows the name with a 🔶 marker:

```typescript
  const events: TimelineEvent[] = buildEffectiveTimeline(cruise).map((entry) => ({
    id: entry.key,
    domain: "cruise",
    date: entry.date ?? cruise.startDate ?? new Date().toISOString(),
    title: entry.isAtSea
      ? t("stops.at_sea")
      : entry.port?.name ?? (entry.unresolvedPortName ? `🔶 ${entry.unresolvedPortName}` : "—"),
    subtitle: entry.isAtSea
      ? undefined
      : entry.port
        ? [entry.port.city, entry.port.country].filter(Boolean).join(", ") || undefined
        : entry.unresolvedPortName
          ? t("stops.unresolved")
          : undefined,
    meta: entry.excursionNote ?? undefined,
  }));
```

- [ ] **Step 2: Type-check + full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`
Expected: PASS (no type errors; all cruise tests green).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/CruiseDetailPage.tsx
git commit -m "feat(cruise): show unresolved port with 🔶 in detail timeline"
```

---

## Task 10: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Backend gate**

Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
Expected: tsc clean, lint clean, all Jest suites pass.

- [ ] **Step 2: Frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: tsc clean, lint clean, all Vitest suites pass.

- [ ] **Step 3: Manual smoke (import → unresolved → resolve)**

Start the dev stack (backend 8000 + frontend 3000 per CLAUDE.local.md), log in
as `admin:admin123`, and:
1. Import a cruise booking whose itinerary contains a port not in the catalog
   (or add a stop with an obscure name). Confirm the import preview shows the
   unmatched warning and the stop renders as a 🔶 unresolved port (NOT a sea day).
2. Save. Reopen the cruise — the stop still shows 🔶 with the name, the ports
   count includes it, and it is NOT counted as a sea day.
3. Edit the stop, pick a catalog port in the PortPicker — the 🔶 banner
   disappears, `unresolvedPortName` is cleared, and the port resolves normally.
4. Verify the detail timeline shows `🔶 <name>` for the unresolved stop.

- [ ] **Step 4: Verify the backfill on the dev DB**

Confirm any pre-existing sea-day rows with `[unmatched: X]` notes were converted
(Task 1 ran the backfill). If the dev DB has none, this is informational only.

- [ ] **Step 5: Refresh GitNexus index (post-commit hook usually handles this)**

If the index is stale, run: `npx gitnexus analyze --embeddings`

---

## Self-Review

**Spec coverage:**
- §A Data model → Task 1 (Prisma field + migration) + Task 2 (Zod) ✓
- §B Resolver → Task 3 ✓
- §C Serialization/reads → Task 4 (write-mappers; reads pass through raw
  `CRUISE_INCLUDE`) + Task 5 step 1 (leg filter verified unchanged) ✓
- §D Frontend types/editor/timeline → Task 6 (types+i18n), Task 8 (editor),
  Task 9 (detail timeline) ✓
- §E Backfill → Task 1 step 2 (in the migration) ✓
- §F Stats/counting → Task 5 (backend `totalPortCalls`) + Task 7 (frontend
  `countUniquePorts`) ✓ — backend unique-port sets deliberately left
  matched-only per spec F's backend bullet.
- §G Import preview → covered: resolver no longer downgrades (Task 3), preview
  seeds via `...s` spread (unchanged), editor renders unresolved rows (Task 8),
  warning + auto-expand already present. No save-time guard added ✓
- Error handling → Zod rejects contradictions (Task 2); resolver never throws
  (Task 3); backfill LIKE-guarded (Task 1) ✓
- Testing → Zod (T2), resolver (T3), countUniquePorts (T7), editor (T8), stats
  (T5); migration backfill verified manually (T1/T10) ✓

**Type consistency:** field is `unresolvedPortName` everywhere; DB column
`unresolved_port_name`. `CruiseStop.unresolvedPortName: string | null` (non-opt,
from DB); `CruiseStopInput.unresolvedPortName?: string | null` (optional input);
`CruiseStopData.unresolvedPortName?: string | null`;
`EffectiveTimelineEntry.unresolvedPortName: string | null`. Resolver returns
`unresolvedPortName: match ? undefined : (stop.portName ?? undefined)` — matches
the optional input type. Write-mappers coerce `?? null` for Prisma. ✓

**Placeholder scan:** the only "follow the existing test" references are in the
frontend editor/countUniquePorts tests where the exact fixture/mock helpers live
in those files and must be reused rather than duplicated — the assertions and
component code are fully specified. No TBD/TODO left.
