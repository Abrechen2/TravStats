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
- `frontend/src/components/FlightForm/useFlightForm.ts` — expose the fields the create path lacks

**Deliberately NOT in this phase:** the `SpecialFlightModal`, which edits flights through its own form and has no test file at all. It shares the API contract, not the components. Bringing it in would double this phase's blast radius; it gets its own decision once the two main forms are one.

---

### Task 1: Catalogue pickers for airline and aircraft

Issues #189/#191 made Airline and Aircraft real tables with an admin UI and a resolver. The forms never noticed — both still take free text, which is the fragmentation the catalogue was built to end.

**Files:**
- Modify: `frontend/src/components/FlightForm/fields/RouteFields.tsx`
- Test: `frontend/src/components/FlightForm/fields/__tests__/RouteFields.test.tsx`

- [ ] **Step 1: Find out what the backend actually offers**

Before designing anything, find the endpoints that list or search airlines and aircraft, and report their shapes. The admin UI for "Airlines & Aircraft" consumes them already — read that first rather than inventing a new endpoint. If no suitable read endpoint exists for non-admin users, STOP and report: that is a backend task and a decision for the owner, not something to improvise.

- [ ] **Step 2: Write the failing tests**

Assert that typing filters to catalogue entries; that a catalogue pick submits the code the API expects (check whether that is the IATA, the ICAO, or the display name — read the write path, do not assume); and that free entry still works for an airline not in the catalogue. That last one is not optional: a picker that refuses unknown airlines makes the form unusable for exactly the flights that need manual entry.

- [ ] **Step 3: Run them and confirm they fail.**

- [ ] **Step 4: Implement, reusing the existing picker pattern**

`AirportAutocomplete` is the house pattern for exactly this shape. Follow it rather than inventing a second interaction model. Note its `onMouseDown={(e) => e.preventDefault()}` on option buttons — that is a real fix for a real focus bug, and a new picker needs it too.

- [ ] **Step 5: Both forms, both suites, both guards, tsc, lint** — each on its own line.

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Characterise both sides**

Add a test to each form's suite pinning what it submits today for `bookingReference` and `ticketNumber`. Both must pass before you touch anything, and both must still pass unedited afterwards.

- [ ] **Step 2: Write the failing tests for the new fields**

Assert that `bookingClassLetter`, `baggageAllowance` and `frequentFlyerNumber` render in BOTH modes, that editing them submits them, and that leaving them untouched submits them unchanged rather than clearing them. That last assertion is the one that matters: these fields arrive pre-filled from the parser, and a form that silently blanks a field it merely displayed would destroy data on every save.

- [ ] **Step 3: Run them and confirm they fail.**

- [ ] **Step 4: Extract and swap.** Both forms render `BookingFields`; no booking input survives outside it. Prove it by grep and report the result.

- [ ] **Step 5: Full run, both guards, tsc, lint** — each on its own line.

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Characterise both sides** for `price` and `currency`, as in Task 2.

- [ ] **Step 2: Write the failing tests**

`taxes` and `fees` render and submit in both modes; the receipt upload renders in both. Note that the receipt is a FILE UPLOAD, not a URL text field — `ReceiptUpload.tsx` uploads a file and the server returns the stored path. An abandoned create-form upload is swept by an existing 90-day orphan cleanup, so uploading before the flight exists is safe.

- [ ] **Step 3: Run them and confirm they fail.**

- [ ] **Step 4: Extract and swap.** Grep-prove no second cost input survives.

- [ ] **Step 5: Full run, both guards, tsc, lint.**

- [ ] **Step 6: Commit**

```
feat(flights): record cost and receipt while adding a flight

Taxes, fees and the receipt upload existed only when editing, so recording what
a flight cost meant saving it and reopening it.
```

---

### Task 4: Trip assignment in the create form

- [ ] **Step 1: Read how the edit form does it first.** Trip assignment is NOT part of the flight update payload — it goes to a separate endpoint (`POST /trips/:id/flights`), because `Flight.tripId` is owned by the Trip relation. The edit modal applies it after a successful save, deliberately, so a failed field-save does not silently move a flight between trips. Preserve that ordering.

- [ ] **Step 2: Write the failing test.** Creating a flight with a trip selected results in both the flight create AND the trip assignment, in that order, and a failed create does NOT attempt the assignment.

- [ ] **Step 3: Run it and confirm it fails.**

- [ ] **Step 4: Implement**, keeping the two-call ordering.

- [ ] **Step 5: Full run, both guards, tsc, lint.**

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Write the failing tests**

The parsed names render read-only beneath the companions picker when present, and not at all when absent. A "take over" action copies them into `companions` WITHOUT mutating `coPassengers`. After taking over, the row either disappears or shows as taken — decide and assert it.

The separation is deliberate and must survive: `companions` is the user's curated group, `coPassengers` is raw parser output. Do NOT make `coPassengers` an editable field — two inputs with near-identical labels is exactly the confusion #199 exists to remove.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Full run, both guards, tsc, lint.**

- [ ] **Step 5: Commit**

```
feat(flights): surface the co-passengers the parser found

They were stored and displayed nowhere. They now appear read-only beside the
companions field with a take-over action, so the raw parse stays raw and the
curated list stays curated.
```

---

### Task 6: Gate

- [ ] **Step 1:** `cd frontend` then `npx tsc --noEmit`, `npm run lint`, `npx vitest --run`, `npx vite build` — each on its own line.
- [ ] **Step 2:** `cd backend && npx jest src/__tests__/flights` — the contract must be unchanged.
- [ ] **Step 3:** Report `FlightEditModal.tsx` and `FlightCompleteStep.tsx` line counts. `FlightEditModal.tsx` must be under 800. If it is not, say so plainly rather than reporting success.
- [ ] **Step 4:** Grep-prove that no field input of any covered group survives outside `fields/`.
- [ ] **Step 5: Browser.** Dev servers with `VITE_API_URL` in the SHELL and `CORS_ORIGIN` set to the frontend origin — `FRONTEND_URL` alone does not open cross-origin dev. Then: add a flight with a trip, a cost and a receipt in one pass; edit it and change an airline via the catalogue; confirm the parsed co-passengers row appears on a parsed flight. Confirm the console stays clean.
- [ ] **Step 6:** Report the numbers from each gate rather than asserting success.
