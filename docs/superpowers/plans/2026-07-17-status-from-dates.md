# Status From Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Temporal statuses (flight scheduled/flown, cruise scheduled/in_progress/flown, trip planned/in_progress/completed) become derived from dates — write paths derive, an hourly sweep converges, the UI drops the status pickers (only "Storniert" stays a checkbox).

**Architecture:** Materialized derivation (owner's architecture B): three pure derivers in one module are the single source of truth; route write paths call them (scheduled/flown inputs demoted to hints); a sweep service generalizes and RETIRES the two existing one-way flips; consumers keep reading the stored columns unchanged.

**Tech Stack:** Express + Prisma + Zod + Jest (real dev DB), node-cron, React + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-status-from-dates-design.md`
**Branch:** `feat/status-from-dates` (exists; spec committed 30fb57fc)

## Global Constraints

- `any` FORBIDDEN; strict TS; double quotes; printWidth 100; Pino logger DEFAULT import.
- Passthrough statuses are NEVER derived or swept: `cancelled`, `historical`, `duplicated` (flights); `cancelled`, `historical` (cruises). Trips have no passthrough.
- Slack windows COPY the existing behavior exactly: flight arrival cutoff 6h (`ZOMBIE_SCHEDULED_CUTOFF_HOURS`), flight departure fallback cutoff 30h (`ZOMBIE_DEPARTURE_CUTOFF_HOURS`), cruise slack 48h (`PAST_CRUISE_CUTOFF_HOURS`).
- API compatibility: Zod schemas KEEP accepting the full status enums; `scheduled`/`flown` inputs are hints overridden by derivation; NEVER 400 on a status field (mobile app lags releases).
- Sweep flip marker on flights: `lastModifiedBy: "status_sweep"`.
- DE + EN i18n together. `useTranslation` from the project wrapper.
- Backend tests: real dev DB, synthetic usernames, user-cascade afterAll. Commands from `backend/` resp. `frontend/`.
- Do NOT touch: achievements/stats logic, historical/duplicated import flows, depTimeSemantics handling, hotel/POI domain, Zod enum values.

## File Structure

```
backend/src/shared/statusDerivation.ts                    (NEW — 3 pure derivers + shared constants)
backend/src/shared/__tests__/statusDerivation.test.ts     (NEW)
backend/src/services/statusSweep.ts                       (NEW — sweepStatuses())
backend/src/services/__tests__/statusSweep.test.ts        (NEW)
backend/src/services/flightAutoUpdate.ts                  (MODIFY — retire transitionZombieFlights, call sweep)
backend/src/services/cruiseStatusTransition.ts            (DELETE)
backend/src/index.ts                                      (MODIFY — boot sweep run + hourly cron)
backend/src/routes/flights.ts                             (MODIFY — create ~:421/:448, update ~:927/:1047-1056)
backend/src/routes/flightsBatch.ts                        (MODIFY — create loop status)
backend/src/routes/cruises.ts                             (MODIFY — create ~:282, update)
backend/src/routes/trips.ts                               (MODIFY — create :316, update :353, segment routes)
backend/src/services/tripStatusService.ts                 (NEW — recomputeTripStatus(tripId))
backend/src/services/tripDetectionService.ts              (MODIFY — derived status on created trips)
backend/src/__tests__/statusDerivation.routes.test.ts     (NEW — route-level derive tests)
frontend/src/components/FlightEditModal.tsx               (MODIFY — select :575 → pill + Storniert)
frontend/src/components/FlightForm/FlightCompleteStep.tsx (MODIFY — select :607-610 → same)
frontend/src/components/StatusPill.tsx? — NO: reuse existing per-domain pill renderings
frontend/src/components/Cruise/CruiseEditModal.tsx        (MODIFY — status select → pill + Storniert)
frontend/src/components/Cruise/cruiseStatusStyle.ts       (MODIFY — in_progress entry)
frontend/src/types/index.ts                               (MODIFY — CruiseStatus + "in_progress")
frontend/src/components/Trips/TripModal.tsx               (MODIFY — remove status select/state)
frontend/src/components/Trips/TripsTab.tsx                (VERIFY — "Aktuell" filter matches in_progress)
frontend/src/i18n/resources/{de,en}/*.json                (MODIFY — cruise.status.in_progress, flights cancelled-checkbox label, removals)
```

---

### Task 1: Deriver module (pure, TDD)

**Files:**
- Create: `backend/src/shared/statusDerivation.ts`
- Test: `backend/src/shared/__tests__/statusDerivation.test.ts`

**Interfaces (later tasks rely on exactly these):**
```ts
export const FLIGHT_ARRIVAL_SLACK_HOURS = 6;
export const FLIGHT_DEPARTURE_SLACK_HOURS = 30;
export const CRUISE_SLACK_HOURS = 48;
export const FLIGHT_PASSTHROUGH = ["cancelled", "historical", "duplicated"] as const;
export const CRUISE_PASSTHROUGH = ["cancelled", "historical"] as const;

export function deriveFlightStatus(input: {
  departureTime: Date | null; arrivalTime: Date | null; current: string; now?: Date;
}): string;
export function deriveCruiseStatus(input: {
  startDate: Date | null; endDate: Date | null; current: string; now?: Date;
}): string;
export function deriveTripStatus(input: {
  earliestStart: Date | null; latestEnd: Date | null; now?: Date;
}): "planned" | "in_progress" | "completed" | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
import {
  deriveFlightStatus,
  deriveCruiseStatus,
  deriveTripStatus,
} from "../statusDerivation";

const H = 60 * 60 * 1000;
const now = new Date("2026-07-17T12:00:00Z");
const past = (h: number) => new Date(now.getTime() - h * H);
const future = (h: number) => new Date(now.getTime() + h * H);

describe("deriveFlightStatus", () => {
  it("passes through cancelled/historical/duplicated untouched", () => {
    for (const s of ["cancelled", "historical", "duplicated"]) {
      expect(
        deriveFlightStatus({ departureTime: past(100), arrivalTime: past(99), current: s, now })
      ).toBe(s);
    }
  });

  it("arrival more than 6h past -> flown; within slack -> scheduled", () => {
    expect(
      deriveFlightStatus({ departureTime: past(9), arrivalTime: past(7), current: "scheduled", now })
    ).toBe("flown");
    expect(
      deriveFlightStatus({ departureTime: past(7), arrivalTime: past(5), current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("future-dated 'flown' reverts to scheduled (the zombie-anomaly killer)", () => {
    expect(
      deriveFlightStatus({ departureTime: future(24), arrivalTime: future(26), current: "flown", now })
    ).toBe("scheduled");
  });

  it("null arrival falls back to departure + 30h", () => {
    expect(
      deriveFlightStatus({ departureTime: past(31), arrivalTime: null, current: "scheduled", now })
    ).toBe("flown");
    expect(
      deriveFlightStatus({ departureTime: past(29), arrivalTime: null, current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("no dates at all keeps the current status", () => {
    expect(
      deriveFlightStatus({ departureTime: null, arrivalTime: null, current: "flown", now })
    ).toBe("flown");
  });
});

describe("deriveCruiseStatus", () => {
  it("passes through cancelled/historical", () => {
    for (const s of ["cancelled", "historical"]) {
      expect(
        deriveCruiseStatus({ startDate: past(100), endDate: past(50), current: s, now })
      ).toBe(s);
    }
  });

  it("future start -> scheduled; between start and end -> in_progress; past end+48h -> flown", () => {
    expect(
      deriveCruiseStatus({ startDate: future(24), endDate: future(120), current: "scheduled", now })
    ).toBe("scheduled");
    expect(
      deriveCruiseStatus({ startDate: past(24), endDate: future(72), current: "scheduled", now })
    ).toBe("in_progress");
    expect(
      deriveCruiseStatus({ startDate: past(200), endDate: past(49), current: "scheduled", now })
    ).toBe("flown");
  });

  it("end within the 48h slack stays in_progress", () => {
    expect(
      deriveCruiseStatus({ startDate: past(200), endDate: past(47), current: "flown", now })
    ).toBe("in_progress");
  });

  it("missing end: no in_progress — scheduled until start+48h past, then flown", () => {
    expect(
      deriveCruiseStatus({ startDate: past(47), endDate: null, current: "scheduled", now })
    ).toBe("scheduled");
    expect(
      deriveCruiseStatus({ startDate: past(49), endDate: null, current: "scheduled", now })
    ).toBe("flown");
  });

  it("no dates keeps current", () => {
    expect(deriveCruiseStatus({ startDate: null, endDate: null, current: "flown", now })).toBe(
      "flown"
    );
  });
});

describe("deriveTripStatus", () => {
  it("null without dated segments", () => {
    expect(deriveTripStatus({ earliestStart: null, latestEnd: null, now })).toBeNull();
  });
  it("future start -> planned; spanning now -> in_progress; past end -> completed", () => {
    expect(deriveTripStatus({ earliestStart: future(24), latestEnd: future(72), now })).toBe(
      "planned"
    );
    expect(deriveTripStatus({ earliestStart: past(24), latestEnd: future(24), now })).toBe(
      "in_progress"
    );
    expect(deriveTripStatus({ earliestStart: past(72), latestEnd: past(24), now })).toBe(
      "completed"
    );
  });
  it("start-only trips: past start counts as completed, future as planned", () => {
    expect(deriveTripStatus({ earliestStart: past(24), latestEnd: null, now })).toBe("completed");
    expect(deriveTripStatus({ earliestStart: future(24), latestEnd: null, now })).toBe("planned");
  });
});
```

- [ ] **Step 2: RED run**

Run: `npm test -- --forceExit --runTestsByPath src/shared/__tests__/statusDerivation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Single source of truth for temporal status derivation (spec
 * 2026-07-17-status-from-dates). The stored status columns are a CACHE of
 * these functions: write paths call them, the hourly sweep converges drift.
 * Slack constants copy the retired one-way flips exactly
 * (zombie flip 6h/30h, past-cruise 48h).
 */
export const FLIGHT_ARRIVAL_SLACK_HOURS = 6;
export const FLIGHT_DEPARTURE_SLACK_HOURS = 30;
export const CRUISE_SLACK_HOURS = 48;
export const FLIGHT_PASSTHROUGH = ["cancelled", "historical", "duplicated"] as const;
export const CRUISE_PASSTHROUGH = ["cancelled", "historical"] as const;

const H = 60 * 60 * 1000;

export function deriveFlightStatus(input: {
  departureTime: Date | null;
  arrivalTime: Date | null;
  current: string;
  now?: Date;
}): string {
  const { departureTime, arrivalTime, current } = input;
  if ((FLIGHT_PASSTHROUGH as readonly string[]).includes(current)) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  if (arrivalTime != null) {
    return nowMs - arrivalTime.getTime() > FLIGHT_ARRIVAL_SLACK_HOURS * H ? "flown" : "scheduled";
  }
  if (departureTime != null) {
    return nowMs - departureTime.getTime() > FLIGHT_DEPARTURE_SLACK_HOURS * H
      ? "flown"
      : "scheduled";
  }
  return current;
}

export function deriveCruiseStatus(input: {
  startDate: Date | null;
  endDate: Date | null;
  current: string;
  now?: Date;
}): string {
  const { startDate, endDate, current } = input;
  if ((CRUISE_PASSTHROUGH as readonly string[]).includes(current)) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  const slack = CRUISE_SLACK_HOURS * H;
  if (startDate == null && endDate == null) return current;
  if (startDate != null && nowMs < startDate.getTime()) return "scheduled";
  if (endDate != null) {
    return nowMs - endDate.getTime() > slack ? "flown" : "in_progress";
  }
  // start only: no in_progress without an end — flown once start+slack is past
  return startDate != null && nowMs - startDate.getTime() > slack ? "flown" : "scheduled";
}

export function deriveTripStatus(input: {
  earliestStart: Date | null;
  latestEnd: Date | null;
  now?: Date;
}): "planned" | "in_progress" | "completed" | null {
  const { earliestStart, latestEnd } = input;
  if (earliestStart == null && latestEnd == null) return null;
  const nowMs = (input.now ?? new Date()).getTime();
  const start = earliestStart ?? latestEnd!;
  const end = latestEnd ?? earliestStart!;
  if (nowMs < start.getTime()) return "planned";
  if (nowMs > end.getTime()) return "completed";
  return "in_progress";
}
```

- [ ] **Step 4: GREEN run** — same command, expect 12/12 PASS.
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` clean, then:

```bash
git add backend/src/shared/statusDerivation.ts backend/src/shared/__tests__/statusDerivation.test.ts
git commit -m "feat(status): pure derivers for flight/cruise/trip temporal status"
```

---

### Task 2: Sweep service (TDD, real DB)

**Files:**
- Create: `backend/src/services/statusSweep.ts`
- Test: `backend/src/services/__tests__/statusSweep.test.ts`

**Interfaces:**
- Produces: `export async function sweepStatuses(now?: Date): Promise<{ flights: number; cruises: number; trips: number }>` (flip counts).
- Consumes: Task 1 constants + `deriveTripStatus`. Flight/cruise sweeps are SQL-side `updateMany` (scale); the trip sweep loads trips with segment date aggregates and updates diffs.

- [ ] **Step 1: Write the failing tests** — real-DB (username "statussweeptest", user-cascade afterAll; flights need depIata/arrIata/depLat/depLon/arrLat/arrLon per schema — copy the fixture idiom from `src/scripts/__tests__/backfillBookingPrices.test.ts`):

```ts
import { prisma } from "../../db";
import { sweepStatuses } from "../statusSweep";

const H = 60 * 60 * 1000;

describe("sweepStatuses", () => {
  let userId: string;
  const past = (h: number) => new Date(Date.now() - h * H);
  const future = (h: number) => new Date(Date.now() + h * H);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statussweeptest" } });
    const user = await prisma.user.create({
      data: { username: "statussweeptest", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function flight(over: Record<string, unknown>) {
    return prisma.flight.create({
      data: {
        userId, flightNumber: "SW1", depIata: "FRA", arrIata: "JFK",
        depLat: 50.03, depLon: 8.57, arrLat: 40.64, arrLon: -73.78,
        status: "scheduled", ...over,
      },
    });
  }

  it("flips stale scheduled flights to flown and future flown back to scheduled", async () => {
    const stale = await flight({ arrivalTime: past(7) });
    const zombie = await flight({ status: "flown", departureTime: future(24), arrivalTime: future(26) });
    const cancelled = await flight({ status: "cancelled", arrivalTime: past(100) });
    await sweepStatuses();
    expect((await prisma.flight.findUnique({ where: { id: stale.id } }))?.status).toBe("flown");
    const flipped = await prisma.flight.findUnique({ where: { id: zombie.id } });
    expect(flipped?.status).toBe("scheduled");
    expect(flipped?.lastModifiedBy).toBe("status_sweep");
    expect((await prisma.flight.findUnique({ where: { id: cancelled.id } }))?.status).toBe("cancelled");
  });

  it("moves cruises through scheduled -> in_progress -> flown and leaves passthroughs", async () => {
    const running = await prisma.cruise.create({
      data: { userId, name: "SweepCruise", status: "scheduled", startDate: past(24), endDate: future(72) },
    });
    const done = await prisma.cruise.create({
      data: { userId, name: "DoneCruise", status: "scheduled", startDate: past(300), endDate: past(60) },
    });
    const hist = await prisma.cruise.create({
      data: { userId, name: "HistCruise", status: "historical", startDate: past(300), endDate: past(60) },
    });
    await sweepStatuses();
    expect((await prisma.cruise.findUnique({ where: { id: running.id } }))?.status).toBe("in_progress");
    expect((await prisma.cruise.findUnique({ where: { id: done.id } }))?.status).toBe("flown");
    expect((await prisma.cruise.findUnique({ where: { id: hist.id } }))?.status).toBe("historical");
  });

  it("derives trip status from segment dates", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "SweepTrip", status: "completed" } });
    await flight({ tripId: trip.id, departureTime: past(24), arrivalTime: past(22) });
    await flight({ tripId: trip.id, departureTime: future(24), arrivalTime: future(26) });
    await sweepStatuses();
    expect((await prisma.trip.findUnique({ where: { id: trip.id } }))?.status).toBe("in_progress");
  });

  it("is idempotent — second run flips 0", async () => {
    const second = await sweepStatuses();
    // Our rows are converged; other dev-DB users' rows may flip on the first
    // run of the day, so assert OUR rows are stable instead of global zeros.
    const mine = await prisma.flight.findMany({ where: { userId } });
    const third = await sweepStatuses();
    const mineAfter = await prisma.flight.findMany({ where: { userId } });
    expect(mineAfter).toEqual(mine);
    expect(typeof second.flights).toBe("number");
    expect(typeof third.trips).toBe("number");
  });
});
```

Note on the cruise model: `name` may not be the field (check schema — cruises may use
`shipName`/`title`). Align the fixture with the real required fields BEFORE the RED run.

- [ ] **Step 2: RED run** — module not found.

- [ ] **Step 3: Implement**

```ts
import { prisma } from "../db";
import logger from "../utils/logger";
import {
  FLIGHT_ARRIVAL_SLACK_HOURS,
  FLIGHT_DEPARTURE_SLACK_HOURS,
  CRUISE_SLACK_HOURS,
  deriveTripStatus,
} from "../shared/statusDerivation";

const H = 60 * 60 * 1000;

/**
 * Hourly convergence sweep (spec 2026-07-17-status-from-dates): makes the
 * stored temporal statuses agree with the dates. Generalizes and replaces
 * the retired one-way flips (transitionZombieFlights, transitionPastCruises).
 * Passthrough statuses (cancelled/historical/duplicated) are never touched.
 */
export async function sweepStatuses(
  now: Date = new Date()
): Promise<{ flights: number; cruises: number; trips: number }> {
  const arrivalCutoff = new Date(now.getTime() - FLIGHT_ARRIVAL_SLACK_HOURS * H);
  const departureCutoff = new Date(now.getTime() - FLIGHT_DEPARTURE_SLACK_HOURS * H);
  const cruiseCutoff = new Date(now.getTime() - CRUISE_SLACK_HOURS * H);

  // Flights: scheduled -> flown (stale) and flown -> scheduled (future-dated)
  const staleFlights = await prisma.flight.updateMany({
    where: {
      status: "scheduled",
      OR: [
        { arrivalTime: { not: null, lt: arrivalCutoff } },
        { arrivalTime: null, departureTime: { not: null, lt: departureCutoff } },
      ],
    },
    data: { status: "flown", lastModifiedBy: "status_sweep", nextApiCheckAt: null },
  });
  const futureFlown = await prisma.flight.updateMany({
    where: {
      status: "flown",
      OR: [
        { arrivalTime: { gt: now } },
        { arrivalTime: null, departureTime: { gt: now } },
      ],
    },
    data: { status: "scheduled", lastModifiedBy: "status_sweep" },
  });

  // Cruises: three-way from start/end (+slack)
  const cruiseToInProgress = await prisma.cruise.updateMany({
    where: {
      status: { in: ["scheduled", "flown"] },
      startDate: { not: null, lte: now },
      endDate: { not: null, gte: cruiseCutoff },
    },
    data: { status: "in_progress" },
  });
  const cruiseToFlown = await prisma.cruise.updateMany({
    where: {
      status: { in: ["scheduled", "in_progress"] },
      OR: [
        { endDate: { not: null, lt: cruiseCutoff } },
        { endDate: null, startDate: { not: null, lt: cruiseCutoff } },
      ],
    },
    data: { status: "flown" },
  });
  const cruiseToScheduled = await prisma.cruise.updateMany({
    where: {
      status: { in: ["flown", "in_progress"] },
      startDate: { gt: now },
    },
    data: { status: "scheduled" },
  });

  // Trips: recompute from segment date bounds, update diffs only
  const trips = await prisma.trip.findMany({
    select: {
      id: true,
      status: true,
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
    },
  });
  let tripFlips = 0;
  for (const trip of trips) {
    const starts = [
      ...trip.flights.map((f) => f.departureTime),
      ...trip.cruises.map((c) => c.startDate),
    ].filter((d): d is Date => d != null);
    const ends = [
      ...trip.flights.map((f) => f.arrivalTime ?? f.departureTime),
      ...trip.cruises.map((c) => c.endDate ?? c.startDate),
    ].filter((d): d is Date => d != null);
    const derived = deriveTripStatus({
      earliestStart: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
      latestEnd: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
      now,
    });
    if (derived != null && derived !== trip.status) {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: derived } });
      tripFlips++;
    }
  }

  const flights = staleFlights.count + futureFlown.count;
  const cruises = cruiseToInProgress.count + cruiseToFlown.count + cruiseToScheduled.count;
  if (flights + cruises + tripFlips > 0) {
    logger.info({
      operation: "status_sweep_done",
      context: { flights, cruises, trips: tripFlips },
    });
  }
  return { flights, cruises, trips: tripFlips };
}
```

CAREFUL sweep-order note: `cruiseToInProgress` includes `status: "flown"` rows whose end
is within slack/future (reverts a wrong flown), and runs BEFORE `cruiseToFlown` so a
row can't ping-pong within one sweep; `cruiseToScheduled` last catches future-dated
leftovers. Verify against the deriver tests that all three updateMany conditions
partition consistently with `deriveCruiseStatus` (the sweep test's three cruises cover
the main cells).

- [ ] **Step 4: GREEN run** — 4/4 PASS.
- [ ] **Step 5:** tsc + lint clean, commit:

```bash
git add backend/src/services/statusSweep.ts backend/src/services/__tests__/statusSweep.test.ts
git commit -m "feat(status): convergence sweep for flight/cruise/trip statuses"
```

---

### Task 3: Wire the sweep, retire the old flips

**Files:**
- Modify: `backend/src/services/flightAutoUpdate.ts` (delete `transitionZombieFlights` ~:540-618 + the `ZOMBIE_*` constants + the `transitionPastCruises` import :15; in `checkAndUpdateAllFlights` :625-631 replace both calls with `await sweepStatuses();`)
- Delete: `backend/src/services/cruiseStatusTransition.ts` (git rm; migrate any of its tests' intent into the sweep suite — check for a `cruiseStatusTransition` test file and `git rm` it too)
- Modify: `backend/src/index.ts` — add an hourly cron + boot run (mirror the `airlineLogoRefreshScheduler` wiring idiom):
  - boot (after the existing backfill blocks, own try/catch): `const counts = await sweepStatuses(); logger.info({ operation: "server_start_status_sweep", context: counts });`
  - hourly: `cron.schedule("0 * * * *", ...)` — put it in a tiny `backend/src/jobs/statusSweepScheduler.ts` with `start/stopStatusSweepScheduler` mirroring `airlineLogoRefreshScheduler.ts` (incl. both shutdown handlers), rather than inline in index.ts.
- Modify: `backend/src/services/diagnosticExport.ts:180` comment — it references transitionZombieFlights' OR-logic; update the reference to statusSweep (logic unchanged).

**Interfaces:** consumes Task 2's `sweepStatuses`. Produces: `jobs/statusSweepScheduler.ts` with `startStatusSweepScheduler()/stopStatusSweepScheduler()`.

- [ ] **Step 1:** Check for existing tests of the retired functions: `grep -rln "transitionZombieFlights\|transitionPastCruises" backend/src --include="*.test.ts"` — adapt/delete with intent preserved (the sweep suite from Task 2 already covers the behaviors).
- [ ] **Step 2:** Implement the rewiring per the file list. The scheduler file:

```ts
import cron from "node-cron";
import logger from "../utils/logger";
import { sweepStatuses } from "../services/statusSweep";

let task: cron.ScheduledTask | null = null;

export function startStatusSweepScheduler(): void {
  if (task) return;
  task = cron.schedule("0 * * * *", async () => {
    try {
      await sweepStatuses();
    } catch (error) {
      logger.warn({ operation: "status_sweep_error", message: "Hourly status sweep failed", error });
    }
  });
  logger.info({ operation: "status_sweep_scheduler_started" });
}

export function stopStatusSweepScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
```

(Verify the exact node-cron import/typing idiom against `jobs/airlineLogoRefreshScheduler.ts` and mirror it.)

- [ ] **Step 3:** Run affected suites: `npm test -- --forceExit --runTestsByPath src/services/__tests__/statusSweep.test.ts src/__tests__/flightAutoUpdate.test.ts src/__tests__/flightAutoUpdate.unit.test.ts` — adapt flightAutoUpdate tests that referenced the deleted function (preserve intent: the sweep now does it). Verify `grep -rn "transitionZombieFlights\|transitionPastCruises" backend/src` → only comments/history, ZERO live references.
- [ ] **Step 4:** tsc + lint clean, commit: `feat(status): hourly sweep scheduler replaces zombie/past-cruise flips`

---

### Task 4: Flight write paths derive

**Files:**
- Modify: `backend/src/routes/flights.ts` — create (~:421 `status: data.status` and :448 `data.status ?? 'scheduled'` feeding calculateNextApiCheckAt) and update (~:927 `if (data.status) updateData.status = data.status;` and the :1047-1056 effectiveStatus block)
- Modify: `backend/src/routes/flightsBatch.ts` — the create loop's `status: data.status`
- Test: `backend/src/__tests__/statusDerivation.routes.test.ts` (NEW — flights part)

**Interfaces:** consumes `deriveFlightStatus`, `FLIGHT_PASSTHROUGH` (Task 1).

Rule to implement at each spot (identical logic, write it as a tiny local helper in each route file or import a shared one from statusDerivation):

```ts
const effectiveStatus = (FLIGHT_PASSTHROUGH as readonly string[]).includes(data.status ?? "")
  ? data.status!
  : deriveFlightStatus({
      departureTime: departureUtc ?? null,   // the FINAL Date values being written
      arrivalTime: arrivalUtc ?? null,
      current: data.status ?? "scheduled",
    });
```

- create: `status: effectiveStatus` (and :448's nextApiCheckAt input uses `effectiveStatus`).
- update: passthrough statuses still assign directly; otherwise derive from the FINAL dep/arr values (careful: update may change times without sending status, and may send status without times — compute AFTER updateData's time fields are resolved, using `updateData.departureTime ?? existingFlight.departureTime` etc.; ALWAYS set `updateData.status = derived` when the flight is not currently in a passthrough status, so a date edit fixes the status even without a status field in the payload — but do NOT touch status when the stored status is passthrough and no status field arrived).
- batch: same as create.

- [ ] **Step 1: Failing route tests** (auth harness as in `airlines.route.test.ts`; payload shape per `createFlightSchema` — nested departure/arrival objects + departureLocal/depTimezone, copy from `flightsBatch.bookingPrice.test.ts`):

```ts
it("create: a future-dated flight with a 'flown' hint stores scheduled", ...);
it("create: a past-dated flight stores flown regardless of hint", ...);
it("create: cancelled is respected verbatim", ...);
it("update: moving the dates to the past flips status to flown without a status field", ...);
it("update: sending status 'flown' on future dates is overridden to scheduled", ...);
it("batch: rows derive like create", ...);
```

(Write them fully with the real payload builder; assert via prisma reads.)

- [ ] **Step 2: RED** — hints currently stored verbatim → tests fail.
- [ ] **Step 3:** Implement per the rule above. Also update the Zod schema comment (`schemas/flight.ts` status field): "scheduled/flown are hints — the server derives the temporal status from the dates (spec 2026-07-17)".
- [ ] **Step 4: GREEN** + neighbor suites: `src/__tests__/flights.test.ts src/__tests__/import.routes.test.ts src/__tests__/flightsBatch.bookingPrice.test.ts` — fixtures that create route-level flights with hint statuses may need expectation alignment (intent preserved: they now assert derived values). Suites seeding via prisma directly are unaffected.
- [ ] **Step 5:** tsc + lint, commit: `feat(status): flight write paths derive temporal status from dates`

---

### Task 5: Cruise write paths derive

**Files:**
- Modify: `backend/src/routes/cruises.ts` — create (~:282, `...rest` currently spreads `status`) and the update route (locate its data assembly; same pattern)
- Test: extend `backend/src/__tests__/statusDerivation.routes.test.ts` (cruise describe block)

Rule: `CRUISE_PASSTHROUGH` statuses verbatim; else `deriveCruiseStatus({ startDate, endDate, current: bodyStatus ?? "scheduled" })` computed from the FINAL date values (create: the parsed dates; update: merged with existing).

- [ ] Steps mirror Task 4: failing tests (create spanning now → `in_progress`; past → `flown`; future+`flown` hint → `scheduled`; `historical` respected; update date-change re-derives) → RED → implement → GREEN + `src/routes/__tests__/cruises.test.ts` → tsc/lint → commit `feat(status): cruise write paths derive status (incl. in_progress)`.

---

### Task 6: Trip status derives (service + write paths)

**Files:**
- Create: `backend/src/services/tripStatusService.ts`
- Modify: `backend/src/routes/trips.ts` — create :316 (`status: body.status` → derived-or-default), update :353 (drop the `body.status` honoring; log ignored field at debug), plus the segment-mutating routes in the file (assign flights, bookings link) → call recompute after
- Modify: `backend/src/routes/flightsBatch.ts` — auto-created PNR trips: recompute after linking
- Modify: `backend/src/services/tripDetectionService.ts` — created trips get derived status
- Test: extend `backend/src/__tests__/statusDerivation.routes.test.ts` (trips block)

**Interfaces:**
```ts
// tripStatusService.ts
export async function recomputeTripStatus(tripId: string): Promise<void>;
```
Implementation: load the trip's flights (departureTime/arrivalTime) + cruises
(startDate/endDate), compute bounds exactly like the sweep does (share the
bounds-extraction as an exported helper `tripDateBounds(flights, cruises)` in
`statusDerivation.ts` so sweep and service don't duplicate it — REFACTOR the Task-2
sweep to use it in this task), call `deriveTripStatus`, update when non-null and
different.

- [ ] Steps: failing tests (trip create with segments derives; trip PATCH sending status is ignored — stored value unchanged; linking a future flight to a completed trip flips it to planned/in_progress) → RED → implement (+ sweep refactor to the shared helper, its tests stay green) → GREEN + `trips`-touching suites (`src/routes/__tests__/trips.bookings.test.ts`, tripDetection tests) → tsc/lint → commit `feat(status): trip status derives from segment dates`.

---

### Task 7: Frontend — flight modals lose the status picker

**Files:**
- Modify: `frontend/src/components/FlightEditModal.tsx` (select ~:575)
- Modify: `frontend/src/components/FlightForm/FlightCompleteStep.tsx` (select ~:607-610)
- Modify: `frontend/src/i18n/resources/{de,en}/flights.json` — add `status.cancelledCheckbox` ("Storniert" / "Cancelled"), keep existing status.* labels (pills still render them)
- Tests: adapt the modals' existing test files (locate them; FlightCompleteStep has hook tests + possibly render tests)

Pattern (both files): replace the `<select>` with
1. a read-only pill showing the CURRENT stored/derived status via the existing
   status-label i18n + the flights table's pill styling (reuse the exact pill classes
   from FlightsTablePage's status column — find and reuse, don't invent), and
2. a labelled checkbox:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={form.status === "cancelled"}
    onChange={(e) => setField("status", e.target.checked ? "cancelled" : "scheduled")}
  />
  {t("flights:status.cancelledCheckbox")}
</label>
```

(`setField`/form idiom: use each file's real form-state setter. Sending "scheduled" on
uncheck is the contract — the backend re-derives.) For `historical` rows the pill shows
historical; the checkbox still toggles cancelled ↔ re-derived.
- FlightReviewModal has NO select (verified) — untouched.

- [ ] Steps: adapt/extend tests first (assert: no combobox for status; checkbox present; checking it puts "cancelled" into the submitted payload; unchecking submits "scheduled") → RED → implement → GREEN (`npx vitest --run` on the affected test files) → tsc/lint → commit `feat(status): flight modals derive — status picker replaced by cancelled checkbox`

---

### Task 8: Frontend — cruise in_progress + cruise/trip modals

**Files:**
- Modify: `frontend/src/types/index.ts` — `CruiseStatus` union + `"in_progress"`
- Modify: `frontend/src/components/Cruise/cruiseStatusStyle.ts` — add
  `in_progress: { background: "rgba(163,113,247,0.15)", color: "#a371f7" }` (purple —
  distinct from blue scheduled/green flown; matches the app's accent family)
- Modify: cruise i18n (locate the namespace with cruise status labels) — DE
  "Unterwegs" / EN "Under way" for `in_progress`, both locales
- Modify: `frontend/src/components/Cruise/CruiseEditModal.tsx` — status select → pill +
  Storniert checkbox (same pattern as Task 7)
- Modify: `frontend/src/components/Trips/TripModal.tsx` — REMOVE the status select +
  its state (:67, payload :144/:160 drop `status`)
- Verify: `frontend/src/components/Trips/TripsTab.tsx` — the "Aktuell" filter chip must
  match `in_progress` (read the filter logic; it filters `trip.status`, values now
  derived — likely already correct; add/adjust a test)
- Verify: every `cruiseStatusPillStyle` consumer (CruiseDetailPage, CruiseTooltip,
  CruiseRow) renders the new value without a crash (the Record type makes tsc catch
  missing keys — the union change forces exhaustiveness). Search cruise components for
  hardcoded `scheduled`/`flown` branching (spec gotcha) and adapt where a third value
  breaks logic.
- Tests: cruiseStatusStyle test (if exists) + modal tests + TripModal test adaptation.

- [ ] Steps: failing tests → RED → implement → GREEN + FULL frontend gate (`npx tsc --noEmit && npm run lint && npx vitest --run`) → commit `feat(status): cruise Unterwegs pill; cruise/trip modals derive`

---

### Task 9: Final gate + browser UAT (controller task)

- [ ] Backend: `npx tsc --noEmit && npm run lint && npm test -- --forceExit` (green minus known flakes; reseed dev admin after). Frontend: full gate.
- [ ] Browser UAT (fresh ports, CORS_ORIGIN set — see ledger note): flight edit modal shows pill + Storniert checkbox (no dropdown); cancel + uncancel round-trip re-derives; add-flight flow derives (future date → Geplant); cruise list shows "Unterwegs" pill for a spanning cruise (create one via UI/API); trips "Aktuell" filter shows a spanning trip; boot log shows `server_start_status_sweep` with the convergence counts; demo-seed planned rows did NOT flip (verify a seeded future flight stays Geplant).
- [ ] Ledger, whole-branch review (opus) with the deferred-minors list, merge question.

---

## Self-Review (done at plan time)

- Spec coverage: derivers §1 (T1), sweep §3 (T2+T3 incl. retirement + scheduler), write
  paths §2 flights/cruises/trips (T4/T5/T6), frontend §4 (T7/T8 incl. pill, TripModal,
  TripsTab verify), testing §5 distributed, out-of-scope respected. ✔
- Placeholder scan: T4-T6 test lists are named cases with explicit RED/GREEN steps and
  the payload-builder source named; T7/T8 delegate exact form-state idioms as NAMED
  verify-risks. No TBDs. ✔
- Type consistency: deriver signatures/constants (T1) used in T2/T4/T5; `tripDateBounds`
  introduced in T6 with an explicit refactor instruction for T2's sweep;
  `recomputeTripStatus(tripId)` consistent. ✔
