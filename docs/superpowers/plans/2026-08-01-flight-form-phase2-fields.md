# Flight Form Unification — Phase 2: the visible fields

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish issue #199 — every field group shared between the create and edit forms, and the field asymmetries the issue actually complained about removed.

**Architecture:** Phase 1 established the pattern with `TimesFields`: extract a field group into `FlightForm/fields/`, characterise both sides first, swap both callers onto it, and prove by grep that no second implementation survives. Phase 2 repeats that for the remaining groups and moves the fields that exist on only one side.

**Tech Stack:** React + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-flight-form-unification-design.md`, including its "Verified inventory" section.

**Depends on:** Phase 1 (`docs/superpowers/plans/2026-08-01-flight-form-phase1-times.md`) — merged, giving `TimesFields`, `RouteFields`, `useAirportLocalTimes`, the exported `buildLocalString`, and two standing guards.

## Global Constraints

- Both standing guards must stay green and must NOT be edited:
  `frontend/src/__tests__/components/FlightEditModal.timezone.test.tsx` (an unedited open-and-save must not move the stored UTC instant) and
  `frontend/src/components/FlightForm/useFlightForm.timeSubmit.test.ts`.
- The API contract does not change.
- DOUBLE quotes (`frontend/.prettierrc` sets `"singleQuote": false`), printWidth 100.
- `useTranslation` from the project wrapper `"../hooks/useTranslation"`.
- German first with an English mirror — both resource files, never one side. Note that several `flights.json` keys bake a required asterisk into the string; check before reusing one in a context where the field is optional.
- No `any`, no `console.log`; the frontend logger is a NAMED export. Tests are Vitest.
- Do NOT run `npx prettier --write` inside `backend/` — no `.prettierrc` there, so it picks up the frontend's config and requotes whole files.
- `FlightEditModal.tsx` is over the 800-line house cap. Every task in this plan must leave it SMALLER than it found it. That is the point of the phase, not a side effect.

## Lessons from Phase 1 that bind every task here

1. **Characterise both sides before swapping.** A test that pins what each form submits today, passing before and after unedited, is what proves a swap changed nothing. Phase 1 learned that this must sit at the layer the change touches — a payload-level test does not catch a mis-wired `onChange`.
2. **A test mock must emit the order the real component produces.** Two consecutive Phase 1 regressions survived because a mock exposed independent buttons whose order the test author chose, and the chosen order was the reverse of the browser's.
3. **No cosmetic warnings.** A hint about an abandoned edit cost four fix rounds and was ultimately deleted. Build the fields; do not build advice about the fields.
4. **Declare deviations, and stop when a fix needs its own scaffolding.** Every task below inherits the standing instruction: if closing a finding requires new machinery, a fight with the test environment, or a second layer of debugging, stop and report instead of pressing on.

## File Structure

**Create**
- `frontend/src/components/FlightForm/fields/BookingFields.tsx` — booking reference, ticket number, booking class, baggage allowance, frequent flyer number
- `frontend/src/components/FlightForm/fields/CostFields.tsx` — price, currency, taxes, fees, receipt upload
- `frontend/src/components/FlightForm/fields/CompanionsField.tsx` — the companions picker plus the read-only parsed-names row

**Modify**
- `frontend/src/components/FlightForm/fields/RouteFields.tsx` — catalogue-backed airline and aircraft pickers
- `frontend/src/components/FlightEditModal.tsx` and `frontend/src/components/FlightForm/FlightCompleteStep.tsx` — consume all of the above
- `frontend/src/components/FlightForm/useFlightForm.ts` — expose the fields the create path lacks, including `boardingGroup`, which the hook does not know at all today

**Verification note:** every field the mockup annotates as new or changed maps to a
task here or was built in Phase 1. That mapping was checked field by field against
`docs/design/flight-form-mockup.html`; it is what surfaced the missing boarding
group. Re-run that check if the mockup changes — the mockup is the binding target.

**Deliberately NOT in this phase:** the `SpecialFlightModal`, which edits flights through its own form and has no test file at all. It shares the API contract, not the components. Bringing it in would double this phase's blast radius; it gets its own decision once the two main forms are one.

---

### Task 1: Catalogue pickers for airline and aircraft

Issues #189/#191 made Airline and Aircraft real tables with an admin UI and a resolver. The forms never noticed — both still take free text, which is the fragmentation the catalogue was built to end.

**Files:**
- Modify: `frontend/src/components/FlightForm/fields/RouteFields.tsx`
- Test: `frontend/src/components/FlightForm/fields/__tests__/RouteFields.test.tsx`

- [x] **Step 1: Find out what the backend actually offers**

Before designing anything, find the endpoints that list or search airlines and aircraft, and report their shapes. The admin UI for "Airlines & Aircraft" consumes them already — read that first rather than inventing a new endpoint. If no suitable read endpoint exists for non-admin users, STOP and report: that is a backend task and a decision for the owner, not something to improvise.

- [x] **Step 2: Write the failing tests**

Assert that typing filters to catalogue entries; that a catalogue pick submits the code the API expects (check whether that is the IATA, the ICAO, or the display name — read the write path, do not assume); and that free entry still works for an airline not in the catalogue. That last one is not optional: a picker that refuses unknown airlines makes the form unusable for exactly the flights that need manual entry.

- [x] **Step 3: Run them and confirm they fail.**

- [x] **Step 4: Implement, reusing the existing picker pattern**

`AirportAutocomplete` is the house pattern for exactly this shape. Follow it rather than inventing a second interaction model. Note its `onMouseDown={(e) => e.preventDefault()}` on option buttons — that is a real fix for a real focus bug, and a new picker needs it too.

- [x] **Step 5: Both forms, both suites, both guards, tsc, lint** — each on its own line.

- [x] **Step 6: Commit**

```
feat(flights): pick airlines and aircraft from the catalogue

#189/#191 made these real tables; the forms still took free text, which is the
fragmentation the catalogue exists to end. Unknown entries remain enterable —
a picker that refuses them would break manual entry for the flights that need
it most.
```

---

### Task 2: Shared booking fields, and the three that were never visible

Booking reference and ticket number are already on both sides. Booking class, baggage allowance and frequent flyer number are persisted, filled by the parser, and rendered by neither form — the only way a user can see or correct them today is the Excel round-trip.

**Files:**
- Create: `frontend/src/components/FlightForm/fields/BookingFields.tsx` + test
- Modify: both forms

- [x] **Step 1: Characterise both sides**

Add a test to each form's suite pinning what it submits today for `bookingReference` and `ticketNumber`. Both must pass before you touch anything, and both must still pass unedited afterwards.

- [x] **Step 2: Write the failing tests for the new fields**

Assert that `bookingClassLetter`, `baggageAllowance` and `frequentFlyerNumber` render in BOTH modes, that editing them submits them, and that leaving them untouched submits them unchanged rather than clearing them. That last assertion is the one that matters: these fields arrive pre-filled from the parser, and a form that silently blanks a field it merely displayed would destroy data on every save.

- [x] **Step 3: Run them and confirm they fail.**

- [x] **Step 4: Extract and swap.** Both forms render `BookingFields`; no booking input survives outside it. Prove it by grep and report the result.

- [x] **Step 5: Full run, both guards, tsc, lint** — each on its own line.

- [x] **Step 6: Commit**

```
feat(flights): show the booking fields the parser has been filling silently

Booking class, baggage allowance and frequent flyer number were persisted and
rendered nowhere — correcting a mis-parsed value meant exporting to Excel,
editing, and re-importing. They now appear in both forms, and a save leaves an
untouched value alone rather than blanking it.
```

---

### Task 3: Shared cost fields, and the four the create form lacks

Taxes, fees, the receipt upload and — with Task 4 — the trip assignment exist only in the edit form. A user adding a flight has to save it and reopen it to record what it cost.

**Files:**
- Create: `frontend/src/components/FlightForm/fields/CostFields.tsx` + test
- Modify: both forms

- [x] **Step 1: Characterise both sides** for `price` and `currency`, as in Task 2.

- [x] **Step 2: Write the failing tests**

`taxes` and `fees` render and submit in both modes; the receipt upload renders in both. Note that the receipt is a FILE UPLOAD, not a URL text field — `ReceiptUpload.tsx` uploads a file and the server returns the stored path. An abandoned create-form upload is swept by an existing 90-day orphan cleanup, so uploading before the flight exists is safe.

- [x] **Step 3: Run them and confirm they fail.**

- [x] **Step 4: Extract and swap.** Grep-prove no second cost input survives.

- [x] **Step 5: Full run, both guards, tsc, lint.**

- [x] **Step 6: Commit**

```
feat(flights): record cost and receipt while adding a flight

Taxes, fees and the receipt upload existed only when editing, so recording what
a flight cost meant saving it and reopening it.
```

---

### Task 4: Trip assignment in the create form

- [x] **Step 1: Read how the edit form does it first.** Trip assignment is NOT part of the flight update payload — it goes to a separate endpoint (`POST /trips/:id/flights`), because `Flight.tripId` is owned by the Trip relation. The edit modal applies it after a successful save, deliberately, so a failed field-save does not silently move a flight between trips. Preserve that ordering.

- [x] **Step 2: Write the failing test.** Creating a flight with a trip selected results in both the flight create AND the trip assignment, in that order, and a failed create does NOT attempt the assignment.

- [x] **Step 3: Run it and confirm it fails.**

- [x] **Step 4: Implement**, keeping the two-call ordering.

- [x] **Step 5: Full run, both guards, tsc, lint.**

- [x] **Step 6: Commit**

```
feat(flights): assign a trip while adding a flight

Previously a new flight had to be saved and reopened to join a trip. The
assignment still runs as a second call after a successful create, because the
relation is owned by the trip, not the flight.
```

---

### Task 5: Companions, and the parsed names beside them

The companion picker already exists and both forms render it. What is missing is the parsed `coPassengers` — names the parser read out of the booking mail, stored, and shown nowhere.

**Files:**
- Create: `frontend/src/components/FlightForm/fields/CompanionsField.tsx` + test
- Modify: both forms

- [x] **Step 1: Write the failing tests**

The parsed names render read-only beneath the companions picker when present, and not at all when absent. A "take over" action copies them into `companions` WITHOUT mutating `coPassengers`. After taking over, the row either disappears or shows as taken — decide and assert it.

The separation is deliberate and must survive: `companions` is the user's curated group, `coPassengers` is raw parser output. Do NOT make `coPassengers` an editable field — two inputs with near-identical labels is exactly the confusion #199 exists to remove.

- [x] **Step 2: Run them and confirm they fail.**

- [x] **Step 3: Implement.**

- [x] **Step 4: Full run, both guards, tsc, lint.**

- [x] **Step 5: Commit**

```
feat(flights): surface the co-passengers the parser found

They were stored and displayed nowhere. They now appear read-only beside the
companions field with a take-over action, so the raw parse stays raw and the
curated list stays curated.
```

---

### Task 6: Boarding group in the create form

The mockup annotates this field "neu im Anlegen", and the spec lists it under the
field moves — but no task above builds it. The edit modal has it end to end; the
create hook does not know the field at all, so a boarding group read out of a
booking mail is silently dropped on the way in.

**Files:**
- Modify: `frontend/src/components/FlightForm/useFlightForm.ts`
- Modify: `frontend/src/components/FlightForm/FlightCompleteStep.tsx`
- Test: `frontend/src/components/FlightForm/useFlightForm.boardingGroup.test.ts`

- [x] **Step 1: Read how the edit modal already does it**

`FlightEditModal.tsx:106` seeds it, `:303` sends it as
`boardingGroup: formData.boardingGroup || undefined`, and `:756` renders it under
the existing key `flights:form.boardingGroup`. Reuse that key — do NOT add a new
one; DE and EN both carry it already. The backend bound is
`backend/src/schemas/flight.ts:194`: an optional string, max 20 characters.

- [x] **Step 2: Write the failing test**

Assert that a create payload carries `boardingGroup` when the field is filled, and
omits it — `undefined`, not `""` — when it is not. The empty case is the one that
matters: an empty string would overwrite a parser-provided value with nothing,
which is the same data-destroying shape Task 2 guards against.

- [x] **Step 3: Run it and confirm it fails.**

- [x] **Step 4: Implement.** Add the field to the hook's state and to
`buildFlightPayload`, and render it in the create form's seating section beside
seat and class, matching the mockup's grouping.

- [x] **Step 5: Both suites, both guards, tsc, lint** — each on its own line.

- [x] **Step 6: Commit**

```
feat(flights): record the boarding group while adding a flight

The edit modal has had this field all along; the create form never knew it, so a
boarding group read out of a booking mail was dropped on the way in.
```

---

### Task 7: Gate

- [x] **Step 1:** `cd frontend` then `npx tsc --noEmit`, `npm run lint`, `npx vitest --run`, `npx vite build` — each on its own line.
- [ ] **Step 2:** `cd backend && npx jest src/__tests__/flights` — the contract must be unchanged.
- [x] **Step 3:** Report `FlightEditModal.tsx` and `FlightCompleteStep.tsx` line counts. `FlightEditModal.tsx` must be under 800. If it is not, say so plainly rather than reporting success.
- [x] **Step 4:** Grep-prove that no field input of any covered group survives outside `fields/`.
- [ ] **Step 5: Browser.** Dev servers with `VITE_API_URL` in the SHELL and `CORS_ORIGIN` set to the frontend origin — `FRONTEND_URL` alone does not open cross-origin dev. Then: add a flight with a trip, a cost and a receipt in one pass; edit it and change an airline via the catalogue; confirm the parsed co-passengers row appears on a parsed flight. Confirm the console stays clean.
- [x] **Step 6:** Report the numbers from each gate rather than asserting success.

---

## Gate result (2026-08-02)

Run over the whole branch (both phases), from `frontend/`:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | exit 0 (`eslint . --max-warnings 0`) |
| `npx vitest --run` | exit 0 — **200 files, 1342 tests, all passing**, 97s |
| `npx vite build` | exit 0, built in 15.0s (pre-existing >1000 kB chunk warning for `vendor-maplibre`, unrelated) |

(1338 of those tests were green before the follow-up below; the four it added
bring the total to 1342. All four gates were re-run afterwards, which is what
this table reports.)

**Step 3 — line counts:** `FlightEditModal.tsx` **776** (was 826 before the
unification; the 800 limit holds), `FlightCompleteStep.tsx` **773**.

**Step 4 — grep proof.** Searching the placeholder keys of every covered group
outside `fields/` returns three hits, all explained:

1. `FlightCompleteStep.tsx` renders its own two `AirportAutocomplete`s instead of
   `RouteFields`. This is deliberate and documented in `RouteFields.tsx`'s
   docblock: the create form's pickers are `required` and carry the
   `flights:form.from`/`to` labels with their baked-in "*", while the edit form's
   must NOT be required (a stored flight always has coordinates but may have no
   displayable code, and a `required` empty input would block saving every other
   field). Same component underneath, different contract on top. The phase 1
   plan's File Structure line claiming `RouteFields` would also hold flight
   number, airline and aircraft was not followed — those three sit inline in both
   forms, sharing `CatalogueCombobox` for the two catalogue-bound ones.
2. `FlightReviewModal.tsx` (772 lines) has its own airport, booking-reference,
   ticket-number, price, taxes and fees inputs. **This is a genuine gap, not an
   exception:** it is the parser-review step mounted from
   `SimplifiedFlightFormV2`, i.e. a THIRD flight form, and the spec's "Verified
   inventory" — assembled twice independently — never lists it. Unifying it is
   not a mechanical swap: its inputs carry parser decoration the shared
   components do not model (`getFieldBorderClass` per field source, the
   `InferredBadge`, the confidence colouring). It needs its own spec pass.
3. Its own test files, which is expected.

**Follow-up landed with this gate.** The four fields that stayed inline in both
forms had silently diverged in input handling — the create form uppercased flight
number and seat, capped the flight number at 10 and the boarding group at 20, and
explained the comma separation under the tags input; the edit modal did none of
it, so the same keystrokes stored different values depending on which form the
user was in. The create form's rule now applies in both, pinned by four tests in
`FlightEditModal.test.tsx`.

**Still open, deliberately:**

- **Step 2 (backend jest)** was not run — no `backend/node_modules` and no
  reachable Postgres on this machine. The claim it defends was verified another
  way: `git diff --stat main...feat/flight-form-times -- backend/` is **empty**,
  so neither phase touched the backend at all.
- **Step 5 (browser)** was not run — no dev stack here. Per the spec, green tests
  do not close this: three of the errors the original audit found were invisible
  to the suite and visible on screen.
- **`seatClass` and `category` still disagree by design-accident:** the edit modal
  offers an empty "optional" option for both, the create form does not (it
  defaults to `economy`/`business`). So a flight can be edited to have no
  category but never created without one. Which side is right is a product
  decision, not a refactor — left untouched.
