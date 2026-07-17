# Cost System First Slice — Booking-Level Total Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the parsed booking total from per-segment stamping onto the Booking row (import + backfill), make the summary stats booking-aware, add a booking-edit UI, and render per-currency totals.

**Architecture:** Backend-first: the batch import's existing PNR-grouping step gains an identical-total rule; a boot backfill applies the same rule to history; `GET /stats/summary` replaces its flight-only aggregate with a deduped helper mirroring `businessStats` semantics; a `PATCH /trips/bookings/:id` route feeds a small edit modal on the trip detail page; a shared `sumByCurrency` helper fixes the two naive multi-currency sums.

**Tech Stack:** Express + Prisma + Zod + Jest/supertest (backend, real dev DB), React + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-17-cost-booking-price-design.md`
**Branch:** `feat/cost-booking-price` (exists; spec committed)

## Global Constraints

- `any` is FORBIDDEN — `unknown` + type guards. Strict TS, double quotes, printWidth 100.
- Backend logger: `import logger from "../utils/logger"` (default export). No `console.log`.
- Zod on every new input; `useTranslation` from the project wrapper; DE + EN i18n in the same commit.
- PATCH value-guard idiom: `if (body.x !== undefined)` — a partial body must never null unsent fields.
- Booking price is ALL-IN (per-flight taxes/fees do NOT additionally count when a booking price exists). Price `0` behaves as "no price". Editing a booking NEVER mutates its flights' prices.
- Identical-price comparison is STRICT `===` (parsed from the same string) — no epsilon.
- Currency `null` compares as `"EUR"` (schema default on both models).
- Do NOT touch: `businessStats.ts`, `ticketPrice`, parser code, `frontend/src/components/Stats.tsx` (dead), FX anything.
- Backend tests run from `D:\TravStats_Projekt\TravStats\backend` (`npm test -- --forceExit --runTestsByPath <file>`), frontend from `frontend/` (`npx vitest --run <file>`). Backend tests hit the real dev DB — clean up in afterAll, use synthetic markers (usernames like "bookingpricetest"), never real user rows.

## File Structure

```
backend/src/routes/flightsBatch.ts                       (MODIFY — identical-total rule + fresh response)
backend/src/__tests__/flightsBatch.bookingPrice.test.ts  (NEW)
backend/src/scripts/backfillBookingPrices.ts             (NEW)
backend/src/scripts/__tests__/backfillBookingPrices.test.ts (NEW)
backend/src/index.ts                                     (MODIFY — boot wiring after backfillAirlineCodes, ~:417)
backend/src/utils/stats/dedupedCost.ts                   (NEW — pure helper)
backend/src/utils/stats/__tests__/dedupedCost.test.ts    (NEW)
backend/src/routes/stats.ts                              (MODIFY — computeSummary totalCost, ~:136-143 + ~:217-222)
backend/src/schemas/trip.ts                              (MODIFY — updateBookingSchema)
backend/src/routes/trips.ts                              (MODIFY — PATCH /trips/bookings/:id)
backend/src/routes/__tests__/trips.bookings.test.ts      (NEW)
frontend/src/lib/bookingCost.ts                          (NEW — sumByCurrency)
frontend/src/lib/__tests__/bookingCost.test.ts           (NEW)
frontend/src/pages/TripDetailPage.tsx                    (MODIFY — 2 sum spots + pencil + modal mount)
frontend/src/components/Trips/TripCard.tsx               (MODIFY — per-currency totals)
frontend/src/components/Trips/BookingEditModal.tsx       (NEW)
frontend/src/components/Trips/__tests__/BookingEditModal.test.tsx (NEW)
frontend/src/lib/api/trips.ts                            (MODIFY — updateBooking)
frontend/src/types/index.ts                              (MODIFY — UpdateBookingInput)
frontend/src/i18n/resources/{de,en}/trips.json           (MODIFY — bookingEdit.* keys)
```

---

### Task 1: Batch import — identical total moves to the booking, response rows fresh

**Files:**
- Modify: `backend/src/routes/flightsBatch.ts` (grouping block ~:180-225, response ~:224)
- Test: `backend/src/__tests__/flightsBatch.bookingPrice.test.ts` (NEW)

**Interfaces:**
- Consumes: existing transaction shape (`tx.booking.create`, `tx.flight.updateMany`), existing route mount (find it: `grep -rn "flightsBatch" backend/src/index.ts` — the route is POST under the flights batch path used by `src/__tests__/import.routes.test.ts`).
- Produces: response flights reflect final DB state (`bookingId`, `tripId` set; `price: null` when the total moved). Booking rows may now carry `price`/`currency` at creation.

- [ ] **Step 1: Write the failing test**

`backend/src/__tests__/flightsBatch.bookingPrice.test.ts` — copy the auth harness from `backend/src/routes/__tests__/airlines.route.test.ts` (create user via prisma + `generateToken` cookie) and the minimal-valid batch payload shape from `backend/src/__tests__/import.routes.test.ts` (IMPORTANT: align the flight-row field names with what that existing test posts; the skeleton below shows intent, not authoritative field names):

```ts
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

describe("flights batch — booking-level total price", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "bookingpricetest" } });
    const user = await prisma.user.create({
      data: { username: "bookingpricetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Flights/trips/bookings cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function makeFlight(overrides: Record<string, unknown>): Record<string, unknown> {
    // Align these fields with the payload builder in import.routes.test.ts.
    return {
      flightNumber: "LH400",
      depIata: "FRA",
      arrIata: "JFK",
      departureTime: "2024-05-01T10:00:00.000Z",
      arrivalTime: "2024-05-01T18:00:00.000Z",
      status: "flown",
      ...overrides,
    };
  }

  it("moves an identical per-segment total onto the booking and nulls segment prices", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send({
        flights: [
          makeFlight({ bookingReference: "BOOKA1", price: 500, currency: "EUR" }),
          makeFlight({
            flightNumber: "LH401",
            depIata: "JFK",
            arrIata: "FRA",
            departureTime: "2024-05-10T20:00:00.000Z",
            arrivalTime: "2024-05-11T06:00:00.000Z",
            bookingReference: "BOOKA1",
            price: 500,
            currency: "EUR",
          }),
        ],
      });
    expect(res.status).toBe(201);

    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKA1" } });
    expect(booking?.price).toBe(500);
    expect(booking?.currency).toBe("EUR");

    const flights = await prisma.flight.findMany({ where: { userId, bookingId: booking!.id } });
    expect(flights).toHaveLength(2);
    expect(flights.every((f) => f.price === null)).toBe(true);

    // Response rows must reflect the FINAL state (Codex finding: stale updateMany)
    const responseRows = (res.body.flights ?? res.body.data ?? []) as Array<{
      bookingId: string | null;
      price: number | null;
    }>;
    expect(responseRows.every((f) => f.bookingId === booking!.id)).toBe(true);
    expect(responseRows.every((f) => f.price === null)).toBe(true);
  });

  it("leaves differing per-segment prices alone (booking stays priceless)", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send({
        flights: [
          makeFlight({ bookingReference: "BOOKB2", price: 300, currency: "EUR" }),
          makeFlight({
            flightNumber: "LH405",
            bookingReference: "BOOKB2",
            price: 200,
            currency: "EUR",
            departureTime: "2024-06-01T10:00:00.000Z",
            arrivalTime: "2024-06-01T18:00:00.000Z",
          }),
        ],
      });
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKB2" } });
    expect(booking?.price).toBeNull();
    const flights = await prisma.flight.findMany({ where: { userId, bookingId: booking!.id } });
    expect(flights.map((f) => f.price).sort()).toEqual([200, 300]);
  });

  it("null-price segment in the group means no move (treated as differing)", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send({
        flights: [
          makeFlight({ bookingReference: "BOOKC3", price: 400, currency: "EUR" }),
          makeFlight({
            flightNumber: "LH407",
            bookingReference: "BOOKC3",
            departureTime: "2024-07-01T10:00:00.000Z",
            arrivalTime: "2024-07-01T18:00:00.000Z",
          }),
        ],
      });
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKC3" } });
    expect(booking?.price).toBeNull();
  });

  it("single-flight PNR: no booking, price stays on the flight", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send({ flights: [makeFlight({ bookingReference: "BOOKD4", price: 150, currency: "USD" })] });
    expect(res.status).toBe(201);
    expect(await prisma.booking.findFirst({ where: { userId, pnr: "BOOKD4" } })).toBeNull();
    const f = await prisma.flight.findFirst({ where: { userId, bookingReference: "BOOKD4" } });
    expect(f?.price).toBe(150);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- --forceExit --runTestsByPath src/__tests__/flightsBatch.bookingPrice.test.ts`
Expected: first test FAILS (`booking.price` is null today; response rows carry the stale price).
If the 201/payload shape assumptions are wrong, fix the TEST first against the real route contract (read the route + import.routes.test.ts), re-run, and only then proceed.

- [ ] **Step 3: Implement the rule + fresh response**

In `backend/src/routes/flightsBatch.ts`, inside the PNR loop replace the booking-create + updateMany:

```ts
        // Identical non-null total on every segment = the repeated booking
        // total from the email. Move it to the booking; segments become
        // priceless (the price belongs to the booking — spec 2026-07-17).
        const firstPrice = groupFlights[0]?.price ?? null;
        const firstCurrency = groupFlights[0]?.currency ?? "EUR";
        const identicalTotal =
          firstPrice != null &&
          groupFlights.every(
            (f) => f.price === firstPrice && (f.currency ?? "EUR") === firstCurrency
          );

        const booking = await tx.booking.create({
          data: {
            userId,
            tripId: trip.id,
            pnr,
            ...(identicalTotal ? { price: firstPrice, currency: firstCurrency } : {}),
          },
        });

        const flightIds = groupFlights.map((f) => f.id);
        await tx.flight.updateMany({
          where: { id: { in: flightIds } },
          data: {
            tripId: trip.id,
            bookingId: booking.id,
            ...(identicalTotal ? { price: null } : {}),
          },
        });
```

After the loop (still inside the transaction), replace `return flights;` with a fresh re-read preserving insertion order:

```ts
      // Re-read: the grouping updateMany made the in-memory rows stale
      // (old price, missing tripId/bookingId) — the response must show the
      // final state (Codex review finding, spec §1).
      const fresh = await tx.flight.findMany({
        where: { id: { in: flights.map((f) => f.id) } },
      });
      const byId = new Map(fresh.map((f) => [f.id, f]));
      return flights.map((f) => byId.get(f.id) ?? f);
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- --forceExit --runTestsByPath src/__tests__/flightsBatch.bookingPrice.test.ts`
Expected: 4/4 PASS. Also run the neighbors that exercise this route:
`npm test -- --forceExit --runTestsByPath src/__tests__/import.routes.test.ts src/__tests__/importParse.test.ts`
Expected: PASS (unchanged behavior for ungrouped/differing cases).

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint`
```bash
git add backend/src/routes/flightsBatch.ts backend/src/__tests__/flightsBatch.bookingPrice.test.ts
git commit -m "feat(cost): batch import moves an identical per-segment total onto the booking"
```

---

### Task 2: Boot backfill for existing priceless bookings

**Files:**
- Create: `backend/src/scripts/backfillBookingPrices.ts`
- Test: `backend/src/scripts/__tests__/backfillBookingPrices.test.ts` (NEW)
- Modify: `backend/src/index.ts` (insert AFTER the backfillAirlineCodes block, ~:417)

**Interfaces:**
- Produces: `export async function backfillBookingPrices(): Promise<number>` (healed count).

- [ ] **Step 1: Write the failing test**

```ts
import { prisma } from "../../db";
import { backfillBookingPrices } from "../backfillBookingPrices";

describe("backfillBookingPrices", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "bookingbackfilltest" } });
    const user = await prisma.user.create({
      data: { username: "bookingbackfilltest", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function seedBooking(prices: Array<number | null>, currency = "EUR") {
    const booking = await prisma.booking.create({ data: { userId } });
    for (const [i, price] of prices.entries()) {
      await prisma.flight.create({
        data: {
          userId,
          bookingId: booking.id,
          flightNumber: `BF${i}`,
          depIata: "FRA",
          arrIata: "JFK",
          status: "flown",
          price,
          currency,
        },
      });
    }
    return booking.id;
  }

  it("heals a priceless booking whose segments share an identical total", async () => {
    const id = await seedBooking([250, 250]);
    const healed = await backfillBookingPrices();
    expect(healed).toBeGreaterThanOrEqual(1);
    const b = await prisma.booking.findUnique({ where: { id } });
    expect(b?.price).toBe(250);
    expect(b?.currency).toBe("EUR");
    const flights = await prisma.flight.findMany({ where: { bookingId: id } });
    expect(flights.every((f) => f.price === null)).toBe(true);
  });

  it("is idempotent — a second run heals nothing more for the same data", async () => {
    const before = await prisma.booking.findMany({ where: { userId } });
    const healedAgain = await backfillBookingPrices();
    const after = await prisma.booking.findMany({ where: { userId } });
    expect(after).toEqual(before);
    // healedAgain may count OTHER users' dev-DB bookings; assert OUR rows stable, not the counter.
    expect(typeof healedAgain).toBe("number");
  });

  it("skips differing prices and single-flight bookings", async () => {
    const differing = await seedBooking([100, 200]);
    const single = await seedBooking([300]);
    await backfillBookingPrices();
    expect((await prisma.booking.findUnique({ where: { id: differing } }))?.price).toBeNull();
    expect((await prisma.booking.findUnique({ where: { id: single } }))?.price).toBeNull();
    const singleFlight = await prisma.flight.findFirst({ where: { bookingId: single } });
    expect(singleFlight?.price).toBe(300);
  });
});
```

Note: the flight `create` above uses the minimal required Flight fields — if the schema requires more (check `prisma/schema.prisma` Flight non-nullables), extend the create data minimally.

- [ ] **Step 2: RED run**

Run: `npm test -- --forceExit --runTestsByPath src/scripts/__tests__/backfillBookingPrices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`backend/src/scripts/backfillBookingPrices.ts`:

```ts
import { prisma } from "../db";
import logger from "../utils/logger";

/**
 * One-shot, idempotent backfill: bookings created priceless by earlier imports
 * whose >=2 flights all carry the identical non-null price and currency get
 * that total moved onto the booking; the segment prices are nulled (same rule
 * as the batch-import path — spec 2026-07-17-cost-booking-price). Safe to
 * re-run: healed bookings have price != null and are never matched again.
 */
export async function backfillBookingPrices(): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: { price: null },
    select: {
      id: true,
      flights: { select: { id: true, price: true, currency: true } },
    },
  });

  let healed = 0;
  for (const b of bookings) {
    if (b.flights.length < 2) continue;
    const firstPrice = b.flights[0].price;
    if (firstPrice == null) continue;
    const firstCurrency = b.flights[0].currency ?? "EUR";
    const identical = b.flights.every(
      (f) => f.price === firstPrice && (f.currency ?? "EUR") === firstCurrency
    );
    if (!identical) continue;

    await prisma.$transaction([
      prisma.booking.update({
        where: { id: b.id },
        data: { price: firstPrice, currency: firstCurrency },
      }),
      prisma.flight.updateMany({
        where: { id: { in: b.flights.map((f) => f.id) } },
        data: { price: null },
      }),
    ]);
    healed++;
  }

  if (healed > 0) {
    logger.info({ operation: "backfill_booking_prices_done", healed, scanned: bookings.length });
  }
  return healed;
}
```

`backend/src/index.ts` — directly after the backfillAirlineCodes try/catch block (~:417):

```ts
    // Backfill booking-level prices (idempotent — heals bookings created
    // priceless by pre-2.5 imports; spec 2026-07-17-cost-booking-price)
    try {
      const { backfillBookingPrices } = await import("./scripts/backfillBookingPrices");
      const healed = await backfillBookingPrices();
      if (healed > 0) {
        logger.info({ operation: "server_start_backfill_booking_prices", message: `Healed ${healed} bookings` });
      }
    } catch (error) {
      logger.warn({ operation: "server_start_backfill_booking_prices_error", message: "Failed to backfill booking prices", error });
    }
```

- [ ] **Step 4: GREEN run**

Run: `npm test -- --forceExit --runTestsByPath src/scripts/__tests__/backfillBookingPrices.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: tsc + lint + commit**

```bash
git add backend/src/scripts/backfillBookingPrices.ts backend/src/scripts/__tests__/backfillBookingPrices.test.ts backend/src/index.ts
git commit -m "feat(cost): boot backfill moves identical per-segment totals onto existing bookings"
```

---

### Task 3: Booking-aware summary totalCost

**Files:**
- Create: `backend/src/utils/stats/dedupedCost.ts`
- Test: `backend/src/utils/stats/__tests__/dedupedCost.test.ts` (NEW)
- Modify: `backend/src/routes/stats.ts` (`computeSummary`: the `prisma.flight.aggregate` entry ~:136-143 and the `costParts` block ~:217-222)

**Interfaces:**
- Produces:
  ```ts
  export interface CostFlight {
    price: number | null;
    taxes: number | null;
    fees: number | null;
    bookingId: string | null;
    booking: { price: number | null } | null;
  }
  export function computeDedupedTotalCost(flights: CostFlight[]): number; // rounded to cents
  ```

- [ ] **Step 1: Write the failing unit tests**

```ts
import { computeDedupedTotalCost, type CostFlight } from "../dedupedCost";

function f(over: Partial<CostFlight>): CostFlight {
  return { price: null, taxes: null, fees: null, bookingId: null, booking: null, ...over };
}

describe("computeDedupedTotalCost", () => {
  it("counts a booking price once across its segments (all-in: taxes/fees ignored)", () => {
    const shared = { bookingId: "b1", booking: { price: 500 } };
    expect(
      computeDedupedTotalCost([
        f({ ...shared, taxes: 50 }),
        f({ ...shared, fees: 20 }),
      ])
    ).toBe(500);
  });

  it("falls back to price + taxes + fees without a priced booking", () => {
    expect(computeDedupedTotalCost([f({ price: 100, taxes: 20, fees: 5 })])).toBe(125);
  });

  it("booking with null/zero price falls back per flight (truthiness semantics)", () => {
    expect(
      computeDedupedTotalCost([f({ bookingId: "b2", booking: { price: 0 }, price: 80 })])
    ).toBe(80);
    expect(
      computeDedupedTotalCost([f({ bookingId: "b3", booking: { price: null }, price: 60 })])
    ).toBe(60);
  });

  it("mixes booking-priced and fallback flights", () => {
    const shared = { bookingId: "b4", booking: { price: 300 } };
    expect(
      computeDedupedTotalCost([f(shared), f(shared), f({ price: 100 })])
    ).toBe(400);
  });

  it("returns 0 for empty input and rounds to cents", () => {
    expect(computeDedupedTotalCost([])).toBe(0);
    expect(computeDedupedTotalCost([f({ price: 0.105 }), f({ price: 0.105 })])).toBe(0.21);
  });
});
```

- [ ] **Step 2: RED run**

Run: `npm test -- --forceExit --runTestsByPath src/utils/stats/__tests__/dedupedCost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper + rewire computeSummary**

`backend/src/utils/stats/dedupedCost.ts`:

```ts
export interface CostFlight {
  price: number | null;
  taxes: number | null;
  fees: number | null;
  bookingId: string | null;
  booking: { price: number | null } | null;
}

/**
 * Total cost with booking dedupe — the SAME rules as businessStats.ts:52-62
 * (kept in sync by hand; businessStats' loop also attributes distance, so the
 * rule is knowingly duplicated, not shared): a booking price counts once per
 * booking and is all-in (per-flight taxes/fees NOT added on top); flights
 * without a priced booking fall back to price + taxes + fees. Truthiness
 * matches businessStats: booking price 0/null -> fallback.
 */
export function computeDedupedTotalCost(flights: CostFlight[]): number {
  const seenBookingIds = new Set<string>();
  let total = 0;
  for (const flight of flights) {
    if (flight.bookingId && flight.booking?.price) {
      if (!seenBookingIds.has(flight.bookingId)) {
        seenBookingIds.add(flight.bookingId);
        total += flight.booking.price;
      }
    } else {
      total += (flight.price ?? 0) + (flight.taxes ?? 0) + (flight.fees ?? 0);
    }
  }
  return Math.round(total * 100) / 100;
}
```

`backend/src/routes/stats.ts`:
1. Import: `import { computeDedupedTotalCost } from '../utils/stats/dedupedCost';`
2. In `computeSummary`'s `Promise.all`, REPLACE the `prisma.flight.aggregate({...})` entry with:
   ```ts
   prisma.flight.findMany({
     where,
     select: {
       price: true,
       taxes: true,
       fees: true,
       bookingId: true,
       booking: { select: { price: true } },
     },
   }),
   ```
   and rename the destructured `costAgg` to `costFlights`.
3. REPLACE the `costParts`/`totalCost` block (~:217-222) with:
   ```ts
   // Booking-aware: a booking's price counts once, not once per segment —
   // and grouped segments (price nulled by the import) still contribute
   // their booking's total (spec 2026-07-17-cost-booking-price §4).
   const totalCost = computeDedupedTotalCost(costFlights);
   ```
4. In the return, `totalCost: totalCost` stays (helper already rounds — drop the old `Math.round(totalCost * 100) / 100` wrapper).

- [ ] **Step 4: GREEN + stats suites**

Run: `npm test -- --forceExit --runTestsByPath src/utils/stats/__tests__/dedupedCost.test.ts src/routes/stats.airlines.test.ts src/routes/stats.countries.test.ts src/routes/stats.timeseries.test.ts`
Expected: all PASS (the stats route suites guard against a broken Promise.all rewire).

- [ ] **Step 5: tsc + lint + commit**

```bash
git add backend/src/utils/stats/dedupedCost.ts backend/src/utils/stats/__tests__/dedupedCost.test.ts backend/src/routes/stats.ts
git commit -m "feat(cost): summary totalCost dedupes booking prices (matches businessStats rules)"
```

---

### Task 4: PATCH /trips/bookings/:id

**Files:**
- Modify: `backend/src/schemas/trip.ts` (after `createBookingSchema`, ~:63-75)
- Modify: `backend/src/routes/trips.ts` (after the POST /trips/bookings route, ~:131-165)
- Test: `backend/src/routes/__tests__/trips.bookings.test.ts` (NEW)

**Interfaces:**
- Produces: `PATCH /api/v1/trips/bookings/:id` → `{ booking }`;
  `updateBookingSchema` + `export type UpdateBookingInput`.
  Fields: `pnr?: string(<=20)|null`, `price?: number(min 0)|null`, `currency?: /^[A-Z]{3}$/|null`.

- [ ] **Step 1: Write the failing test**

`backend/src/routes/__tests__/trips.bookings.test.ts` (auth harness copied from `airlines.route.test.ts`):

```ts
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("PATCH /api/v1/trips/bookings/:id", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let bookingId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["bookingpatch", "bookingpatch2"] } } });
    const user = await prisma.user.create({
      data: { username: "bookingpatch", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "bookingpatch2", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const booking = await prisma.booking.create({ data: { userId, pnr: "PATCH1" } });
    bookingId = booking.id;
    const flight = await prisma.flight.create({
      data: {
        userId,
        bookingId,
        flightNumber: "BP100",
        depIata: "FRA",
        arrIata: "JFK",
        status: "flown",
        price: 111,
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: otherUserId } });
    await prisma.$disconnect();
  });

  it("updates price/currency/pnr and returns the booking", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", authCookie)
      .send({ price: 999.5, currency: "USD", pnr: "PATCH1X" });
    expect(res.status).toBe(200);
    expect(res.body.booking.price).toBe(999.5);
    expect(res.body.booking.currency).toBe("USD");
    expect(res.body.booking.pnr).toBe("PATCH1X");
  });

  it("a partial body never nulls unsent fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", authCookie)
      .send({ price: 500 });
    expect(res.status).toBe(200);
    expect(res.body.booking.currency).toBe("USD");
    expect(res.body.booking.pnr).toBe("PATCH1X");
  });

  it("never mutates the flights' prices", async () => {
    const f = await prisma.flight.findUnique({ where: { id: flightId } });
    expect(f?.price).toBe(111);
  });

  it("404 for a foreign booking", async () => {
    const foreign = await prisma.booking.create({ data: { userId: otherUserId } });
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${foreign.id}`)
      .set("Cookie", authCookie)
      .send({ price: 1 });
    expect(res.status).toBe(404);
  });

  it("400 for a negative price and a bad currency", async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/trips/bookings/${bookingId}`)
          .set("Cookie", authCookie)
          .send({ price: -5 })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/v1/trips/bookings/${bookingId}`)
          .set("Cookie", authCookie)
          .send({ currency: "eur" })
      ).status
    ).toBe(400);
  });

  it("401 unauthenticated", async () => {
    const res = await request(app).patch(`/api/v1/trips/bookings/${bookingId}`).send({ price: 1 });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: RED run**

Run: `npm test -- --forceExit --runTestsByPath src/routes/__tests__/trips.bookings.test.ts`
Expected: PATCH returns 404 (route missing) → tests FAIL.

- [ ] **Step 3: Implement schema + route**

`backend/src/schemas/trip.ts` (after createBookingSchema):

```ts
export const updateBookingSchema = z.object({
  pnr: z.string().max(20).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)")
    .nullable()
    .optional(),
});
```

and to the type exports: `export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;`

`backend/src/routes/trips.ts` (directly after the POST /trips/bookings route; import `updateBookingSchema` beside the existing schema imports and `Prisma` from `@prisma/client` if not present):

```ts
/** PATCH /trips/bookings/:id — edit pnr/price/currency. Never touches the
 *  booking's flights (their prices stay whatever they are). */
router.patch("/trips/bookings/:id", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const body = updateBookingSchema.parse(req.body);

    const existing = await prisma.booking.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Booking not found", 404);

    const data: Prisma.BookingUpdateInput = {};
    if (body.pnr !== undefined) data.pnr = body.pnr;
    if (body.price !== undefined) data.price = body.price;
    if (body.currency !== undefined) data.currency = body.currency;

    const booking = await prisma.booking.update({ where: { id: existing.id }, data });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: GREEN run**

Run: `npm test -- --forceExit --runTestsByPath src/routes/__tests__/trips.bookings.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: tsc + lint + commit**

```bash
git add backend/src/schemas/trip.ts backend/src/routes/trips.ts backend/src/routes/__tests__/trips.bookings.test.ts
git commit -m "feat(cost): PATCH /trips/bookings/:id for pnr/price/currency"
```

---

### Task 5: sumByCurrency helper + TripDetailPage + TripCard per-currency totals

**Files:**
- Create: `frontend/src/lib/bookingCost.ts`
- Test: `frontend/src/lib/__tests__/bookingCost.test.ts` (NEW)
- Modify: `frontend/src/pages/TripDetailPage.tsx` (~:961-962 + logistics header ~:1065-1071; ~:1116-1117 + stats tile ~:1126)
- Modify: `frontend/src/components/Trips/TripCard.tsx` (~:52-53 + render ~:207-213)

**Interfaces:**
- Produces:
  ```ts
  export interface BookingCostInput { price: number | null; currency: string | null }
  export interface CurrencyTotal { currency: string; total: number }
  export function sumByCurrency(bookings: BookingCostInput[]): CurrencyTotal[];
  // null currency -> "EUR"; price null/<=0 skipped; EUR first, then alphabetical.
  ```

- [ ] **Step 1: Write the failing unit tests**

```ts
import { sumByCurrency } from "../bookingCost";

describe("sumByCurrency", () => {
  it("sums a single currency", () => {
    expect(sumByCurrency([{ price: 100, currency: "EUR" }, { price: 50, currency: "EUR" }]))
      .toEqual([{ currency: "EUR", total: 150 }]);
  });

  it("keeps currencies separate, EUR first, rest alphabetical", () => {
    expect(
      sumByCurrency([
        { price: 10, currency: "USD" },
        { price: 20, currency: "EUR" },
        { price: 5, currency: "CHF" },
      ])
    ).toEqual([
      { currency: "EUR", total: 20 },
      { currency: "CHF", total: 5 },
      { currency: "USD", total: 10 },
    ]);
  });

  it("treats null currency as EUR and skips null/zero prices", () => {
    expect(
      sumByCurrency([
        { price: 30, currency: null },
        { price: null, currency: "USD" },
        { price: 0, currency: "USD" },
      ])
    ).toEqual([{ currency: "EUR", total: 30 }]);
  });

  it("returns [] for no priced bookings", () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
```

- [ ] **Step 2: RED run**

Run: `npx vitest --run src/lib/__tests__/bookingCost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

`frontend/src/lib/bookingCost.ts`:

```ts
export interface BookingCostInput {
  price: number | null;
  currency: string | null;
}

export interface CurrencyTotal {
  currency: string;
  total: number;
}

/** Per-currency booking totals. Currencies are NEVER summed together
 *  (no FX in 2.5); null currency means the schema default EUR; a null or
 *  zero price counts as "no price". EUR sorts first, the rest alphabetical. */
export function sumByCurrency(bookings: BookingCostInput[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const b of bookings) {
    if (b.price == null || b.price <= 0) continue;
    const currency = b.currency ?? "EUR";
    totals.set(currency, (totals.get(currency) ?? 0) + b.price);
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => {
      if (a.currency === "EUR") return -1;
      if (b.currency === "EUR") return 1;
      return a.currency.localeCompare(b.currency);
    });
}
```

- [ ] **Step 4: Rewire TripDetailPage (both spots)**

Import `sumByCurrency`. In the logistics component (~:961):

```tsx
  const costTotals = sumByCurrency(bookings);
```
(delete the old `totalCost`/`currency` lines) and the header block becomes:

```tsx
            {costTotals.length > 0 && (
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                · {t("trips:detail.logistics.totalBooked")}:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {costTotals.map((c) => `${c.currency} ${Math.round(c.total)}`).join(" + ")}
                </strong>
              </span>
            )}
```

In `TripStatsRow` (~:1116): replace the two lines with
`const costTotals = sumByCurrency(trip.bookings ?? []);` and the tile:

```tsx
      <StatTile
        value={
          costTotals.length > 0
            ? costTotals.map((c) => `${c.currency} ${Math.round(c.total)}`).join(" + ")
            : "—"
        }
        label={t("trips:totalCost")}
      />
```

- [ ] **Step 5: Rewire TripCard**

`TripCard.tsx` has a LOCAL `formatCurrency(total, currency, lang)` (verify its exact
signature in the file — GitNexus lists it as a local symbol). Replace ~:52-53 with
`const costTotals = sumByCurrency(trip.bookings ?? []);` and the stat render (~:207-213):

```tsx
            value={
              features.enableCostTracking && costTotals.length > 0
                ? costTotals
                    .map((c) => formatCurrency(c.total, c.currency, i18n.language))
                    .join(" + ")
                : undefined
            }
```
(keep the surrounding prop structure exactly as it is — only the value expression changes;
adapt to the actual prop name/shape at ~:207).

- [ ] **Step 6: GREEN + affected suites**

Run: `npx vitest --run src/lib/__tests__/bookingCost.test.ts src/components/Trips src/pages 2>&1 | tail -5` — expect PASS (adapt any existing TripCard/TripDetail tests that asserted the old single-currency string; preserve their intent).

- [ ] **Step 7: tsc + lint + commit**

```bash
git add frontend/src/lib/bookingCost.ts frontend/src/lib/__tests__/bookingCost.test.ts frontend/src/pages/TripDetailPage.tsx frontend/src/components/Trips/TripCard.tsx
git commit -m "feat(cost): per-currency booking totals in trip detail + trip card"
```

---

### Task 6: Booking edit modal + API client

**Files:**
- Modify: `frontend/src/lib/api/trips.ts` (after `createBooking`, ~:106-109)
- Modify: `frontend/src/types/index.ts` (near `Booking`, ~:144)
- Create: `frontend/src/components/Trips/BookingEditModal.tsx`
- Test: `frontend/src/components/Trips/__tests__/BookingEditModal.test.tsx` (NEW)
- Modify: `frontend/src/pages/TripDetailPage.tsx` (bookings table rows ~:1085-1092 + modal mount)
- Modify: `frontend/src/i18n/resources/de/trips.json` + `en/trips.json`

**Interfaces:**
- Consumes: `PATCH /api/v1/trips/bookings/:id` (Task 4), `sumByCurrency` display (Task 5 — totals update via refetch), `CurrencyInput` (`value: string`, `onChange(value: string)`).
- Produces:
  ```ts
  // lib/api/trips.ts
  updateBooking: async (id: string, input: UpdateBookingInput): Promise<Booking>
  // types/index.ts
  export interface UpdateBookingInput { pnr?: string | null; price?: number | null; currency?: string | null }
  // BookingEditModal props
  { booking: Booking; onClose: () => void; onSaved: () => void }
  ```

- [ ] **Step 1: Add types + API client**

`frontend/src/types/index.ts` (below the Booking interface):

```ts
export interface UpdateBookingInput {
  pnr?: string | null;
  price?: number | null;
  currency?: string | null;
}
```

`frontend/src/lib/api/trips.ts` (after `createBooking`; extend the type import):

```ts
  updateBooking: async (id: string, input: UpdateBookingInput): Promise<Booking> => {
    const { data } = await api.patch<{ booking: Booking }>(`/trips/bookings/${id}`, input);
    return data.booking;
  },
```

- [ ] **Step 2: i18n (DE + EN together)**

`de/trips.json` — add under a fitting existing parent (or top-level `bookingEdit`):

```json
"bookingEdit": {
  "title": "Buchung bearbeiten",
  "pnr": "PNR",
  "price": "Gesamtpreis",
  "currency": "Währung",
  "save": "Speichern",
  "cancel": "Abbrechen",
  "saved": "Buchung aktualisiert"
}
```

`en/trips.json`:

```json
"bookingEdit": {
  "title": "Edit booking",
  "pnr": "PNR",
  "price": "Total price",
  "currency": "Currency",
  "save": "Save",
  "cancel": "Cancel",
  "saved": "Booking updated"
}
```

- [ ] **Step 3: Write the failing modal test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateBooking = vi.fn().mockResolvedValue({ id: "b1", pnr: "ABC", price: 500, currency: "EUR" });
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { updateBooking: (...args: unknown[]) => updateBooking(...args) },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import BookingEditModal from "../BookingEditModal";

const booking = { id: "b1", pnr: "ABC", price: 250, currency: "EUR" };

describe("BookingEditModal", () => {
  beforeEach(() => {
    updateBooking.mockClear();
    addToast.mockClear();
  });

  it("prefills, submits the changed price via PATCH and calls onSaved", async () => {
    const onSaved = vi.fn();
    render(<BookingEditModal booking={booking} onClose={() => {}} onSaved={onSaved} />);
    const priceInput = screen.getByLabelText(/price|Gesamtpreis|trips:bookingEdit\.price/i);
    fireEvent.change(priceInput, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i }));
    await waitFor(() => expect(updateBooking).toHaveBeenCalledWith("b1", expect.objectContaining({ price: 500 })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("cancel closes without a PATCH", () => {
    const onClose = vi.fn();
    render(<BookingEditModal booking={booking} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel|Abbrechen|trips:bookingEdit\.cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(updateBooking).not.toHaveBeenCalled();
  });
});
```

(Booking type import/shape: align with `types/index.ts` `Booking`; i18n is globally mocked
to `t: key => key` — the regex alternations cover both. Check how `tripsApi` is actually
exported from `lib/api/trips.ts` — named object vs default — and align the mock.)

- [ ] **Step 4: RED run**

Run: `npx vitest --run src/components/Trips/__tests__/BookingEditModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the modal**

`frontend/src/components/Trips/BookingEditModal.tsx` (mirror the app's small-modal idiom —
fixed overlay + `bg-surface` card, btn-primary/btn-secondary):

```tsx
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { tripsApi } from "../../lib/api/trips";
import CurrencyInput from "../CurrencyInput";
import type { Booking } from "../../types";
import { logger } from "../../lib/logger";

interface BookingEditModalProps {
  booking: Booking;
  onClose: () => void;
  onSaved: () => void;
}

export default function BookingEditModal({
  booking,
  onClose,
  onSaved,
}: BookingEditModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [pnr, setPnr] = useState(booking.pnr ?? "");
  const [price, setPrice] = useState(booking.price != null ? String(booking.price) : "");
  const [currency, setCurrency] = useState(booking.currency ?? "EUR");
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const parsedPrice = price.trim() === "" ? null : Number(price);
      await tripsApi.updateBooking(booking.id, {
        pnr: pnr.trim() === "" ? null : pnr.trim(),
        price: parsedPrice != null && Number.isFinite(parsedPrice) ? parsedPrice : null,
        currency,
      });
      addToast(t("trips:bookingEdit.saved"), "success");
      onSaved();
    } catch (err) {
      logger.error("Failed to update booking", err);
      addToast(t("common:errors.generic"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl p-5"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">{t("trips:bookingEdit.title")}</h2>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              {t("trips:bookingEdit.pnr")}
            </span>
            <input
              className="input w-full"
              value={pnr}
              maxLength={20}
              onChange={(e) => setPnr(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              {t("trips:bookingEdit.price")}
            </span>
            <input
              className="input w-full"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              {t("trips:bookingEdit.currency")}
            </span>
            <CurrencyInput value={currency} onChange={setCurrency} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
            {t("trips:bookingEdit.cancel")}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {t("trips:bookingEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Adapt at implementation time (named risks, verify in the real files): the `input` CSS
class (use whatever the app's text inputs use), `CurrencyInput` default vs named export
and prop names, `addToast` signature, `common:errors.generic` key existence (else use an
existing generic-error key), `logger` export shape.

- [ ] **Step 6: Wire into TripDetailPage**

In the bookings table (~:1085-1092): add a third column with a pencil icon-button per row
(reuse the pencil SVG from the flights-table action icons — `FlightRowActions.tsx` — or an
equivalent inline SVG with `aria-label={t("trips:bookingEdit.title")}`), plus component
state `const [editingBooking, setEditingBooking] = useState<Booking | null>(null);` in the
page component that owns the data (lift as needed — the logistics section receives `trip`;
follow the page's existing state-lifting pattern). Mount:

```tsx
      {editingBooking && (
        <BookingEditModal
          booking={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSaved={() => {
            setEditingBooking(null);
            void reloadTrip();
          }}
        />
      )}
```

where `reloadTrip` is the page's existing trip-refetch function (find its real name).

- [ ] **Step 7: GREEN + full check**

Run: `npx vitest --run src/components/Trips/__tests__/BookingEditModal.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS + clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Trips/BookingEditModal.tsx frontend/src/components/Trips/__tests__/BookingEditModal.test.tsx frontend/src/lib/api/trips.ts frontend/src/types/index.ts frontend/src/pages/TripDetailPage.tsx frontend/src/i18n/resources/de/trips.json frontend/src/i18n/resources/en/trips.json
git commit -m "feat(cost): booking edit modal (pnr/price/currency) on the trip detail page"
```

---

### Task 7: Final gate + browser UAT (controller task)

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Backend: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit` (expect green minus the 2 documented flaky suites; re-seed dev admin after: `npm run seed:dev-admin`).
Frontend: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

- [ ] **Step 2: Browser UAT on the dev stack**

Login `admin:admin123`; the demo seed has trips with bookings:
- Trip detail: bookings table shows the pencil; edit a price → PATCH 200, toast, per-currency total updates.
- Set a second booking to USD → totals render "EUR … + USD …" (detail header, stats tile, trip card).
- Import UAT: parse/POST a 2-segment batch with identical price (dev parser or curl) → booking priced, segments show "k.A." in the flights table (INTENDED), summary stats totalCost unchanged vs before import counting once.
- Boot log shows the backfill ran (or healed 0 — fine).

- [ ] **Step 3: Ledger, whole-branch review (opus), merge question — standard flow.**

---

## Self-Review (done at plan time)

- Spec coverage: §1 import rule + fresh response (T1), §5 backfill (T2), §4 summary stats
  (T3), §2 PATCH + modal (T4+T6), §3 currency display incl. TripCard (T5), testing list
  distributed, out-of-scope respected. ✔
- Placeholder scan: T1/T2 flight-create payloads and T6 modal carry full code with
  explicitly NAMED verify-risks (payload field names, export shapes) — grounded
  adaptation, not TBDs. ✔
- Type consistency: `CostFlight`/`computeDedupedTotalCost` (T3), `BookingCostInput`/
  `CurrencyTotal`/`sumByCurrency` (T5/T6), `UpdateBookingInput` (T4 backend zod infer,
  T6 frontend interface — same field shapes). ✔
