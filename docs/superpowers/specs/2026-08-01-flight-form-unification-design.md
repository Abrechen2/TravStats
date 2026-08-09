# Flight form unification — design

**Date:** 2026-08-01
**Issues:** #199 (forms are inconsistent), #200 (actual and scheduled times)
**Status:** approved by the owner 2026-08-01

## Problem

Adding a flight and editing a flight are two separate forms with different fields
and a different time input. The user calls this confusing, and points at cruises,
where one form already serves both paths.

`FlightCompleteStep.tsx` (864 lines, the create path's last step) and
`FlightEditModal.tsx` (833 lines) each own their own field list. They drifted
because nothing holds them together: #197 added booking and ticket number to the
create form only, and it took a bug report to notice.

## What the audit actually found

Every claim below was checked against the source, not remembered. Three of the
first-draft assumptions were wrong and are recorded here so they are not
re-introduced.

**Already identical — do not touch:** price, currency, notes, seat class
(including `premium_economy`), booking reference, ticket number, companions,
tags, terminal, gate, seat, category, airline, operating airline, aircraft,
flight number, the arrival-day-offset checkbox and the estimate hints.

**Status is already unified and must stay as it is.** Since `status-from-dates`
it is a derived read-only pill plus a single "Cancelled" checkbox. Both forms
already render exactly that. A status picker would undo a deliberate 2.5.0
decision.

**Four fields exist but are invisible in both forms:** `baggageAllowance`,
`frequentFlyerNumber`, `bookingClassLetter`, `coPassengers`. They appear zero
times in `FlightCompleteStep.tsx`. They live in `useFlightForm` state, are filled
by the parser and are persisted, but the only way a user can see or correct them
today is the Excel round-trip (`xlsxRoundTrip.ts`) — export, edit, re-import.

**`receiptUrl` is a file upload, not a URL text field.** `ReceiptUpload.tsx`
uploads a file; the server stores it and returns the path.

**#200 is mostly built already.** `actualDeparture`, `actualArrival` and
`delayMinutes` exist on the model; the delay is computed on update
(`routes/flights.ts:1058`) and kept in sync by `pendingUpdateService`; live
tracking and lookup fill them. No form displays them. #200 is therefore a UI
task, not a schema task, and it belongs in the same fieldset this change rebuilds.

**The catalogues from #189/#191 never reached the form.** Airline and aircraft
are free-text inputs; no picker component exists.

## Decisions

| Question | Decision |
|---|---|
| Shape | One component serves both modes, `mode: "create" \| "edit"` |
| Time input | Separate date + time fields everywhere |
| Airports in edit | Editable |
| Status | Unchanged — derived pill + Cancelled checkbox |
| #200 | Folded in: scheduled times, actual times, derived delay pill |
| Airline / aircraft | Catalogue-backed pickers |
| The three hidden booking fields | Made visible and editable |
| `coPassengers` | NOT an input — read-only hint with a take-over action |

### Field moves

Into **create**: boarding group, taxes, fees, receipt upload, trip assignment.
Into **edit**: departure airport, arrival airport.
Into **both**: actual departure/arrival + delay pill; booking class, baggage
allowance, frequent flyer number; catalogue pickers.

### Why `coPassengers` is not an input

The schema draws a deliberate line: `companions` is the user's curated travel
group, `coPassengers` is what the parser read out of the booking mail. Two input
fields with near-identical labels would recreate exactly the confusion #199 is
meant to remove. Instead the parsed names appear read-only beneath the companions
field with a "take over" action that copies them into `companions`. Raw stays
raw, curated stays curated, and the parsed data finally has a use.

## Structure

`FlightFormFields` is a new presentational component holding the union of fields.
Both entry points render it:

- create: `SimplifiedFlightFormV2` → lookup steps → `FlightFormFields mode="create"`
- edit: `FlightEditModal` → `FlightFormFields mode="edit"`

Only two things differ by mode: the lookup steps run in create only, and the
submit label. Everything else is the same markup.

The two source files total 1,700 lines. The shared field set must be *extracted*,
not concatenated — house limit is 400 lines per file, 800 hard. Expect
`FlightFormFields` to split further by section (route, times, booking, cost).

## Interface to the companion work

The companions control is specified here as a picker with autocomplete over the
user's known companions, free entry still allowed. Where those names are stored
is owned by a separate design (`2026-08-01-companion-entity-design.md`). This
form consumes a list and emits a list; it does not care whether the backing store
is an array or an entity.

## Risks

**Timezone handling in edit is the dangerous part.** The current modal seeds the
datetime inputs browser-local, then re-renders them airport-local once the airport
timezones resolve, tracking that transition in `hydratedRef` so submit pairs the
values with the matching timezone basis. This is why a no-op edit round-trips
losslessly instead of drifting when the browser timezone differs from the
airport's. Splitting one `datetime-local` into a date field and a time field must
preserve this exactly. This is the single most likely place to introduce a silent
data bug, and it deserves tests that assert a no-op edit does not move the stored
UTC value, across a browser/airport timezone mismatch.

**Airport changes have consequences.** Server-side already handled: the update
route accepts both airports and recomputes `co2Kg` and `routeDistance` on every
update. To verify: that achievements and statistics stay consistent afterwards.

**Help texts and historical entry are asymmetric.** Create has twelve inline help
texts and allows day-level precision for historical flights; edit has neither.
Unifying means both appear in edit too.

## Testing

- Unit: the shared component renders the same field set in both modes.
- Unit: a no-op edit preserves the stored UTC departure/arrival, with browser
  timezone deliberately different from both airports'.
- Unit: the take-over action copies parsed names into companions without
  mutating `coPassengers`.
- Unit: delay pill derives from actual vs. scheduled, and is absent when actual
  times are unset.
- Browser: create a flight, edit it, change an airport, confirm distance and map
  update; confirm the console stays clean.

Green tests are not sufficient evidence here — three of the errors this audit
found were invisible to the test suite and visible on screen.

---

## Verified inventory (2026-08-01, after the companion entity landed)

Assembled twice independently — once by reading the repo directly, once by a cold
Codex pass — and reconciled. Each side found things the other missed, and each
side got something wrong. The list below is what survived checking.

### Mount points and payload builders

The create form is mounted from **three** places, not one:
`pages/FlightsTablePage.tsx`, `components/Dashboard/DashboardLayout.tsx:89` and
`components/Dashboard/tabs/FlightsTab.tsx:302`. (The cold pass claimed only the
first; the other two were verified by reading the imports.)

Flight payloads are additionally built outside any form by:
- `lib/flightDuplicate.ts` — "duplicate same / return", swapping airports for the
  return leg
- `components/Cruise/CruiseImportPreviewModal.tsx` — the cruise import creates
  flights through `flightsApi` with `FlightInput[]`
- `components/SpecialFlightModal.tsx` — calls both create and update
- `pages/FlightsTablePage.tsx` — owns `handleAddFlight` / `handleUpdate` and the
  duplicate-row POST

`DashboardLayout` and `FlightsTab` import only `type { FlightSubmitOptions }`
from `useFlightForm`; the hook itself is used solely by `SimplifiedFlightFormV2`.

> **Correction (2026-08-02, found by the phase 2 gate's grep proof).** This
> inventory missed a form. `components/FlightReviewModal.tsx` (772 lines,
> mounted from `SimplifiedFlightFormV2.tsx:249`) is a THIRD flight form — the
> parser-review step — and it renders its own airport pickers, booking
> reference, ticket number, price, taxes and fees inputs, none of them from
> `FlightForm/fields/`. Both passes that built this list read past it, so
> "unification" as scoped by phases 1 and 2 covers two of three forms.
> Absorbing the third is not a mechanical swap: its inputs carry parser
> decoration the shared components do not model — a per-field source border
> (`getFieldBorderClass`: template/llm/empty), the inferred-value badge, and
> the confidence colouring. That needs its own spec pass, and the decision to
> take it on is separate from shipping these two phases.

### The API contract is already what the unified form needs

Both POST and PUT take `departure` / `arrival` **objects** with required
`lat`/`lon` and optional `iata`/`icao`/`name`, and times as local wall-clock plus
IANA zone: `departureLocal`+`depTimezone`, `arrivalLocal`+`arrTimezone`. The
paired timezone is required whenever the local string is present. The server
converts with `fromZonedTime`.

**Both existing paths already emit exactly these field names.** An earlier
reading of this file suggested edit sent `departureTimezone`/`arrivalTimezone`;
that was wrong — those names belong to the local helper
`estimateArrivalFromDeparture`, not to the payload. The unification therefore
does NOT need a new conversion: create already composes the combined string from
separate fields via `buildLocalString(date, time)`, which is precisely what edit
will need after the split.

PUT already accepts changed airports and recomputes status, CO₂, route distance,
the next API-check time, and `delayMinutes`.

### Where the two paths genuinely diverge

1. Create emits `depTimeSemantics` / `arrTimeSemantics` from
   `historicalDateShape()` for partial historical dates. Edit has no equivalent.
2. Create assumes airport-local from the outset. Edit starts from a stored UTC
   instant and preserves it only by pairing the displayed string with the
   timezone basis used to display it.
3. Edit's timezone source is the existing flight's airport codes. Once airports
   become editable, the source becomes the user's selection — the zone must
   follow the airport the user picks, not the one the flight was stored with.

### More fields that exist but are rendered nowhere

Beyond the four already known (`baggageAllowance`, `frequentFlyerNumber`,
`bookingClassLetter`, `coPassengers`):

- `actualDepartureLocal` / `actualArrivalLocal` are accepted by the API **and
  already have DE and EN i18n keys** — issue #200's groundwork is further along
  than assumed; only the controls are missing.
- `airlineIata`, `airlineIcao`, `operatingAirlineIata`, `operatingAirlineIcao`,
  `callsign`, `aircraftRegistration`, `aircraftModeS`, `depTimeSemantics`,
  `arrTimeSemantics` are persisted and never exposed.

### Tests that will break, by construction

`__tests__/SimplifiedFlightFormV2.test.tsx`,
`__tests__/components/FlightEditModal.test.tsx` (hard-codes the element ids
`#editDepartureTime` / `#editArrivalTime` and asserts save payloads),
`FlightForm/useFlightForm.bookingFields.test.ts`,
`FlightForm/useFlightForm.dateShape.test.ts`,
`FlightForm/FlightCompleteStep.status.test.tsx`,
`__tests__/flightsApiCreate.test.ts`, `backend/src/__tests__/flights.test.ts`,
and `e2e/flights.spec.ts`. No snapshot tests were found.

### What this does to the risk estimate

Lower than the spec first assumed. The riskiest part — the timezone mechanism —
needs no new conversion logic, only the same one applied on both sides, plus one
new rule: hydration must move the date field and the time field **together**, and
submit must pair both with one basis. Splitting them apart is what produces a
value that is half browser-local and half airport-local, which stays invisible
wherever the two zones happen to agree.
