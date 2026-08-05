# Cost system, first slice: booking-level total price — design spec

Date: 2026-07-17
Status: approved (owner, 2026-07-17 — "Erste Scheibe + Währungs-Anzeige"; scope update
same day after a Codex cold review: booking-aware summary stats + boot backfill added,
owner-approved)
Release: rides 2.5.0.
Branch: feat/cost-booking-price

## Why

Alex's very first Discord question (07-12): booking-level total price. The data model is
half-wired: `Booking` (pnr, price, currency) exists, the email/PDF batch import
auto-groups flights by PNR into a Trip + Booking, and the business stats already dedupe
correctly (booking price counts once per booking, else per-flight fallback,
`utils/stats/businessStats.ts:39-62`). The gaps:

1. The parser extracts ONE total per booking email, but that total is stamped on EVERY
   segment (`flightsBatch.ts` create loop) while the auto-created Booking stays
   priceless (`flightsBatch.ts:208-210`) — so multi-segment bookings double-count in the
   per-flight fallback.
2. There is no UI (and no update route) to set or fix a booking price after the fact.
3. `TripDetailPage.tsx:959-962,1116-1117` sums booking prices naively across currencies
   and labels the sum with the first booking's currency.

## Owner decisions (fixed)

- Scope = first slice + currency display. NO FX conversion (groundwork lives on
  dev/hotels, ships with 2.6).
- No booking delete or booking-create UI in this block (`POST /trips/bookings` exists
  for programmatic use and stays).
- Codex-review scope update (owner-approved): the SUMMARY stats totalCost becomes
  booking-aware (see §4) and a one-time boot backfill heals existing priceless
  bookings (see §5). `businessStats.ts` itself stays untouched (its dedupe is already
  correct); FX-aware stats are 2.6 material.
- Display consequence, INTENDED: after grouping, segments of a priced booking carry no
  own price — flights table / GeoJSON / exports show them priceless. That is Alex's
  point: the price belongs to the booking.
- Booking price is ALL-IN: when a booking price exists, per-flight `taxes`/`fees` of its
  flights do not additionally count (existing `businessStats` behavior — kept).
- Price `0` behaves as "no price" (existing truthiness semantics); negative prices stay
  rejected (schema `min(0)`). Refund modelling is out of scope.

## 1. Parser total → booking price (backend, `routes/flightsBatch.ts`)

Extend the existing PNR-grouping step (groups of ≥ 2 flights, inside the same
transaction):

- **Identical non-null `price` AND identical `currency` across all segments of the
  group** (the repeated booking total from the email — the normal case): create the
  Booking with `price = that value, currency = that currency`, then NULL `price`
  on those flights in the same `updateMany` that links `bookingId`/`tripId`.
  `taxes`/`fees` are per-flight fields and are NOT moved or cleared.
- **Differing per-segment prices** (genuine per-segment fares) or any segment with a
  null price: unchanged behavior — booking created without price, per-flight prices
  stay, stats fall back per flight.
- **Single-flight PNRs** (no group, no booking): unchanged — price stays on the flight;
  nothing can double-count.
- Currency comparison treats `null` currency as the schema default "EUR" (both `Flight`
  and `Booking` default to EUR).
- **Fresh response rows** (Codex finding): the route's response is built from the
  original `flight.create` results, which are stale after the grouping `updateMany`
  (old price, no tripId/bookingId). Re-read the affected flights inside the transaction
  (or patch the in-memory rows consistently) so the response reflects the final state.

## 2. Booking edit (backend route + trip-detail UI)

Backend, `routes/trips.ts`:
- `PATCH /trips/bookings/:id` — authenticate + requireWriteScope, ownership check
  (`findFirst({ id, userId })` → 404 like the sibling POST). Zod partial body aligned
  with the existing `createBookingSchema` (`backend/src/schemas/trip.ts:63-75`):
  `pnr` (string ≤ 20, nullable), `price` (`z.number().min(0)`, nullable), `currency`
  (3-letter uppercase code, nullable). Returns `{ booking }`. Editing a booking NEVER
  mutates its flights' prices.

Frontend, trip detail (`TripDetailPage.tsx` logistics section — the existing bookings
list):
- Each booking row gets a pencil (icon-button style matching the flights-table action
  icons) → a small edit modal in the existing modal idiom: fields PNR, Preis (number
  input), Währung via the existing `components/CurrencyInput.tsx` (read its props and
  reuse it as its current consumers do), Speichern/Abbrechen, toast on success, list
  refetch after save.
- New API client function `updateBooking(id, payload)` in
  `frontend/src/lib/api/trips.ts` beside the existing `createBooking`, via the shared
  axios client.
- `CurrencyInput` (`components/CurrencyInput.tsx`) takes `value: string` /
  `onChange(value: string)` — bridge nullable booking currency with `value ?? "EUR"`.
- i18n DE + EN together for all new labels.

## 3. Currency display (trip detail + trip card)

Replace the naive sums: a pure SHARED helper `sumByCurrency(bookings):
Array<{currency, total}>` (null currency → "EUR"; null price skipped; order: EUR first
if present, then alphabetically), rendered as "1.240 € + 380 $"-style joined totals.
Call sites: BOTH `TripDetailPage.tsx` naive-sum spots (declarations ~:961-962 and
~:1116-1117, rendered in the logistics total and the stats tile) AND
`components/Trips/TripCard.tsx:52-53` (same naive pattern — Codex finding).
Single-currency data renders exactly as today. The helper lives in `lib/` beside the
existing money/format helpers, unit-tested.

## 4. Booking-aware summary stats (backend, `routes/stats.ts`)

Codex finding, verified: the summary `totalCost` (`routes/stats.ts` ~:215-222) is a
plain Prisma aggregate over `flight.price/taxes/fees` — with segment prices nulled it
would silently DROP grouped bookings' cost. Fix: compute `totalCost` booking-aware with
the SAME rules as `businessStats.ts:52-62` — booking price counts once per booking;
flights without a priced booking fall back to `price + taxes + fees`. Implement as a
small pure helper (unit-tested against the businessStats semantics) applied to the
already-filtered flight set (the flights must be fetched with
`booking: { select: { id, price } }` where the aggregate is replaced).
`businessStats.ts` itself is NOT refactored in this block (working code, different
loop shape — dedupe rules duplicated knowingly, cross-referenced in a comment).

## 5. Boot backfill for existing bookings (backend)

New `backend/src/scripts/backfillBookingPrices.ts`, mirroring the
`backfillAirlineCodes` pattern (idempotent, boot-wired in `index.ts` with its own
try/catch so a failure cannot kill boot): for every booking with `price = null` whose
linked flights number ≥ 2 and ALL carry the identical non-null `price` and identical
currency (null → "EUR"): set the booking's price/currency, null those flights' prices —
same rule as the import path, applied once to history. Bookings that don't match stay
untouched. Logs a summary count.

## Testing

- Backend (`flightsBatch` suite): multi-segment identical price → booking carries
  price+currency, segment prices nulled, RESPONSE rows reflect the final state
  (bookingId/tripId set, price null); differing prices → booking priceless, flight
  prices kept; single flight → unchanged; mixed null/set prices → treated as differing.
- Backend (`trips` suite): PATCH happy path, 401 unauthenticated, 404 foreign booking,
  400 invalid body (negative price, bad currency shape); PATCH leaves flight prices
  untouched.
- Backend (stats): summary totalCost with a priced booking spanning 2 flights counts
  the price ONCE; unpriced-booking flights fall back per flight; matches
  businessStats semantics on the same fixture.
- Backend (backfill): heals a matching priceless booking exactly once (idempotent
  re-run inserts/changes nothing); skips differing-price and single-flight bookings.
- Frontend: `sumByCurrency` unit tests (single currency, mixed, null prices, null
  currency→EUR); edit-modal flow test (open, change price, PATCH called, toast);
  trip-detail + trip-card render per-currency totals.
- Full gates (backend + frontend) + a short browser look at the trip detail
  (edit a booking price, see the per-currency total update).

## Out of scope

- FX conversion of any kind; currency handling inside stats (totalCost remains a
  currency-blind number for now, as before — the booking-aware fix changes WHAT is
  summed, not the currency semantics).
- Booking delete / booking-create UI.
- Cruise price logic (cruises link bookings too — untouched; the edit modal works on
  any booking row the trip shows, which is domain-agnostic anyway).
- Parser changes (the parser already extracts the total correctly; only its landing
  place changes).
- `frontend/src/components/Stats.tsx` — DEAD code (referenced only by a commented-out
  test line); goes on the dead-code cleanup backlog, not this block.
- `businessStats.ts` refactoring (rules duplicated knowingly, see §4).

## Risks / gotchas

- The batch transaction already does `updateMany` for `tripId`/`bookingId` — fold the
  price-null into THAT update; a second update per group is wasted work and widens the
  transaction window.
- Do not touch `ticketPrice` (a separate legacy field) or `taxes`/`fees`.
- The identical-price rule must compare with a small epsilon-free strict equality —
  parsed prices come from the same string, so `===` on the float is correct; do NOT
  introduce tolerance comparisons.
- TripDetailPage is large; keep new UI pieces as extracted components if they exceed a
  trivial size (follow the page's existing section-component pattern).
- `feedback_key_presence_guard_vs_real_payload`: the PATCH must guard on VALUES
  (`!== undefined`), mirroring flights.ts:961 idiom, so a partial body never nulls
  fields the client didn't send.
