# Package bookings — one price across flights, stays, rentals and cruises (forgejo#430)

Owner, 2026-11-21: a package (flight + hotel; a round trip with hotels and a
ship — China 7,238 EUR, Washington via Opodo 2,870.96 EUR) must be ONE booking
covering every entry it sold. Today it had to be put on the flight booking,
which made the whole package price a flight price in the flight statistics.

## What already exists (measured on 2.8.0-rc.40)

- `bookings` carries price, currency, FX snapshot, operator, traveller count,
  `bookedOn`, deadlines and an optional `price_split` (forgejo#219,
  flights only, display only).
- Flights, cruises, stays, train, bus and ferry rides each carry a nullable
  `booking_id` (`ON DELETE SET NULL`). Rentals do not.
- The trip cost (`shared/tripCost.ts`) already counts a booking price ONCE per
  trip across every domain. The flight statistics (`utils/stats/dedupedCost.ts`,
  `businessStats.ts`) count it once per booking too — but as a FLIGHT cost,
  whatever else the booking sold. That is the bug.
- The package import (`services/trip/package/commit.ts`) already creates one
  booking and files the flights, stays and the cruise on it.

## Data model

A booking's items are the entries that point at it through their own nullable
`booking_id` — one real foreign key per entry type, the same shape as
`document_links` but on the entry side. That keeps the one property a package
needs: an entry is sold by at most one booking, so nothing can be paid twice
through two bookings. A join table would allow exactly that and buy nothing.

The one change: `rental_bookings.booking_id` (nullable, FK to `bookings`,
`ON DELETE SET NULL`, indexed). Additive; every existing row keeps
`booking_id = NULL` and means what it meant. Today's flight and ferry bookings
need no data migration: they are already rows of `bookings`. The migration is
replayed against a rental row in the old shape
(`migration.packageBookings.test.ts`).

A booking is a **package** when its entries span more than one entry kind
(flight + stay, ferry + rental, …). A booking of flights only is a flight
booking, and its price stays a flight price exactly as before.

## How the price is held

Once, on the booking (`bookings.price` + currency + FX snapshot). Optionally
split per item in `bookings.price_split`, version 2:

```json
{ "method": "equal" | "distance" | "manual", "price": 7238, "currency": "EUR",
  "shares": [{ "kind": "flight", "id": "…", "amount": 2400 }, { "kind": "stay", "id": "…", "amount": 4838 }] }
```

- `kind` ∈ flight | stay | cruise | rail | bus | ferry | rental.
- The shares sum to `price` in the currency's minor unit, always: `equal` and
  `distance` by largest remainder; `manual` is refused (`BOOKING_SPLIT_SUM`)
  unless the user's amounts sum exactly. `distance` is offered for flight-only
  bookings (the forgejo#219 rule), never for a package.
- One currency: the booking's. Shares are never in another currency, so a
  package can never be summed across currencies by its own split.
- **No split stored = "not split".** That is a state, not a missing value: it
  says the package price cannot be attributed to its items.
- Version-1 splits (`{ flightId, amount }`) are read as `kind: "flight"`.
- A package split covers every item, a cancelled one included (it may have
  cost a fee; the user can give it 0).
- A split is **valid** only while price, currency and the set of items still
  match (count and ids); otherwise it is stale and reads as not split.
- Every write that sets, moves or clears an entry's `booking_id`, or deletes
  a booked entry, marks the booking's split `stale: true` — one database
  trigger (`clear_package_split_on_membership`, its body replaced by
  `20261121195159_package_split_mark_stale`) on all seven entry tables. Every
  typed amount is kept (CLAUDE.md defect class 4); the statistics read a
  stale split as no split, the card says "Aufteilung prüfen" with the old
  amounts prefilled, and saving a split writes it without the flag.
- The flight statistics say how many flights an unsplit package kept out of
  the cost ("N Flüge in Paketen nicht eingerechnet"): `packagedFlights` on
  `/stats/summary` and `/stats/business`.
- A cancelled rental on a priced booking still costs its cancellation fee in
  the trip cost; a live one costs only through the booking.

## How statistics read it — never double, never a package as a flight price

| Reader | Rule |
|---|---|
| Trip cost, trip totals, travel account, "most expensive trip" (`shared/tripCost.ts`) | Unchanged: the booking price counts ONCE per trip, all-in, whatever it covers. Rentals on a booking now take the same path, so a rental inside a package is no longer added on top. |
| Flight statistics (`dedupedCost.ts`, `businessStats.ts`, summary, year cost, evidence) | Flight booking: unchanged. Package flight with a valid split: its own share, in the booking currency, converted through the booking's snapshot ratio. Package flight without one: **abstains** — counted in `packagedFlights`, neither priced nor unpriced, never 0 and never the package price. |
| Lodging, cruise statistics | Read the entry's own price as before (they never read the booking). A packaged stay or cruise without its own price takes its valid split share; otherwise it abstains as unpriced. |
| Rail/bus/ferry price per km | Unchanged: a ride priced through a booking is left out (`pricePerKm.ts`). |
| Per-entry display | The booking card says "Teil eines Pakets" for an unsplit item — not 0, not the whole price — and the share when split. |

Currencies are never summed across: shares carry the booking currency, and
every total keeps its `unconvertedByCurrency` bucket.

The statistics ETag fingerprints `bookings` too, so a saved price or split is
never answered 304 with the old figures.

## API (additive)

- `GET /trips/bookings/:id` — the booking with its items of every kind
  (`kind`, `id`, `label`, `date`), `isPackage` and the split view
  (shares + `staleReason`).
- `PUT /trips/bookings/:id/split` — `{ method: "equal" }` or
  `{ method: "manual", shares: [{ kind, id, amount }] }`.
- `DELETE /trips/bookings/:id/split` — back to "not split".
- `PUT /trips/bookings/:id/entries` gains `railIds`, `busIds`, `ferryIds`,
  `rentalIds` beside `flightIds`, `stayIds`, `cruiseIds`.
- `GET /flights/:id/booking` keeps its shape; `split.shares[]` gains `kind`
  and `id` beside `flightId` (still set for flight shares).
- Rental DTOs carry `bookingId`.

Companion: all additive. An app that does not know `kind` keeps reading
`flightId`; minimum server version for the new endpoints is the release that
ships this.

## Classification

- Sharing: a booking is not a shareable type (it is who paid). `bookingId` is
  not a fact field; filing a shared rental on a booking propagates like the
  other entry kinds (`setBookingEntries`).
- Federation: unchanged — bookings do not travel.
- Export / backup: `rental_bookings.booking_id` rides in the generic table
  copy; the spreadsheet export lists bookings already.

## Package import

`commit.ts` keeps creating one booking for the package and filing every
created or attached entry on it. A package's flights are therefore read by the
flight statistics as packaged (abstaining until split), which is the point.
