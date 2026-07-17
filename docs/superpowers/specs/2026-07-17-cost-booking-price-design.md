# Cost system, first slice: booking-level total price — design spec

Date: 2026-07-17
Status: approved (owner, 2026-07-17 — "Erste Scheibe + Währungs-Anzeige")
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
- Stats stay untouched (their dedupe already does the right thing once bookings carry
  prices; FX-aware stats are 2.6 material).

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

## 2. Booking edit (backend route + trip-detail UI)

Backend, `routes/trips.ts`:
- `PATCH /trips/bookings/:id` — authenticate + requireWriteScope, ownership check
  (`findFirst({ id, userId })` → 404 like the sibling POST). Zod partial body:
  `pnr` (string ≤ 40, nullable), `price` (nonnegative finite number, nullable),
  `currency` (3-letter uppercase code, nullable → stored as given; schema default only
  applies on create). Returns `{ booking }`. Duplicate/constraint errors flow through the
  central error handler (P2002 → 409 since `68378385`).

Frontend, trip detail (`TripDetailPage.tsx` logistics section — the existing bookings
list):
- Each booking row gets a pencil (icon-button style matching the flights-table action
  icons) → a small edit modal in the existing modal idiom: fields PNR, Preis (number
  input), Währung via the existing `components/CurrencyInput.tsx` (read its props and
  reuse it as its current consumers do), Speichern/Abbrechen, toast on success, list
  refetch after save.
- New API client function `tripsApi.updateBooking(id, payload)` (or the existing trips
  API module's idiom) with `withCredentials` via the shared axios client.
- i18n DE + EN together for all new labels.

## 3. Currency display (trip detail)

Replace the naive sum: a pure helper `sumByCurrency(bookings): Array<{currency, total}>`
(order: EUR first if present, then alphabetically) rendered as "1.240 € + 380 $"-style
joined totals wherever `totalCost` was shown (both call sites,
`TripDetailPage.tsx:961-962` and `:1116-1117`). Single-currency bookings render exactly
as today. The helper lives beside the page's other helpers (or `lib/` if one exists for
money formatting — follow the existing currency formatting used by the bookings list).

## Testing

- Backend (`flightsBatch` suite): multi-segment identical price → booking carries
  price+currency, segment prices nulled, stats-relevant fields intact; differing
  prices → booking priceless, flight prices kept; single flight → unchanged; mixed
  null/set prices → treated as differing.
- Backend (`trips` suite): PATCH happy path, 401 unauthenticated, 404 foreign booking,
  400 invalid body (negative price, bad currency shape).
- Frontend: `sumByCurrency` unit tests (single currency, mixed, null prices, null
  currency→EUR); edit-modal flow test (open, change price, PATCH called, toast);
  trip-detail renders per-currency totals.
- Full gates (backend + frontend) + a short browser look at the trip detail
  (edit a booking price, see the per-currency total update).

## Out of scope

- FX conversion of any kind; stats currency handling.
- Booking delete / booking-create UI.
- Cruise price logic (cruises link bookings too — untouched; the edit modal works on
  any booking row the trip shows, which is domain-agnostic anyway).
- Parser changes (the parser already extracts the total correctly; only its landing
  place changes).

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
