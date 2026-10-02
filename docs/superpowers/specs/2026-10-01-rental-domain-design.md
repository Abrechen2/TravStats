# Rental — a seventh domain for car rentals

Date: 2026-10-01 · Branch: `docs/rental-domain-spec` · Status: **draft, measurement + design only — no code**

## Why

Owner decision 2026-10-01: a car rental becomes its **own domain**, the way rail
did on 2026-09-25. A rental is a dated, booked, priced thing with a provider, a
confirmation number, a pick-up and a return station and a vehicle class — the
shape of a booking, not of a route. A roadtrip is the route; a rental is the
contract for the car that drove it. The two meet (§7) but neither absorbs the
other.

This spec follows the rail spec (`2026-09-25-rail-domain.md`) concern by
concern, and stops at the design: what the corpus shows, what the model is, in
which packages it gets built and how each is measured. §11 lists what the owner
has to decide before package R1 starts.

## 1. Measured corpus

Two corpora: the owner's own Sixt mails (§1.4) and, larger and older, a third
person's private mailbox export (owner-permitted, **local
analysis only**), the `Cars` bucket of the PST export, 53 `.msg` files from
2008–2024. Read with the app's own `extractEmailFromFile`; PDF attachments with
`pdf-parse`. **No value from it appears in this document** — only shapes and
counts. Nothing was copied into the repository, and the dumps were deleted.

### 1.1 What the 53 mails are

| Kind | Count | Senders |
|---|---|---|
| Booking confirmation, direct with the provider | 14 | Europcar 4 (two sender domains: `mail.europcar.com` and a mailing relay), Alamo 5, Sixt 3, Avis 2 |
| Alamo "has been Checked-In" (a full itinerary, re-sent after online check-in) | 9 | Alamo 5, plus 4 internal forwards of them |
| Alamo "Skip the Counter" pick-up ticket (full itinerary + ticket) | 4 | Alamo 3 (EN and DE), plus 1 forward |
| Rental agreement at pick-up (body summary + PDF contract) | 4 | Alamo |
| Broker / voucher | 3 | a broker voucher (holiday autos, PDF), an OTA confirmation (Opodo on a CarTrawler engine, forwarded), a provider's prepaid voucher (Avis, PDF) |
| Travel-agent correspondence about a rental (offer, booking, extension) | 4 | DER / DERTOUR, prose, one forward with an empty body |
| **Airport parking** — not a rental, misfiled by the export's classifier | 5 | Holiday Extras 2, Parkvogel 1 + forward, the airport's own parking shop (forwarded) |
| Marketing, account, survey, thank-you | 10 | Sixt 4, Hertz 2, Europcar 1, Check24 1, ZVEI 1, Medallia 1 |
| Cancellation | **0** | — |
| Invoice / receipt at return | **0** | — (one Hertz "thank you for renting" carries no data) |

So 34 of 53 mails carry a rental (≈ 25 distinct bookings after de-duplication by
confirmation number — Alamo alone sends up to four mails per booking: the
confirmation, the check-in mail, the pick-up ticket and the rental agreement,
all carrying the same reservation number; the agreement names it as
`RESERVATION#` next to its own `RA#`). 19 carry no importable booking — 4 of
them travel-agent prose about one, and 5 that *look* like bookings (parking:
a number, two times and a price).

Languages: German, English, one Danish (marketing). Forwards come wrapped in
a quoted header block; 6 of the 34 are forwards.

### 1.2 Fields per sender (confirmations)

| Field | Europcar | Sixt | Avis | Alamo | Brokers |
|---|---|---|---|---|---|
| Confirmation number | 9 digits, labelled | 10 digits, also in the subject | `NNNN-NNNN-CC-N` | 9–10 digits, in subject | broker ref (letters+digits) **and** a provider number |
| Pick-up / return station | name + full address + phone + opening hours, both | name only in the body; address in the PDF | city, station name, street | name with **IATA in parentheses** (`… (XXX)`), address, phone, hours | name, sometimes only an address (no IATA) |
| Times | `dd.mm.yy HH:MM` / `dd.mm.yyyy` + `HH:MM` | dates in the body, times in the PDF or in parentheses | weekday + `dd.mm.yyyy HH:MM Uhr` | `Ddd, Mmm D, YYYY` + `h:mm AM/PM` (EN) or a long German date + `HH:MM Uhr` | ISO-like `YYYY-MM-DD HH:MM:SS`, or a day/month pair |
| Zone printed | never | never | never | never | never |
| Vehicle class | **ACRISS 4-letter code** + a class name | **ACRISS code** + "Beispielfahrzeug" | a group letter ("Gruppe <letter>") | class name only ("Economy", "Convertible", "Standard Manual") | class name |
| Example model | "z.B. … oder ähnlich" | yes | "z.B. …" | "… or similar" | "… oder vergleichbar" |
| Driver(s) | main driver, loyalty id | main driver | main driver | main driver, loyalty number, **a second driver** on some | main driver |
| Price | total, currency symbol or code, VAT note | gross total (PDF: net, tax, gross) | total, decimal comma | total in local currency (USD, AED in Arabic script, EUR) **and** an "estimated cost in native currency" line in 4 mails | transaction amount + currency |
| Prepaid vs pay at desk | "online bezahlt" vs "NON-PREPAID" in the rate name | payment type in the PDF | separate prepaid voucher mail | "Pay at counter" (5), "Voucher #" (1) | prepaid by definition |
| Tour-operator package | — | — | — | total printed as **0.00** or every line "INCLUDED" (3 mails) — the price is not zero, it is *unknown here* | — |
| Included / extras | CDW, TP, km, airport fee; excluded extras with a per-day price | km rule | CDW, TP, deductible | CDW, EP, SLP, PEC, roadside, additional driver, taxes listed line by line | insurance list, fuel policy |
| Mileage | unlimited or a km cap | unlimited, or a cap + per-km price | unlimited | unlimited | unlimited |
| Arrival flight | flight number on two of four | — | — | "Arriving Airline" + flight number on four | flight number on one |
| Provider vs brand | Europcar; abroad "the contract is with the local partner" | Sixt | Avis | Alamo, once operated by **Enterprise** at the counter (Drive Alliance), once booked through a tour operator | broker names the local provider in text (holiday autos) or **only as a logo image** (Opodo) |

The rental agreement adds what no confirmation has: the **actual** pick-up
time (minutes off the reserved one), make/model actually driven, plate,
odometer out, fuel level out, the booking account (a tour operator) and the
additional authorised driver. Odometer *in* and the return time as happened
are empty — the agreement is issued at pick-up, and no return receipt exists in
the corpus.

### 1.3 What the corpus teaches

1. **Every time is a station wall clock with no zone** — the rail case exactly.
   Alamo mails are often sent months before, sometimes in the previous year;
   a day/month-only broker date needs the mail's `sentAt` as year anchor
   (`ExtractedEmail.sentAt`, forgejo#18).
2. **IATA is printed only by Alamo.** Every other sender names an airport
   station in prose ("… Flughafen", "… AIRPORT", "Flughafen …") or gives only a
   street address.
3. **The vehicle is a class, not a car.** ACRISS where Europcar/Sixt print it,
   a class name otherwise; the model is an example ("or similar"). The car
   actually driven is known only from a rental agreement.
4. **A price can be absent while printed as 0** (tour-operator packages) — the
   abstention rule applies: null, never 0.
5. **One booking, many mails.** De-duplication by provider + confirmation
   number is not optional; an import of this mailbox without it creates each
   Alamo rental up to four times.
6. **Parking confirmations look like rentals.** A classifier that keys on
   "airport + booking number + two times + price" files them as rentals.
7. **No cancellation and no change mail exists in the sample.** Change and
   cancel handling is designed from the providers' known shapes but is
   **unmeasured** until a sample arrives (§4.4).
8. **No final invoice exists in either corpus — so no driven km does.**
   Searched both for invoice/receipt/odometer/Kilometerstand wording: the only
   odometer is the Alamo agreement's *out* reading (4 of 4 agreements; *in* and
   fuel *in* empty in all 4, totals marked estimated). The old Sixt mails say
   the invoice arrives "automatically" and as a copy in the customer portal
   48 h after return; the OTA mail links a payment receipt on the web. Neither
   is a mail in the corpus. Owner rule 2026-10-01: km come from the invoice —
   so the invoice path (§4.5) is designed but **unmeasured**, and every rental
   in both corpora would import with km `null`.

### 1.4 Owner corpus — `test-samples/Mietwagen/` (gitignored)

Five Sixt booking confirmations from the owner's own mailbox, sent 2024–2026,
two airport stations (one used four times). All five are confirmations; no
change, cancellation or invoice. This folder is the **measuring corpus for the
parser package** (§10, R2), in the role `test-samples/Flug-emails/` plays for
flights; the archive in §1.1 is analysed locally only and never becomes a
fixture.

Two layouts:

| | Layout A — 4 mails, 2024–2025, `e.sixt.com` sender | Layout B — 1 mail, 2026, `sixt.com` sender |
|---|---|---|
| Subject | "Ihre Buchung bei [SIXT] <station> ist bestätigt: #<10 digits>" (one without the brand word) | same pattern |
| Station | name only ("<City> Flughafen"); no IATA, no address in the body; the legal footer names the national Sixt company | same; the order is reversed — the date line comes *before* "Abholung in <station>" |
| Times | German weekday, day, abbreviated month, year, "um HH:MM" — no zone | same |
| Vehicle | "<model> oder ähnlich" + transmission word (Automatik / Manuell) | model + "oder ähnlich" |
| Class code | **none** | **none** |
| Price | one total with `€`, labelled either "Im Voraus bezahlter Gesamtbetrag" (2) or "Gesamtsumme bei Abholung" (2) — prepaid vs pay-at-counter is explicit | "Mietpreis im Voraus bezahlt" |
| Also | deposit amount, protection package with deductible or "no protection", "Unbegrenzte Kilometer", extras as included / not included | deposit, payment method, check-in hint |
| Noise | zero-width non-joiners (U+200C) wrapped around the booking number and list items | same |

**Today's Sixt differs from the 2009–2010 Sixt in the archive** on every field
a template keys on: the old mails carried an ACRISS code with a sample car,
dates without times in the body, the times and addresses only in an attached
PDF, and a gross total with a VAT note; the new ones carry no class code and no
attachment, put both times in the body, name the payment timing explicitly and
add a deposit and a protection package. One template cannot serve both; the
archive layout is history and gets no template (§4.1).

## 2. Principles

- **The rail template, concern by concern.** Registry in both `shared/domains.ts`,
  enveloped router (ADR 0001), Zod in `schemas/rental.ts`, companions as a join
  table with dual write, FX snapshot, ownership-checked `tripId`, documents via a
  one-owner CHECK, stored status cache + hourly sweep, beta gate plus
  `useEnabledDomains()`, `PARSER_SUPPORTED_DOMAINS` entry.
- **Times are station wall clocks** (ADR 0002 D1–D3): the client sends
  `{local, zone}` or a wall clock plus a station; the server resolves the zone
  through `shared/time/zoneOf.ts` and stores a real UTC instant **plus** the
  zone, frozen. No fallback to the browser, server or profile zone; an
  unresolvable station fails with `TZ_UNRESOLVED`. Reads return
  `{utc, zone, offset, local, precision}`.
- **Abstention.** Unknown price, unknown km, unknown return time are `null`,
  never 0 — the tour-operator mails print 0.00 for a price that exists.
- **The four silent-failure classes** are designed against, each with a test
  that drives the failure path: (1) the station picker must offer every airport
  and every geocoder hit, not a filtered subset; (2) a chosen station carries its
  coordinates, country and zone into the row, or the row is refused; (3) a
  failed geocode/FX/LLM call surfaces as itself, never as an empty success;
  (4) re-parsing a later mail of the same booking never overwrites a value the
  user edited or a richer value with a poorer one.
- **A rental is a contract, not a route.** It has no geometry of its own. A
  roadtrip may name it as its vehicle (§7.2). Its driven km come from its
  **invoice** (owner rule 2026-10-01) and from nowhere else automatically; the
  roadtrip keeps its own routed km, and neither is copied into the other.

## 3. Data model

### 3.1 `RentalBooking` (`rental_bookings`) — one row per rental contract

| Column | Type | Notes |
|---|---|---|
| `provider` | text | The company whose counter hands over the keys ("Sixt", "Alamo"). Required. Free text with suggestions from the user's past rows; no catalogue in R1. |
| `operatedBy` | text? | Set only when the counter belongs to someone else (Alamo booked, Enterprise at the desk — measured once). |
| `broker` | text? | OTA, broker or tour operator the booking went through (Opodo, holiday autos, a tour operator). See §11 D4. |
| `confirmationNumber` | text? | The provider's number. Text: shapes include dashes and letters. |
| `brokerReference` | text? | The broker's own reference, when there is one. |
| `agreementNumber` | text? | The rental-agreement number, known only from an agreement. |
| `pickupStationName`, `returnStationName` | text | Required; as printed. |
| `pickupAddress`, `returnAddress` | text? | As printed. |
| `pickupAirportId`, `returnAirportId` | uuid? | FK `Airport`, SetNull — set when the station is an airport (§3.2). |
| `pickupLat/Lon`, `returnLat/Lon` | float | **Required**, as on `RailJourney`: a station without a position has no zone, no country and no map point. |
| `pickupCountry`, `returnCountry` | text? | ISO 3166-1 alpha-2 from the airport or the geocoder; never guessed. |
| `pickupTimezone`, `returnTimezone` | text | IANA, from `zoneOf` (airport catalogue first, coordinates second). |
| `pickupTime`, `returnTime` | timestamp | Real UTC instants. `returnTime` may not precede `pickupTime`. |
| `pickupPrecision`, `returnPrecision` | text | `minute` \| `day` \| `unknown` — an old Sixt body without times is `day` until its PDF says more. |
| `actualPickupTime`, `actualReturnTime` | timestamp? | From a rental agreement or typed; null when nobody recorded it. |
| `vehicleClass` | text? | The class as printed: "Compact", "Convertible", "Gruppe <letter>". |
| `acrissCode` | text? | Four letters, validated against the ACRISS alphabet per position; transmission and A/C are **derived** from it on read, not stored. |
| `vehicleExample` | text? | "<model> or similar" — what was promised. |
| `vehicleDriven` | text? | Make/model actually driven — from the invoice, else the agreement, else typed. Plate and VIN are **not stored** (§4.6). |
| `odometerOutKm`, `odometerInKm` | int? | From the **invoice** (out also from an agreement). |
| `distanceKm` | int? | Driven km: the invoice's own figure, else in − out when both exist, else **null** — never 0, never estimated. |
| `distanceSource` | text? | `invoice` \| `agreement` \| `user` (a manual correction, kept as such) \| null. |
| `finalAmount`, `finalCurrency` + FX columns | | What the invoice says was charged (extra km, fuel, late return included). Null until an invoice arrives (§11 D10 for which figure the statistics use). |
| `invoiceNumber` | text? | Second match key for later mails; never a create key. |
| `mileagePolicy` | text? | `unlimited` \| `capped` \| null; `mileageCapKm` int? beside it. |
| `fuelPolicy` | text? | `full_to_full` \| `prepaid_tank` \| `full_to_empty` \| null. |
| `paymentTiming` | text? | `prepaid` \| `pay_at_counter` \| `package` (inside a tour-operator price) \| null. |
| `price`, `currency` + the five FX columns | | As `RailJourney`; FX dated by the pickup's local day. Null with `paymentTiming = package` is the normal case, not an error. |
| `inclusions` | text[] | Normalised codes: `cdw`, `tp`, `scdw`, `pai`, `slp`, `ep`, `roadside`, `gps`, `child_seat`, `additional_driver`, `one_way_fee`. Included or bought — not their prices (§11 D5). |
| `arrivalFlightNumber` | text? | As printed ("Arriving Airline"); drives a flight-link suggestion (§7.1). |
| `status` | text | `scheduled` \| `in_progress` \| `completed` \| `cancelled`; cache of `deriveRentalStatus`, only `cancelled` client-settable — rail's vocabulary. |
| `notes`, `tags`, `companions` | | As rail; additional drivers become companions. `RentalBookingCompanion` join, dual write. |
| `tripId` | uuid? | SetNull, ownership-checked. |
| `routeId` | uuid? | The roadtrip (`TripRoute`, `kind = roadtrip`) this car drove; SetNull (§7.2). |
| `externalRef`, `importBatchId` | | `@@unique([userId, externalRef])`; the parser writes `rental:<provider>:<confirmationNumber>`. |

`Document.rentalBookingId` joins the one-owner CHECK. `LOYALTY_DOMAINS` gains
`rental` (a DB CHECK, so a migration — as `20260926210438_loyalty_rail_domain`):
the corpus carries provider loyalty numbers on two senders.

**One-way** is derived (`pickup ≠ return` by airport id, else by distance
> 1 km), never stored.

### 3.2 Station resolution — no station catalogue

There is no open, licensable catalogue of rental counters, and the corpus does
not need one. Resolution in order, each step falling through on a miss:

1. **IATA printed** (`… (XXX)`) → `Airport` catalogue → coordinates, country, zone.
2. **An airport named in prose** ("<City> Flughafen", "<CITY> AIRPORT",
   "Flughafen <City>" — today's Sixt prints nothing else, plus a country hint in
   its legal footer) → airport search by city + airport words, narrowed by the
   country hint when there is one; taken only
   when exactly one airport matches, otherwise the review asks with every
   candidate listed (class 1).
3. **An address** → the geocoder the lodging import uses → coordinates →
   `zoneOf`.
4. **Nothing resolves** → the review asks; a row is not written without a
   position (class 2). Never the user's home, never the trip's first airport.

The form offers the same three ways: an airport picker, a free address, or the
user's own earlier stations (entry suggestions, as rail's chips).

## 4. Parsing

`rental` joins `PARSER_SUPPORTED_DOMAINS` and reads through the existing email,
mail-file, PDF and `auto` routes (`services/parsing/parseDocument.ts`). Code in
`backend/src/services/rental/parser/`, shaped like rail's, with one rule rail
did not need: **template, else LLM, else decline — no generic regex reader.**
The corpus shows why: a generic "two dates + a station word + a price" reader
files the five parking mails as rentals.

### 4.1 Templates — one per provider, only where a real sample exists

| Template | Covers | Corpus | Package |
|---|---|---|---|
| `sixt` | Layouts A and B (§1.4) | owner, 5 | R2 |
| `alamo` | the itinerary block shared by confirmation, "Checked-In" and "Skip the Counter" mails (EN + DE), plus the rental-agreement summary/PDF, which only *enriches* a booking it can match by reservation number (actual times, car driven, odometer out) | archive | R3 |
| `europcar` | the labelled block and the single-line relay layout | archive (2008–2011) | R3 |
| `avis` | "Miete von … bis …", Anmiet-/Abgabestation, Gruppe | archive (old) | R3 |
| `cartrawler` | OTA mails (Opodo-style: broker ref + provider number, ISO-like times) | archive, 1 | R3 |

The 2009–2010 Sixt layout (data only in a PDF) and the holiday-autos voucher
get no template — 15 years old, one or three samples; the LLM path reads them.

### 4.2 LLM fallback, then decline

The rail/lodging LLM path with its two rules: the prompt names only fields the
text shows, and every copied value is checked against the text (a confirmation
number or IATA code the mail does not print is dropped). What the LLM cannot
fill to the minimum (provider, a pick-up station, a pick-up day) is declined
with a code, never half-imported. Travel-agent prose usually lands here.

### 4.3 Classification and what is declined

`documentDomain.ts` gains rental signals (pick-up/return word pairs in DE/EN,
"or similar / oder ähnlich", ACRISS-shaped codes beside a class word, provider
sender domains); `rental` joins `OVERRULABLE_DOMAINS`. Declined, each with its
own `RentalFallbackCode`: **parking** (`looksLikeParking` — Einfahrt/Ausfahrt,
Parkhaus, Parkplatz, QR entry; the five archive mails are the negative
fixtures), **marketing / account / survey** (`noItinerary`), a flight or hotel
mail that mentions a car (`otherDomain`), and Europcar's **"on request, not yet
confirmed"** (`notConfirmed`).

### 4.4 Duplicates, changes, cancellations

- **Identity** is `provider + confirmationNumber` (`externalRef`); the review
  marks a known ref as **update**, never new — Alamo sends up to four mails per
  booking.
- **Merge rule** (silent-failure class 4): a later mail fills empty fields and
  replaces one only when the newer mail (by `sentAt`) states a different value
  and the user has not edited it. A poorer value never replaces a richer one
  (class name over ACRISS code, a day over a minute).
- **Change and cancellation mails update or cancel the booking found by
  confirmation number and never create one.** A cancellation for an unknown
  ref is declined (`unknownBooking`). Cancel sets `status = cancelled`; never a
  delete.
- **Unmeasured:** neither corpus holds a change or cancellation mail; this path
  ships on synthetic fixtures and says so in its tests.

### 4.5 Invoices — the source of driven km

Owner rule 2026-10-01: km come from the final invoice, not from typing. An
invoice (mail body or PDF) is parsed **into the existing booking**, matched by
confirmation, agreement or invoice number, and **never creates one** — an
invoice with no match is declined (`unknownBooking`) and listed for the user to
attach by hand. It fills `odometerOutKm`/`odometerInKm`, `distanceKm`
(`distanceSource = invoice`), `vehicleDriven`, the actual return time and
`finalAmount`/`finalCurrency` (extra km, fuel, late-return charges included).
It overwrites a typed km value only after the review shows both; a manual edit
afterwards stays possible and is labelled `user`. The invoice file is kept as a
`Document` on the rental. Without an invoice km stay **null**.

**Unmeasured, and this is the weak point of the whole domain:** neither corpus
holds a single final invoice (§1.3 no. 8). Sixt historically delivers it via
the customer portal, not as a mail. Templates are written per provider only
from real samples; until one arrives the path is the matching + review frame
plus the LLM reader, on synthetic fixtures.

### 4.6 Values deliberately not stored

Licence plate, VIN, unit number, driver's licence data, date of birth, card
digits, home address, the **deposit** (never a cost), and the provider's own
conversion ("estimated cost in native currency" — FX is ours). None answers a
travel question; each is a liability in a backup.

## 5. API

Enveloped family (ADR 0001), declared in `apiResponseShape.baseline.json`,
mounted in `routes/mounts.ts` with the sub-routers before `/:id` as rail:

`/api/v1/rentals`: `GET /` (paged; year/status/provider filters), `GET|PATCH|
DELETE /:id`, `POST /`, `GET|POST /:id/documents`, `GET /stations?q=`
(airports + the user's earlier stations), `GET /entry-suggestions`,
`GET /stats`.

Times in and out in the ADR 0002 D3 shape (`pickupLocal`/`returnLocal` + fold
in; `times.{pickup,return,actualPickup,actualReturn}` as
`{utc, zone, offset, local, precision}` out). OpenAPI in
`services/openapi/paths/rental*.ts` with a registered `RentalBooking` schema;
the coverage, response-schema and time-shape guards hold it from the first
commit. No backend domain gate — the switch hides UI and is no authorisation
boundary (as rail). The upcoming feed (`/upcoming`) gains rentals with a
countdown to pick-up.

## 6. Web UI

- **Registry**: `rental: { key: "rental", available: true, i18nKey:
  "domain.rental", icon: "🚗", color: <token>, routePrefix: "/rentals" }` in
  both `shared/domains.ts`; `LOYALTY_DOMAINS` gains `rental` (DB CHECK →
  migration), since two senders print loyalty numbers.
- **Colour**: `domainColor.rental`, added **upstream first** in the
  Companion's `ClaudeDesign/handoff/tokens.json`, then mirrored into
  `design/tokens.json`, `--ts-domain-rental` and `useDomainColors`. It must pass
  `domainColorsNotStatus.test.ts` and stand apart from flight amber, cruise
  teal, hotel mint, POI ink, road moss and rail lavender (§11 D7).
- **List** (`RentalsPage`, a logbook tab): provider, stations, local pick-up →
  return, days, class, price + currency, status pill.
- **Form** (`RentalFormModal`): provider and broker, confirmation number,
  pick-up station (airport picker / address / an earlier station), "return at
  the same station" ticked by default, local date-times, booked group + example
  + optional ACRISS, car actually driven, payment timing + price
  (`CurrencySelect`), inclusions as chips; km and final amount shown as
  read from the invoice, editable only as a labelled correction;
  companions, trip and roadtrip pickers.
- **Detail** (`RentalDetailPage`): booking, documents, linked trip, roadtrip and
  arrival flight.
- **Map**: a same-station rental is **one point**; a one-way rental is two
  points joined by a **dashed line labelled "not the driving route"**. The
  route a car drove is the roadtrip's layer. Colours via the domain colour
  store only.
- **Upcoming / dashboard**: pick-up countdown in the station's zone (ADR 0002
  D4).
- **i18n**: `i18n/resources/{de,en}/rental.json`; "Mietwagen" / "Rental car";
  DE first, EN in the same change (parity test).
- **Gating hooks**: `useRentalVisible` (flag AND `isEnabled("rental")`) and
  `useRentalOffered` (flag alone, for settings and the setup picker).

## 7. Relations

### 7.1 Trip and flight

- **Trip by overlap**, like lodging: the rental's local days overlapping a
  trip's span → a suggestion; linked automatically only when exactly one trip
  overlaps. A rental extends a trip's bounds like rail.
- **Flight**: `arrivalFlightNumber` + the pick-up day → "picked up after
  flight X" when a logged flight matches; shown, not stored twice.

### 7.2 Roadtrip — the car of the route

A roadtrip has `vehicle` and a free `vehicleName`; the never-built `Vehicle`
catalogue (2026-08-29 §4.5) is not revived. `RentalBooking.routeId` names the
roadtrip the car drove. A rental **suggests itself** to a roadtrip with
`vehicle` in {car, campervan, motorhome, other} overlapping its span; the user
confirms, never automatic. Confirming sets `routeId`, fills an empty
`vehicleName` from the booked group, and **offers** the pick-up and return
stations as the roadtrip's first and last station. Km stay with the roadtrip.

### 7.3 Money — on the rental, not a `TripExpense`

The price lives on the rental, like `Flight` and `LodgingStay`, with an FX
snapshot. forgejo#140's `TripExpense` (uncommitted on `feat/roadtrip-expenses`;
ferry | toll | pitch | fuel | parking | other; no FX columns) is for costs
*during* the drive — fuel and tolls for a rental car go there. Copying the
rental price into an expense would count it twice; the travel account
(`services/stats/tripAccount.ts`) reads the rental as one more priced source.

### 7.4 Statistics — what counts

`shared/rentalCounting.ts` (+ frontend mirror) is the one home:
`COUNTABLE_RENTAL_STATUSES = ["completed"]`. Counted: rentals, **rental days on
the station's local calendar**, providers, station countries (pick-up and
return only), one-way count, cost per day per currency (FX base for totals;
null prices out of the sample, never 0). Km only where an invoice (or a
labelled correction) gave them; a sum of km says how many rentals it covers. Achievements and passport evidence: later (§11 D3, D8).

## 8. Companion contract

No separate document exists; the OpenAPI spec plus ADR 0001/0002 is the
contract. Order, web first (as rail, owner decision 2026-09-25 no. 5):
(1) read list/detail through `/rentals`, D3 time shape, the shared colour
token; (2) active rental and pick-up countdown on the Unterwegs screen, in the
station's zone; (3) create/edit offline via the outbox. The owner opens the
Companion issue; this spec does not.

## 9. Beta gating

```ts
rentalDomain: Object.freeze({
  why: "Car rentals are a new domain (spec 2026-10-01-rental-domain-design), built in packages; the Companion app does not handle rentals yet and no release candidate has carried them.",
  returnsWhen: "The owner explicitly takes rental out of beta. Packages being done is not that event.",
  reason: "beta",
}),
```

Instance flag first, then the user's `enabledDomains`; setup picker and module
toggle offer rental on the flag alone.

## 10. Packages, order, and how each is measured

| # | Package | Measured by |
|---|---|---|
| R1 | Model + migration (`RentalBooking`, companion join, `Document.rentalBookingId` + CHECK, `LOYALTY_DOMAINS`), Zod, CRUD, OpenAPI, registries, beta key, colour token, status derivation + sweep, list + form + detail, DE/EN — **manual entry only** | route tests incl. a time-model suite (DST gap → `LOCAL_TIME_NONEXISTENT`, stations in far-off negative and positive UTC offsets, return before pick-up refused); one failure-path test per silent-failure class (unresolvable station refused, not stored as UTC; geocoder down surfaces as itself); OpenAPI coverage + response-schema + time-shape guards; response-shape ratchet; locale parity; `check:drift`; odd-zone CI runs |
| R2 | Sixt confirmation template (layouts A + B), classifier signals, parking decline, de-duplication/merge, review modal; the invoice frame (§4.5: match-only, never create, km/final amount into the booking) and a **Sixt invoice template as soon as a real Sixt invoice is added to the corpus** | **`test-samples/Mietwagen/` with an `expectations.json`** (like `test-samples/Flug-emails/`), run by the corpus harness: 5/5 bookings with the expected provider, stations resolved to the right airport, local times, payment timing and price; a second run imports 0 new rows. Invoice frame: an unmatched invoice creates nothing (asserted), a matched one fills km and final amount; a Sixt invoice template only with a real invoice in `test-samples/Mietwagen/` and its `expectations.json` entry. Fixtures committed to the repo are synthetic — no corpus value |
| R3 | Alamo (incl. agreement enrichment: odometer *out*, car driven), Europcar, Avis, CarTrawler templates; invoice templates for any provider whose real invoice has arrived; LLM fallback with value check | the archive, **locally only**: of the 34 rental mails each yields a booking or a correct merge, ≈ 25 distinct bookings after de-duplication; 0 of the 19 non-rental mails yields a candidate; the three package mails import with price null, never 0. Only counts are recorded; synthetic fixtures carry the shapes into CI |
| R4 | Trip overlap, roadtrip suggestion + station offer, flight link, travel account, `rentalCounting`, stats, export/backup, demo seed | counting truth-table tests on both mirrors; export round trip; a browser look at the map in a production build (one point / dashed one-way) |
| R5 | Companion read + Unterwegs countdown, `/upcoming` | Companion contract tests against the OpenAPI schema; shared time vectors |

## 11. Open decisions for the owner

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | One-way rental on the map | (a) dashed line labelled "not the driving route"; (b) two points only; (c) nothing until a roadtrip exists | **(a)** — two unconnected pins read as two rentals |
| D2 | May a rental create a roadtrip? | (a) never, suggest linking only; (b) offer "create roadtrip from this rental" with the two stations; (c) automatic | **(b)**, offered not automatic — matches the rail conversion idiom |
| D3 | Do rental days count anywhere beyond the rental stats? | (a) only in rental stats; (b) also in "days travelling"; (c) also as passport evidence | **(a)** — days travelling come from the trip; passport evidence later |
| D4 | Which name is "the company" in stats? | (a) provider (counter); (b) broker; (c) both, separately | **(c)**, ranked by provider; broker shown on the row. Measured: Holiday Extras appears in the archive only as an **airport-parking** broker, not for rentals — the Alamo bookings went through a tour operator and, once, holiday autos |
| D5 | Insurance and extras | (a) not stored; (b) codes only (included/bought); (c) codes with prices | **(b)** — prices per extra appear in two senders only and never feed a statistic |
| D6 | Rental price vs forgejo#140 | (a) price on the rental, fuel/toll as `TripExpense`; (b) the rental price as an expense | **(a)** — (b) counts it twice |
| D7 | Colour | a new token upstream; candidate a dusty rose near `#d98cb3` | decide with Design/Companion; must clear the status-colour test |
| D8 | Countries driven through on a rental's roadtrip | (a) countries only from the stations; (b) attribute the roadtrip's countries to the rental | **(a)** — the roadtrip already counts its own countries |
| D10 | Which amount counts as the cost of a rental? | (a) the booked price; (b) the invoice's final amount when present, else the booked price; (c) both shown, stats use (a) | **(b)** — the invoice is what was paid; the row shows which one it is |
| D11 | Where do invoices come from? | (a) mail/PDF upload only; (b) also a reminder after return ("invoice missing — upload it for the km") | **(b)** — with no invoice in either corpus, the km of every rental depend on the user fetching it from the provider's portal |
| D9 | Time storage wording | the controller's brief said "stored as LOCAL wall-clock"; ADR 0002 D1 stores a UTC instant **plus** the station zone, the wall clock derived | **follow ADR 0002** — the client still sends and sees the station's wall clock |
