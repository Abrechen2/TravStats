# Template engine v2: every issuer in the template repo, package tours included

Branch: `dev/template-engine-v2` (long-running — merge `main` in after every release, never rebase).
Builds on `docs/superpowers/specs/2026-09-30-parser-system-design.md` (packages 3 and 5) and
`docs/superpowers/plans/2026-09-17-parser-templates-all-domains.md` (phases 2, 3, 5).

## Owner rulings (2026-10-09)

1. **Only generic readers are compiled into the server.** Generic = standards and the model:
   IATA BCBP boarding-pass barcodes, QR/PDF417 decoding, structured mail data (schema.org
   JSON-LD, iCal), the LLM parser, and the template engine itself. Everything that names an
   issuer — airlines, Booking.com, TUI, Accor, Hilton, HRS, DB, AIDA, Berge & Meer — lives in
   `Abrechen2/travstats-templates`, so a layout fix reaches every instance without a release.
2. **Package tours become a template domain.** This reverses spec §11 ("a tour/roadtrip parser
   domain … out of scope"). One document yields a *trip proposal*: trip, flights, stays, an
   optional cruise, one booking with the total price, and the document itself.
3. **Country relevance orders, never filters.** Every template carries `markets` (ISO 3166-1
   alpha-2). All templates are loaded; those matching the user's home country are tried first.
   A booking with a foreign operator is still recognised. New user setting: home country.
4. **Order of work:** engine → package tours (Berge & Meer usable) → move every built-in issuer
   reader into the repo → countries.

## Why

Measured on the owner's own Berge & Meer documents (10 PDFs, 7 trips, 2022–2026): each one
carries 4–6 flights with local times, 6–14 hotel nights with names and addresses (travel
documents) or the package price, excursions and discounts (invoice). Entering one trip by hand
took ~15 API calls and two gaps the API could not close (#355, #356). A user-uploaded PDF
should produce the same result as a reviewable proposal.

## Phases

### P1 — v2 envelope, validator, loader (server)
- `services/parsers/templates/v2/`: the envelope type from spec §6 (`id`, `domain`, `version`,
  `issuer`, `markets`, `match`, `extraction`, `testCases`, `minAppVersion`) and one Zod
  validator shared by the loader and the repo CI.
- Loader: v2 `index.json` first, v1 `templates/index.json` fallback; disk cache; 24 h refresh;
  each template's `testCases` run before it is activated; reasons
  `fetch_failed | invalid | tests_failed | needs_newer_app`, surfaced in `/template-status`.
- Source URL becomes an admin setting (default: the public repo).
- Guard: a template whose test case fails is never active; a test pins that.

**P1 as built (2026-10-09).** `services/parsers/templates/v2/`: `envelope.ts` (the one Zod
schema + index schema), `version.ts` (numeric compare for semver and `YYYY.MM.DD[.N]`),
`runners.ts` (domain → test runner; P1 registers the matcher for all five domains — it decides
match/decline from `markers`/`anchors` and ignores `expected`), `loader.ts`
(`V2TemplateStore`), `cache.ts` (`.template-cache/v2/<domain>__<slug>.json`), `status.ts`.
- The v1 airline sync still runs on every sync, after v2: airlines have no v2 templates
  until P4, and with the v2 index absent the v1 requests are byte-for-byte the old ones.
- A newer version that fails keeps the older active one (status carries a `detail`); a
  template the index stops naming is deactivated and uncached; a domain with no runner is
  `invalid`.
- `/template-status` gains a `v2` field (`index`, `templates[]` with `state`, `reason`,
  `detail`); the v1 fields are unchanged.
- **Source URL is still an environment variable, not yet an admin setting:**
  `TEMPLATE_REPO_BASE_URL` (repository raw root, https only, default the public repo).
  Moving it into `admin_settings` with a settings UI field is the open remainder of P1.
- The repository's `rail/db.json` draft does not validate yet: its test case has no
  `expect` and no must-decline case. `testCases[].input` accepts the draft's
  `{ subject, text, from? }` object as well as a plain string.

### P2 — generic extraction constructs
- `repeat` block for every domain (`mode: split | matchAll`, `startAfter`, `endBefore`,
  per-field rules) — generalises flight `segments` and the rail draft's `legs.repeat`.
- Transforms the corpus needs: two-digit-year dates, `+1` day rollover, `QR 070` flight numbers,
  city name → IATA via the airport catalogue, money with German separators.

**P2 as built (2026-10-09).** One generic, domain-agnostic engine in
`services/parsers/templates/v2/`; nothing in it knows what a flight or a stay is (that is P3).
- `extraction.ts` — the Zod schema that replaces the opaque `extraction` record (strict: an
  unknown key such as `field` is refused):
  `{ fields?: name → FieldRule, repeats?: name → RepeatRule, required?: string[] }`.
  A `FieldRule` is `patterns` (value = named group `v`, else group 1, else the whole match;
  first pattern whose value survives its transforms wins; flags default `im`, `g` ignored) XOR
  a constant `value`, plus `transform` (one name or a list, applied in order). A `RepeatRule`
  is `mode: "matchAll"` (`pattern`, `fields: name → { group: name | index, transform? }`) or
  `mode: "split"` (`splitPattern`, `fields: name → FieldRule` per block), both with optional
  `within: { startAfter?, endBefore? }`, `flags` (default `gim`, `g` forced) and `minimum`
  (default 1). Refused at validation: a regex that does not compile, a repeat or `within`
  pattern that matches the empty string, a matchAll `group` the pattern lacks, an unknown
  transform, flags outside `gimsu`, a `required` name that is neither field nor repeat, a
  name that is both.
- `transforms.ts` — pure and total (unreadable input → `null`, never a throw): `trim`, `text`,
  `upper`, `lower`, `titleCase`, `digits`, `integer`, `money`, `currency`, `date`
  (`YYYY-MM-DD`; `dd.mm.yy` is 20yy; German/English month names and abbreviations),
  `time` (`HH:MM`), `dayOffset` (`+1` → 1, missing → 0), `flightNumber`, `iata`. Dates and
  times stay calendar strings — no `Date`, so no host zone.
- `extract.ts` — `extract(extraction, text) → { values, missing }`. Regexes compiled once per
  extraction object (WeakMap). Split blocks start AT each `splitPattern` match (the header
  line is part of its block); text before the first match is a block too. A repeat item the
  text contributed nothing to is dropped (constants and a defaulted `dayOffset` do not count
  as "read"). Bounds: input capped at 200 000 characters, each repeat at 200 items.
- `runners.ts` — `extractionRunner` is now the default for all five domains: match iff the
  matcher accepts AND nothing `required` is missing. A match case with `expected` must
  deep-partially equal the values (objects: expected keys only; arrays: same length, in
  order); a failure names the first differing path, e.g.
  `"the invoice is read": expected.flights[1].to: expected "MBA", got "NBO"`, and a decline
  that should have matched lists what was `missing`. A runner that reports no values
  (`matchOnlyRunner`, kept for tests) FAILS a case with `expected` instead of passing it
  unchecked. `applyTemplate(template, input) → { matched, values, missing }` is the public
  entry for P3/P4; when the matcher declines it extracts nothing.
- Pinned by `__tests__/{transforms,extract,runners}.test.ts`, including an invented
  tour-operator invoice (`tourOperatorFixture.ts`: four flight lines with `+1` arrivals, two
  stays in split mode, total `3.249,00 EUR`) read end to end through `validateEnvelope` and
  its own test cases.
- **Not done here:** city name → IATA via the airport catalogue. It needs the catalogue, so
  it cannot be a pure transform; it belongs to the consumer (P3) or to a lookup step injected
  into `extract`. The rail draft's `legs.repeat` shape still differs from `repeats` and is
  refused until the template repository moves to it.

### P3 — package domain + trip proposal
- `extraction` for `domain: "package"`: `booking` fields (reference, issued on, travellers,
  total, currency, line items), repeat blocks `flights[]`, `stays[]`, optional `cruise`.
- `parseDocument` gains a `package` body; routes return it as a **trip proposal**.
- Preview/commit service: match an existing trip (by booking reference, then date overlap),
  existing flights (number + day) and stays (lodging name + check-in); propose create vs.
  attach; commit through the existing services. Fixes #355 on the way (flight create keeps
  `tripId`) and the booking gaps noted on #356 (set a booking's trip, file flights on it).
- Two documents of one booking (invoice + travel documents, `/1`, `/2E`, `1R`) merge by
  booking reference: the later one completes the proposal, never duplicates it.
- Frontend: a proposal screen (DE/EN) — what is new, what attaches, what conflicts.
- First template: `package/berge-meer-invoice.json` + `package/berge-meer-documents.json`
  in the repo, with **invented** test cases (CONTRIBUTING rule) shaped like the real layout.
  The TypeScript reader `services/trip/tripDocumentParser.ts` is the reference and is deleted
  once the templates pass the same measurement (`scripts/measureTripSamples.ts`).

**P3 as built (2026-10-09).**
- **Contract** `services/trip/package/contract.ts`: one Zod schema over
  `applyTemplate(...).values`. Fields `bookingReference` (≤20), `issuedOn` (both required),
  `tripName`, `startDate`, `endDate`, `travellers`, `totalPrice` (needs `currency`),
  `currency`, `cruiseShip`, `cruiseFrom`, `cruiseTo`, `cruiseCabin`, plus `cruiseStart` /
  `cruiseEnd` (beyond the plan: a cruise row needs a start day; an undated cruise is skipped
  with `cruiseUndated`, never dated from the package span). Repeats `flights`
  (`flightNumber`, `date`, `depIata|depCity`, `arrIata|arrCity`, `depTime`, `arrTime`,
  `arrDayOffset`, `airline`; ≤40) and `stays` (`name`, `checkIn`, `checkOut`, `address`,
  `city`, `country`, `board`, `room`; ≤60). Flight numbers are canonicalised (`GF 0086` →
  `GF86`); every string and list is bounded.
- **Parsing**: `package` is in `PARSER_SUPPORTED_DOMAINS` as a parse target that is not a
  `DomainKey` (`PACKAGE_PARSE_TARGET`). `parseAs("package")` tries the active v2 `package`
  templates (`parsePackage.ts`); first match whose values pass the contract wins. No reader
  is compiled in; `fallbackCode` `noTemplate` / `invalidReading` (+ `issues`).
  `documentDomain.scoreDocument` gives `package` no static signal — an active package
  template's matcher scores 25 (`package-template:<id>`), above what the same invoice
  scores as flight. `documentValues` / `storedReading` read a stored package body.
- **City → IATA** (`airportByCity.ts`): active airports with IATA, three passes — city equals
  the name (parenthesised district ignored), airport name starts with it, city starts with
  it. Several hits = `ambiguous` with candidates, none = `unknown`; both skip the leg
  (`unresolvedAirport`) until the reviewer picks (`choices.airports`). The catalogue has no
  scheduled-service flag (the OurAirports column is dropped at seeding), so "prefer
  scheduled service" is not applied — store `scheduled_service` first if it is wanted.
- **Proposal / commit** (`proposal.ts`, `matching.ts`, `commit.ts`): trip by booking
  reference (case-insensitive) else `soleOverlappingTrip`; flights by `flightExternalRef`,
  else number (spaced or not) + local departure day; stays by `normalizeLodgingName` +
  check-in; cruise by `cruiseExternalRef` or reference. A row on another trip is `skip` +
  warning, never moved; an attach sets only a missing `tripId` / `bookingId`; a booking keeps
  a stored price (`priceConflict`). The commit rebuilds the proposal, prepares every row
  before the transaction (`buildFlightCreateData`, `buildLodgingCreateData`,
  `buildStayCreateData` — split out of the batch route and the lodging writers) and writes
  trip, booking (FX on `issuedOn`), flights, lodgings, stays, cruise and the document's
  filing (`linkDocumentsInTx`) in ONE transaction. Invalid leg → 422 `PACKAGE_FLIGHT_INVALID`
  (`field: flights[i]`), nothing written.
- **Routes** `POST /trips/package/preview` and `/commit` (`routes/trips/tripPackage.ts`,
  enveloped, mounted before `trips`), body `{ reading?, documentId?, choices? }`; OpenAPI in
  `paths/tripPackage.ts`.
- **#355** `POST /flights` keeps `tripId` (create schema only, ownership → 404
  `TRIP_NOT_FOUND`). **#356** `PATCH /trips/bookings/:id` takes `tripId`;
  `POST /trips/bookings/:id/flights` files flights on a booking (all or nothing). The booking
  routes moved to `routes/trips/tripBookings.ts` (trips.ts was at 800 lines).
  Not done: `POST /flights/batch` still ignores a `tripId` in its rows.
- **Frontend**: the trip import's drop zone parses as `package` (`parseAs`), keeps the PDF,
  and opens `PackageImportPreviewModal` (badges, reasons, warnings, airport picks, trip
  name); commit is the one server call.
- **Templates**: `docs/templates-drafts/package/berge-meer-{invoice,documents}.json` with
  invented cases; `__tests__/templateDrafts.test.ts` proves validation, own cases and
  contract conformance. Not yet in the template repository. **Unverified against the real
  PDFs**: `issuedOn` is read from a `Datum:`/`Rechnungsdatum` line the invented layout
  carries — `tripDocumentParser.ts` reads no issue date, so whether the real documents print
  one is open; run `scripts/measureTripSamples.ts`-style measurement before publishing. The
  invoice template reads no stays (the reference reader does not either).
- Still open from P3: a mail's PDF attachment is not routed to the package reader (spec
  package 2); `tripDocumentParser.ts` stays until the templates pass the measurement.

### P4 — move the issuer readers out
- Airlines v1 → v2 `flight/`; lodging built-ins (koa, hilton, travelclick, check24, accor, hrs)
  → `lodging/` (exports exist, need test cases); rail DB → `rail/`; cruise AIDA/TUI → `cruise/`;
  Booking.com and TUI code readers → templates (engine gaps found here go back to P2).
- Each move: template passes the same fixtures the code reader passed, then the code is deleted.

### P5 — markets
- `markets` on every template; user setting "Heimatland / Home country" (DE/EN);
  engine orders candidates home-market first. No filtering.

## Out of scope here
- Sharing user templates (spec package 4).
- Attachment routing for flight/lodging mails (spec package 2) — needed for mails, not for
  uploaded PDFs; scheduled after P3.
