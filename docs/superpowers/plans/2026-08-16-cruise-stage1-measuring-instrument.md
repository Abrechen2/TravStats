# Cruise Stage 1 — Repair the Measuring Instrument

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three pre-existing defects that sit on the seam the cruise
route-editing work will cut, so that any later number change can be attributed.

**Architecture:** Three independent repairs, no new feature and no schema
change. (1) Frontend and backend agree on one rule for counting ports.
(2) The globe time slider builds its legs from the same effective sequence the
geometry endpoint uses, so the first and last leg stop disappearing. (3) The
leg-backfill script expects the leg count `recomputeLegsForCruise` actually
produces. Each repair puts its rule in exactly one place and has a test that
fails before the change.

**Tech Stack:** TypeScript (strict), React 19 + Vite + Vitest (frontend),
Express + Prisma + Jest (backend), react-i18next (DE primary, EN mirror).

**Spec:** `docs/superpowers/specs/2026-08-16-cruise-route-editing-and-excursions-design.md`
— see §3 (the three defects) and §5 (counting rules).

## Global Constraints

- `any` is **forbidden**. Use `unknown` plus type guards. Only `.d.ts` files are exempt.
- No `console.log` in backend runtime code — import the default export of `utils/logger`. (Existing `console.log` inside `scripts/` is the established exception and stays.)
- Immutability: build new objects with spread; never mutate in place.
- Files: 200–400 lines ideal, **800 hard maximum**.
- Every user-facing string is added to **both** `frontend/src/i18n/resources/de/*.json` and `.../en/*.json` in the same change. German is the primary copy.
- `useTranslation` is imported from `../../hooks/useTranslation` (project wrapper), never from `react-i18next`.
- Conventional commits: `<type>: <description>`, English.
- Do **not** touch `backend/VERSION` or `CHANGELOG.md` — those belong to `/deploy` on `main`.
- Work happens on branch `dev/cruise-extension`. Do not merge to `main`; that is the owner's release decision.

## Gate commands

```bash
# Frontend
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run

# Backend (needs PostgreSQL)
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```

---

### Task 1: One rule for counting ports (defect D1)

Today `countUniquePorts` on the frontend adds distinct **unresolved port
names** to its unique count, while the backend's `cruisePortsUnique`
deliberately excludes them (its own comment reads "no unique-port id") and
counts them only in `totalPortCalls`. The same cruise therefore has different
port counts depending on where you look.

The backend rule wins: an unresolved name is a port *call* but not an
identifiable port, because it cannot be reliably de-duplicated against a
matched port of the same name. The information is not lost — it is shown
next to the number instead of silently folded into it.

> **This changes a number the owner can see.** A cruise with unresolved stops
> will show a lower port count than yesterday, with a `(+n)` suffix. Confirm
> with the owner before this task ships. It is open item 1 in the spec.

**Files:**
- Modify: `frontend/src/components/Cruise/cruisePorts.ts:14-31`
- Modify: `frontend/src/components/Cruise/CruiseRow.tsx:4,20,39`
- Modify: `frontend/src/pages/CruiseDetailPage.tsx:7,113`
- Modify: `frontend/src/i18n/resources/de/cruise.json` (after `"duplicate"`)
- Modify: `frontend/src/i18n/resources/en/cruise.json` (after `"duplicate"`)
- Test: `frontend/src/__tests__/components/Cruise/cruisePorts.test.ts:130-144`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `countUniquePorts(cruise: Cruise): number` (unchanged signature, changed rule) and the new `countUnresolvedPorts(cruise: Cruise): number`, both exported from `frontend/src/components/Cruise/cruisePorts.ts`. Task 2 imports from the same module.

- [ ] **Step 1: Rewrite the existing test to the new rule**

The current test at line 130 encodes the *old* rule and must change — this is
a deliberate rule change made by the owner, not a test bending to broken code.
Replace the whole `describe("countUniquePorts with unresolved stops")` block
in `frontend/src/__tests__/components/Cruise/cruisePorts.test.ts` with:

```ts
describe("countUniquePorts with unresolved stops", () => {
  it("does NOT count unresolved stops as unique ports", () => {
    const cruise = baseCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [
        stop("s1", port(1, "Kiel"), false, 1),
        { ...stop("s2", null, false, 2), unresolvedPortName: "Taranto" },
        { ...stop("s3", null, false, 3), unresolvedPortName: " taranto " },
        stop("s4", null, true, 4),
      ],
    });
    // Only Kiel is an identifiable port. The backend's `cruisePortsUnique`
    // counts the same way; before this change the frontend said 2.
    expect(countUniquePorts(cruise)).toBe(1);
  });

  it("reports unresolved stops separately, de-duplicated by trimmed name", () => {
    const cruise = baseCruise({
      departurePort: null,
      arrivalPort: null,
      stops: [
        stop("s1", port(1, "Kiel"), false, 1),
        { ...stop("s2", null, false, 2), unresolvedPortName: "Taranto" },
        { ...stop("s3", null, false, 3), unresolvedPortName: " taranto " },
        stop("s4", null, true, 4),
      ],
    });
    expect(countUnresolvedPorts(cruise)).toBe(1);
  });

  it("returns zero unresolved for a cruise with only matched ports", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop("s1", SOUTHAMPTON, false, 1)],
    });
    expect(countUnresolvedPorts(cruise)).toBe(0);
  });
});
```

Also extend the import on line 2 of that file:

```ts
import {
  buildEffectiveTimeline,
  countUniquePorts,
  countUnresolvedPorts,
} from "../../../components/Cruise/cruisePorts";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/cruisePorts.test.ts`
Expected: FAIL — `countUnresolvedPorts is not a function`, and the first case reports `2` where `1` is expected.

- [ ] **Step 3: Implement the new rule**

Replace lines 14–31 of `frontend/src/components/Cruise/cruisePorts.ts` with:

```ts
/**
 * Unique, identifiable ports across departure / arrival / port-call stops.
 *
 * Unresolved (coordinate-less) stops are deliberately NOT counted here. They
 * are real port *calls*, but their name could not be matched to the catalogue,
 * so they cannot be de-duplicated against a matched port of the same name —
 * counting them would double a port the user visited once. This mirrors the
 * backend's `cruisePortsUnique` (backend/src/utils/cruiseStats.ts), which has
 * always excluded them. Use `countUnresolvedPorts` to show them alongside.
 */
export function countUniquePorts(cruise: Cruise): number {
  const portIds = new Set<number>();
  if (cruise.departurePort?.id != null) portIds.add(cruise.departurePort.id);
  if (cruise.arrivalPort?.id != null) portIds.add(cruise.arrivalPort.id);
  for (const stop of cruise.stops) {
    if (stop.isAtSea) continue;
    if (stop.port?.id != null) portIds.add(stop.port.id);
  }
  return portIds.size;
}

/**
 * Distinct unresolved port names, trimmed and compared case-insensitively.
 * Shown next to `countUniquePorts`, never merged into it — see that function
 * for why.
 */
export function countUnresolvedPorts(cruise: Cruise): number {
  const names = new Set<string>();
  for (const stop of cruise.stops) {
    if (stop.isAtSea || stop.port?.id != null) continue;
    if (stop.unresolvedPortName) {
      names.add(stop.unresolvedPortName.trim().toLowerCase());
    }
  }
  return names.size;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/cruisePorts.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Add the i18n strings**

In `frontend/src/i18n/resources/de/cruise.json`, directly after the
`"duplicate": "Duplizieren",` line:

```json
    "unresolvedPorts_one": "{{count}} Hafen konnte dem Katalog nicht zugeordnet werden",
    "unresolvedPorts_other": "{{count}} Häfen konnten dem Katalog nicht zugeordnet werden",
```

In `frontend/src/i18n/resources/en/cruise.json`, after the same `"duplicate"` line:

```json
    "unresolvedPorts_one": "{{count}} port could not be matched to the catalogue",
    "unresolvedPorts_other": "{{count}} ports could not be matched to the catalogue",
```

- [ ] **Step 6: Show the unresolved count in the list row**

In `frontend/src/components/Cruise/CruiseRow.tsx`, change the import on line 4:

```tsx
import { countUniquePorts, countUnresolvedPorts } from "./cruisePorts";
```

Change line 20 to:

```tsx
  const portsCount = countUniquePorts(cruise);
  const unresolvedCount = countUnresolvedPorts(cruise);
```

Replace the ports cell (line 39) with:

```tsx
      <td className="px-3 py-2 text-sm text-(--text-muted)">
        {portsCount}
        {unresolvedCount > 0 && (
          <span
            className="ml-1 text-xs"
            title={t("list.unresolvedPorts", { count: unresolvedCount })}
          >
            (+{unresolvedCount})
          </span>
        )}
      </td>
```

- [ ] **Step 7: Show it on the detail page too**

In `frontend/src/pages/CruiseDetailPage.tsx`, extend the import on line 7:

```tsx
import {
  buildEffectiveTimeline,
  countUniquePorts,
  countUnresolvedPorts,
} from "../components/Cruise/cruisePorts";
```

Change line 113 to:

```tsx
  const portsCount = countUniquePorts(cruise);
  const unresolvedCount = countUnresolvedPorts(cruise);
```

Replace line 157, which currently reads
`{portsCount} {t("field.ports", { count: portsCount })}`, with:

```tsx
              {portsCount} {t("field.ports", { count: portsCount })}
              {unresolvedCount > 0 && (
                <span
                  className="ml-1 text-xs"
                  title={t("list.unresolvedPorts", { count: unresolvedCount })}
                >
                  (+{unresolvedCount})
                </span>
              )}
```

Do not invent a second wording — reuse the `list.unresolvedPorts` key added in
step 5.

- [ ] **Step 8: Run the full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: PASS. `sortCruises.ts` also calls `countUniquePorts`; sorting by the
ports column now sorts by identifiable ports, which is the number displayed
first — that is intended, and its existing test should still pass. If it does
not, read it before changing it.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/Cruise/cruisePorts.ts \
        frontend/src/components/Cruise/CruiseRow.tsx \
        frontend/src/pages/CruiseDetailPage.tsx \
        frontend/src/i18n/resources/de/cruise.json \
        frontend/src/i18n/resources/en/cruise.json \
        frontend/src/__tests__/components/Cruise/cruisePorts.test.ts
git commit -m "fix(cruise): one rule for what counts as a port"
```

---

### Task 2: The globe time slider forgets the first and last leg (defect D2)

`computeCruiseLegDates` builds its legs from stops that have a port. Departure
and arrival ports live on the `Cruise` row, not in `cruise_stops`, so they are
missing. The server geometry *does* include them, and `GlobeView` pairs the two
by the key `` `${fromPortId}:${toPortId}` `` — so for the first and last leg the
lookup misses and those legs silently vanish in slider mode. A minimal A-to-B
cruise with no stop list gets no legs at all.

The fix puts the sequence rule in one place: a timed variant of the effective
sequence that both `effectivePortSequence` and the slider consume.

**Files:**
- Modify: `frontend/src/components/Cruise/cruisePorts.ts:33-51`
- Modify: `frontend/src/components/Globe/timeSliderUtils.ts:1,38-71`
- Test: `frontend/src/__tests__/components/Globe/timeSliderUtils.test.ts`

**Interfaces:**
- Consumes: `frontend/src/components/Cruise/cruisePorts.ts` from Task 1.
- Produces: `EffectiveSequenceEntry { port: Port; dayNumber: number; arrivalTime: string | null; departureTime: string | null }` and `effectiveTimedSequence(cruise: Cruise): EffectiveSequenceEntry[]`, both exported from `cruisePorts.ts`. `effectivePortSequence` keeps its exact signature `(cruise: Cruise) => Port[]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/components/Globe/timeSliderUtils.test.ts`,
using that file's own fixture helpers — `port(id, name?)`, `stop(overrides)`
(an overrides object, **not** positional arguments) and `baseCruise(overrides)`,
all defined at the top of the file. Do not redefine them.

```ts
describe("computeCruiseLegDates includes departure and arrival ports", () => {
  const HAMBURG = port(10, "Hamburg");
  const SOUTHAMPTON = port(11, "Southampton");
  const LISBON = port(12, "Lisbon");

  it("produces two legs for departure → one stop → arrival", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop({ id: "s1", portId: SOUTHAMPTON.id, port: SOUTHAMPTON, dayNumber: 2 })],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([
      [HAMBURG.id, SOUTHAMPTON.id],
      [SOUTHAMPTON.id, LISBON.id],
    ]);
  });

  it("produces one leg for a cruise with no stops at all", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs).toHaveLength(1);
    expect(legs[0].fromPortId).toBe(HAMBURG.id);
    expect(legs[0].toPortId).toBe(LISBON.id);
    expect(legs[0].startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(legs[0].endDate.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("does not duplicate a departure port that is also the first port call", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [
        stop({ id: "s1", portId: HAMBURG.id, port: HAMBURG, dayNumber: 1 }),
        stop({ id: "s2", portId: SOUTHAMPTON.id, port: SOUTHAMPTON, dayNumber: 2 }),
      ],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([
      [HAMBURG.id, SOUTHAMPTON.id],
      [SOUTHAMPTON.id, LISBON.id],
    ]);
  });
});
```

Note the second case: `baseCruise` in this file defaults `startDate` and
`endDate` to `null`, so both must be set explicitly or every leg falls out for
want of a date.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest --run src/__tests__/components/Globe/timeSliderUtils.test.ts`
Expected: FAIL — the first case returns `[]` (only one port stop, so the old
guard `portStops.length < 2` bails out), the second returns `[]` as well.

- [ ] **Step 3: Add the timed sequence helper**

Replace lines 33–51 of `frontend/src/components/Cruise/cruisePorts.ts`
(the `effectivePortSequence` block) with:

```ts
/** One entry of the effective itinerary, with whatever timing it carries.
 *  Departure and arrival ports have no stop row, so they borrow the cruise's
 *  own start/end timestamps. */
export interface EffectiveSequenceEntry {
  port: Port;
  dayNumber: number;
  arrivalTime: string | null;
  departureTime: string | null;
}

/**
 * Ordered port-call sequence including departure and arrival ports, carrying
 * each entry's timing (sea days excluded). This is the single source for the
 * itinerary order on the frontend — map layers, leg pairing and the globe
 * time slider all read it, so they cannot drift apart. Mirrors the backend's
 * `buildEffectivePortSequence` (backend/src/shared/cruise/portSequence.ts).
 *
 * Dedupe rule, same as the backend: departure/arrival are skipped when they
 * equal the first/last port call — parsers often repeat the embark port as
 * day 1.
 */
export function effectiveTimedSequence(cruise: Cruise): EffectiveSequenceEntry[] {
  const seq: EffectiveSequenceEntry[] = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((s) => ({
      port: s.port as Port,
      dayNumber: s.dayNumber,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
    }));

  if (cruise.departurePort && cruise.departurePort.id !== seq[0]?.port.id) {
    seq.unshift({
      port: cruise.departurePort,
      dayNumber: 1,
      arrivalTime: null,
      departureTime: cruise.startDate,
    });
  }
  if (cruise.arrivalPort && cruise.arrivalPort.id !== seq[seq.length - 1]?.port.id) {
    seq.push({
      port: cruise.arrivalPort,
      dayNumber: (seq[seq.length - 1]?.dayNumber ?? 0) + 1,
      arrivalTime: cruise.endDate,
      departureTime: null,
    });
  }
  return seq;
}

/** Ports only, in itinerary order. Thin projection of
 *  `effectiveTimedSequence` so there is exactly one ordering rule. */
export function effectivePortSequence(cruise: Cruise): Port[] {
  return effectiveTimedSequence(cruise).map((e) => e.port);
}
```

- [ ] **Step 4: Rewrite `computeCruiseLegDates` to use it**

In `frontend/src/components/Globe/timeSliderUtils.ts`, add to the imports at
the top of the file:

```ts
import {
  effectiveTimedSequence,
  type EffectiveSequenceEntry,
} from "../Cruise/cruisePorts";
```

Replace the whole `computeCruiseLegDates` function (lines 32–71) with:

```ts
/**
 * Per-leg dates for one cruise. Returns an empty list if the cruise has no
 * usable startDate AND no per-stop times — there's nothing to pin a date to.
 *
 * Walks the SAME effective sequence the geometry endpoint uses, departure and
 * arrival ports included. Building it from stop rows alone (as this did until
 * 2026-08-16) dropped the first and last leg, because those two ports live on
 * the cruise row — and `GlobeView` pairs geometry to dates by
 * `fromPortId:toPortId`, so those legs simply vanished in slider mode.
 */
export const computeCruiseLegDates = (cruise: Cruise): CruiseLegDates[] => {
  const cruiseStart = safeDate(cruise.startDate);
  const seq = effectiveTimedSequence(cruise);
  if (seq.length < 2) return [];

  const entryDate = (e: EffectiveSequenceEntry, which: "arrival" | "departure"): Date | null => {
    const explicit = safeDate(which === "arrival" ? e.arrivalTime : e.departureTime);
    if (explicit) return explicit;
    if (cruiseStart) {
      // dayNumber is 1-based. Day 1 = cruiseStart at midnight UTC.
      return new Date(cruiseStart.getTime() + (e.dayNumber - 1) * ONE_DAY_MS);
    }
    return null;
  };

  const out: CruiseLegDates[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    const start = entryDate(from, "departure") ?? entryDate(from, "arrival");
    const end = entryDate(to, "arrival") ?? entryDate(to, "departure");
    if (!start || !end) continue;
    out.push({
      cruiseId: cruise.id,
      fromPortId: from.port.id,
      toPortId: to.port.id,
      startDate: start,
      // If the data is corrupt and end < start, force a zero-length window so
      // the leg appears at exactly start and stays.
      endDate: end.getTime() < start.getTime() ? start : end,
    });
  }
  return out;
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest --run src/__tests__/components/Globe/timeSliderUtils.test.ts`
Expected: PASS, including every pre-existing case in that file. If an older
case now returns more legs than it did, that is the defect being fixed — read
the case, confirm the extra leg is the departure or arrival one, and update
its expectation with a comment saying so.

- [ ] **Step 6: Run the full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: PASS. Watch for other consumers of `effectivePortSequence` —
`cruiseArcsLayer` and `cruisePortsLayer` have tests; their behaviour must not
change, because the projection is deliberately identical to the old function.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Cruise/cruisePorts.ts \
        frontend/src/components/Globe/timeSliderUtils.ts \
        frontend/src/__tests__/components/Globe/timeSliderUtils.test.ts
git commit -m "fix(globe): the time slider was missing every first and last leg"
```

---

### Task 3: The backfill script expects the wrong leg count (defect D3)

`backfillCruiseLegs.ts` computes `expectedLegs = portCallCount - 1` from stop
rows only, while `recomputeLegsForCruise` builds its sequence with
`buildEffectivePortSequence` — departure and arrival included. The script
therefore judges correct cruises to be out of date, and it is exactly the
instrument the stage-4 migration would otherwise be trusted to measure with.

Two changes: use the same sequence rule, and stop the module from running its
`main()` on import so it can be unit-tested at all.

**Files:**
- Modify: `backend/src/scripts/backfillCruiseLegs.ts:21-25,44-59,103-106`
- Create: `backend/src/scripts/__tests__/backfillCruiseLegs.test.ts`

**Interfaces:**
- Consumes: `buildEffectivePortSequence` from `backend/src/shared/cruise/portSequence.ts` — existing, signature `<P extends { id: number }>(departurePort: P | null | undefined, portCalls: P[], arrivalPort: P | null | undefined) => P[]`.
- Produces: `expectedLegCount(cruise: ExpectedLegInput): number` exported from `backend/src/scripts/backfillCruiseLegs.ts`, where `ExpectedLegInput = { departurePortId: number | null; arrivalPortId: number | null; stops: Array<{ portId: number | null }> }`.

- [ ] **Step 1: Guard the module entrypoint**

This must happen first: without it, importing the module in a test opens a
Prisma connection and runs the backfill against whatever database the test
environment points at. Replace lines 103–106 of
`backend/src/scripts/backfillCruiseLegs.ts` with:

```ts
// Only run when invoked as a script. Without this guard, importing the module
// (a unit test does) would execute the backfill against the live database.
// Same pattern as scripts/recheckAchievements.ts.
if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill] fatal:", err);
    void prisma.$disconnect().finally(() => process.exit(1));
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/scripts/__tests__/backfillCruiseLegs.test.ts`:

```ts
import { expectedLegCount } from "../backfillCruiseLegs";

describe("expectedLegCount", () => {
  it("counts departure + port calls + arrival, like recomputeLegsForCruise", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 4,
        stops: [{ portId: 2 }, { portId: 3 }],
      }),
    ).toBe(3); // 1 → 2 → 3 → 4
  });

  it("does not double-count a departure port repeated as the first stop", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 1,
        stops: [{ portId: 1 }, { portId: 2 }, { portId: 1 }],
      }),
    ).toBe(2); // 1 → 2 → 1
  });

  it("gives one leg to a cruise whose itinerary is only departure and arrival", () => {
    expect(
      expectedLegCount({ departurePortId: 1, arrivalPortId: 2, stops: [] }),
    ).toBe(1);
  });

  it("ignores stops without a port", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 3,
        stops: [{ portId: null }, { portId: 2 }, { portId: null }],
      }),
    ).toBe(2); // 1 → 2 → 3
  });

  it("gives zero legs when there is nothing to connect", () => {
    expect(
      expectedLegCount({ departurePortId: null, arrivalPortId: null, stops: [] }),
    ).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npm test -- --forceExit src/scripts/__tests__/backfillCruiseLegs.test.ts`
Expected: FAIL — `expectedLegCount` is not exported from that module.

- [ ] **Step 4: Implement `expectedLegCount` and use it**

In `backend/src/scripts/backfillCruiseLegs.ts`, extend the imports (lines 21–25):

```ts
import { prisma } from "../db";
import {
  recomputeLegsForCruise,
  ORCHESTRATOR_VERSION,
} from "../services/cruiseDistance/cruiseLegService";
import { buildEffectivePortSequence } from "../shared/cruise/portSequence";
```

Add above `backfill`:

```ts
export interface ExpectedLegInput {
  departurePortId: number | null;
  arrivalPortId: number | null;
  /** Port-call stops in itinerary order (sea days already excluded). */
  stops: Array<{ portId: number | null }>;
}

/**
 * How many legs `recomputeLegsForCruise` will produce for this cruise.
 *
 * Must use the SAME sequence rule as the recompute, which is why it goes
 * through `buildEffectivePortSequence`. The previous `portCallCount - 1`
 * ignored the departure and arrival ports — those live on the cruise row, not
 * in `cruise_stops` — so this script judged correct cruises to be out of date
 * and would have been the wrong ruler for any migration that trusted it.
 */
export function expectedLegCount(cruise: ExpectedLegInput): number {
  const portCalls = cruise.stops
    .filter((s): s is { portId: number } => s.portId !== null)
    .map((s) => ({ id: s.portId }));
  const sequence = buildEffectivePortSequence(
    cruise.departurePortId !== null ? { id: cruise.departurePortId } : null,
    portCalls,
    cruise.arrivalPortId !== null ? { id: cruise.arrivalPortId } : null,
  );
  return Math.max(0, sequence.length - 1);
}
```

Replace the query (lines 44–53) with one that fetches what the rule needs, in
itinerary order — the dedupe compares against the first and last port call, so
order matters:

```ts
  const cruises = await prisma.cruise.findMany({
    select: {
      id: true,
      departurePortId: true,
      arrivalPortId: true,
      stops: {
        where: { isAtSea: false, portId: { not: null } },
        orderBy: { dayNumber: "asc" },
        select: { portId: true },
      },
      legs: { select: { routerVersion: true } },
    },
  });
```

Replace lines 57–58 with:

```ts
    const expectedLegs = expectedLegCount(cruise);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npm test -- --forceExit src/scripts/__tests__/backfillCruiseLegs.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 6: Prove the script agrees with reality on the dev database**

Run against the dev database, dry-run only — this is the acceptance criterion
for the whole task:

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx tsx src/scripts/backfillCruiseLegs.ts
```

Expected: on a database whose legs were computed by the current orchestrator,
`recomputed` is 0 and the cruises land in `upToDate` or `zeroLegCruises`.
Before this change, cruises with a departure or arrival port were counted as
needing a recompute. If any cruise still reports as out of date, do NOT adjust
the expectation to match — find out why, because that is the defect this task
exists to remove.

- [ ] **Step 7: Run the full backend gate**

Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
Expected: PASS. The backend suite needs PostgreSQL; a red suite here is far
more often the environment (connection limit, worker count) than the change —
`jest.config.js` is deliberately set to one worker, leave it there.

- [ ] **Step 8: Commit**

```bash
git add backend/src/scripts/backfillCruiseLegs.ts \
        backend/src/scripts/__tests__/backfillCruiseLegs.test.ts
git commit -m "fix(cruise): the leg backfill was measuring with the wrong ruler"
```

---

## Done when

- [ ] A cruise with unresolved stops shows the same port count on the list row, the detail page and the backend statistics, with the unresolved ones visible next to it rather than folded in.
- [ ] A cruise with only a departure and an arrival port produces one leg in the globe time slider, and it is drawn in live mode.
- [ ] `backfillCruiseLegs` dry-run reports zero cruises needing a recompute on an untouched dev database.
- [ ] Both gates green: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` and `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`.
- [ ] Browser check, not just green tests: open a cruise with unresolved stops and confirm the `(+n)` reads correctly in DE and EN; open the globe in slider mode and confirm the first leg of a cruise appears. Green unit tests have hidden a visibly broken UI in this repo before.

## Not in this plan

Stage 1 is repair only. `CruiseLegRoute`, the map editor, excursions,
`CruisePlace`, the fourth stop state and the generic leg endpoints are stages
2–5 and get their own plans. Do not start them here.
