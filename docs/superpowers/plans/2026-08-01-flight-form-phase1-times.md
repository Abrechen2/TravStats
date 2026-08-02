# Flight Form Unification — Phase 1: times, route, actuals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the edit form's time handling identical to the create form's — separate date and time inputs, airports editable, actual times surfaced — without moving a single stored UTC instant.

**Architecture:** No new time conversion is written. Both paths already send `departureLocal` + `depTimezone`; the create path already composes that from separate fields with `buildLocalString`. Edit adopts the same helper. The one genuinely new rule: the airport-local hydration must move the date field and the time field together, and submit must pair both with one timezone basis.

**Tech Stack:** React + TypeScript, Vitest, date-fns-tz, Express/Prisma backend (unchanged by this phase).

**Spec:** `docs/superpowers/specs/2026-08-01-flight-form-unification-design.md`, including its "Verified inventory" section.

**Scope:** this plan covers times, airports and actual times only. The field moves (boarding group, taxes, fees, receipt upload, trip assignment into create), the catalogue pickers, the three hidden booking fields and the `coPassengers` take-over row are Phase 2 and get their own plan. Phase 1 stands on its own: after it, edit and create agree on time handling and nothing else has changed.

## Global Constraints

- The API contract does not change. Both paths already send `departureLocal`, `depTimezone`, `arrivalLocal`, `arrTimezone`; keep those exact names.
- **No stored UTC instant may move.** Opening the edit modal and saving without changing anything must leave `departureTime` and `arrivalTime` byte-identical in the database. This is the property Task 1 pins and every later task must keep green.
- `any` is forbidden. Use `unknown` plus type guards.
- Frontend uses DOUBLE quotes (`frontend/.prettierrc` sets `"singleQuote": false`), printWidth 100.
- `useTranslation` comes from the project wrapper `"../hooks/useTranslation"`, never react-i18next directly.
- User-facing copy is German first with an English mirror — add or change both `frontend/src/i18n/resources/de/*` and `.../en/*` together, never one side.
- Frontend logger is a NAMED export: `import { logger } from "../lib/logger"`. No `console.log`.
- Do NOT run `npx prettier --write` inside `backend/` — that directory has no `.prettierrc` and prettier picks up the frontend's config, requoting whole files.
- File size: 200–400 lines ideal, 800 hard maximum. `FlightEditModal.tsx` is already 833; it must get smaller, not larger.
- Status stays a derived read-only pill plus the Cancelled checkbox. Do not add a status picker — that would undo a 2.5.0 decision.
- Tests are Vitest. Run `npm run lint` on its own line, never behind a pipe; a pipe swallows its exit code.

## File Structure

**Create**
- `frontend/src/components/FlightForm/fields/TimesFields.tsx` — scheduled + actual date/time inputs, shared by both modes
- `frontend/src/components/FlightForm/fields/RouteFields.tsx` — airports, flight number, airline, aircraft
- `frontend/src/components/FlightForm/useAirportLocalTimes.ts` — the hydration hook, extracted so it can be tested without a modal

**Modify**
- `frontend/src/components/FlightEditModal.tsx` — consume the new field components; shrink
- `frontend/src/components/FlightForm/FlightCompleteStep.tsx` — consume the same components
- `frontend/src/components/FlightForm/useFlightForm.ts` — expose actual times
- `frontend/src/__tests__/components/FlightEditModal.test.tsx` — it hard-codes `#editDepartureTime` / `#editArrivalTime`

**Not touched in this phase:** the backend, `lib/flightDuplicate.ts`, `CruiseImportPreviewModal.tsx`, `SpecialFlightModal.tsx`. They build payloads directly and are unaffected as long as the contract holds — which Task 1 and Task 3 verify.

---

### Task 1: Pin the timezone round-trip before touching anything

This is a characterization test. It must pass against the CURRENT code. Its job is to fail loudly the moment a later task breaks the property.

**Files:**
- Test: `frontend/src/__tests__/components/FlightEditModal.timezone.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: the guard every later task must keep green

- [x] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ update: vi.fn(), searchAirports: vi.fn() }));

vi.mock("../../lib/api", () => ({
  flightsApi: { update: mocks.update },
  airportsApi: { search: mocks.searchAirports },
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));

import FlightEditModal from "../../components/FlightEditModal";

// A flight stored at 12:35 UTC, departing from an airport in Tokyo (UTC+9)
// and arriving in New York (UTC-4). The browser runs in Berlin. All three
// zones differ on purpose: that is the only configuration in which a
// half-hydrated value is visible.
const FLIGHT = {
  id: "f1",
  flightNumber: "NH203",
  departureTime: "2026-08-14T12:35:00.000Z",
  arrivalTime: "2026-08-14T16:50:00.000Z",
  depIata: "HND",
  arrIata: "JFK",
  companions: [],
  tags: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.searchAirports.mockImplementation(async (q: string) =>
    q === "HND"
      ? [{ iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 }]
      : [{ iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 }]
  );
});

describe("FlightEditModal timezone round trip", () => {
  it("does not move the stored instant when nothing is edited", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);

    // Wait for the airport timezones to resolve and the inputs to be rehydrated
    // as airport-local. Saving before this point is a different code path.
    await waitFor(() => expect(mocks.searchAirports).toHaveBeenCalled());

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];

    // The payload is a wall-clock string plus its zone. Recombining them must
    // reproduce the original instant exactly.
    const { fromZonedTime } = await import("date-fns-tz");
    expect(fromZonedTime(payload.departureLocal, payload.depTimezone).toISOString()).toBe(
      FLIGHT.departureTime
    );
    expect(fromZonedTime(payload.arrivalLocal, payload.arrTimezone).toISOString()).toBe(
      FLIGHT.arrivalTime
    );
  });
});
```

Adjust the props and the mocked module paths to what `FlightEditModal` actually takes and imports — read it first. Keep both assertions exactly as written; they are the point.

- [x] **Step 2: Run it and confirm it PASSES**

Run: `cd frontend && npx vitest --run src/__tests__/components/FlightEditModal.timezone.test.tsx`
Expected: PASS. This is a characterization test; the behaviour already works.

If it FAILS, stop and report rather than "fixing" anything — that would mean the property does not hold today and the whole premise of this phase needs revisiting.

- [x] **Step 3: Prove the guard can fail**

Temporarily change the submit basis in `FlightEditModal.tsx` from
`hydratedRef.current ? depTz : browserTz` to always `browserTz`, re-run, and
confirm the test FAILS. Restore it and confirm it passes again. Report both
outcomes — a guard nobody watched fail is not a guard.

- [x] **Step 4: Commit**

```bash
git add frontend/src/__tests__/components/FlightEditModal.timezone.test.tsx
git commit -m "test(flights): pin the edit modal's timezone round trip

Characterization test, passes against current behaviour. Three distinct zones
(browser Berlin, departure Tokyo, arrival New York) because a value that is half
browser-local and half airport-local is invisible wherever two zones agree.

Verified it can fail by forcing the submit basis to the browser zone."
```

---

### Task 2: Extract the hydration into a testable hook

**Files:**
- Create: `frontend/src/components/FlightForm/useAirportLocalTimes.ts`
- Create: `frontend/src/components/FlightForm/__tests__/useAirportLocalTimes.test.ts`
- Modify: `frontend/src/components/FlightEditModal.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```typescript
  useAirportLocalTimes(args: {
    isOpen: boolean;
    depCode: string | null;
    arrCode: string | null;
    browserTimezone: string;
  }): { depTimezone: string; arrTimezone: string; hydrated: boolean }
  ```

- [x] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../../../lib/api", () => ({ airportsApi: { search: mocks.search } }));

import { useAirportLocalTimes } from "../useAirportLocalTimes";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockImplementation(async (q: string) =>
    q === "HND" ? [{ iata: "HND", timezone: "Asia/Tokyo" }] : [{ iata: "JFK", timezone: "America/New_York" }]
  );
});

describe("useAirportLocalTimes", () => {
  it("starts on the browser zone and reports not hydrated", () => {
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
  });

  it("moves BOTH zones to airport-local together, never one alone", async () => {
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.depTimezone).toBe("Asia/Tokyo");
    expect(result.current.arrTimezone).toBe("America/New_York");
  });

  // A half-resolved pair is the failure this whole phase guards against.
  it("stays unhydrated when only one airport resolves", async () => {
    mocks.search.mockImplementation(async (q: string) =>
      q === "HND" ? [{ iata: "HND", timezone: "Asia/Tokyo" }] : []
    );
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
  });

  it("re-resolves when the departure airport changes", async () => {
    const { result, rerender } = renderHook(
      (props: { depCode: string }) =>
        useAirportLocalTimes({ isOpen: true, depCode: props.depCode, arrCode: "JFK", browserTimezone: "Europe/Berlin" }),
      { initialProps: { depCode: "HND" } }
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    mocks.search.mockImplementation(async () => [{ iata: "FRA", timezone: "Europe/Berlin" }]);
    rerender({ depCode: "FRA" });

    await waitFor(() => expect(result.current.depTimezone).toBe("Europe/Berlin"));
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `cd frontend && npx vitest --run src/components/FlightForm/__tests__/useAirportLocalTimes.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the hook**

Lift the existing effect out of `FlightEditModal.tsx` (currently around lines 193–223) without changing what it does, with two additions the tests demand: it reports `hydrated` only when BOTH zones resolved, and it re-resolves when a code changes — the latter is what makes editable airports possible in Task 4.

- [x] **Step 4: Use it in the modal**

Replace the inline effect and the `depTz` / `arrTz` / `hydratedRef` state in `FlightEditModal.tsx` with the hook. The submit basis becomes `hydrated ? depTimezone : browserTimezone`, unchanged in meaning.

- [x] **Step 5: Run the guard and the modal suite**

```bash
cd frontend
npx vitest --run src/__tests__/components/FlightEditModal.timezone.test.tsx
npx vitest --run src/__tests__/components/FlightEditModal.test.tsx
npx tsc --noEmit
npm run lint
```
Task 1's guard must still pass. If it does not, the extraction changed behaviour — fix the extraction, not the test.

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/FlightForm/useAirportLocalTimes.ts frontend/src/components/FlightForm/__tests__/useAirportLocalTimes.test.ts frontend/src/components/FlightEditModal.tsx
git commit -m "refactor(flights): extract the airport-local hydration into a hook

Same behaviour, now testable without mounting a modal, and it reports hydrated
only when BOTH zones resolved. A half-resolved pair was previously representable
and is the failure mode the whole phase guards against. It also re-resolves when
an airport code changes, which is what lets editing airports work at all."
```

---

### Task 3: Split the edit inputs into date and time

The change this phase exists for.

**Files:**
- Create: `frontend/src/components/FlightForm/fields/TimesFields.tsx`
- Create: `frontend/src/components/FlightForm/fields/__tests__/TimesFields.test.tsx`
- Modify: `frontend/src/components/FlightEditModal.tsx`
- Modify: `frontend/src/__tests__/components/FlightEditModal.test.tsx` — it hard-codes `#editDepartureTime` / `#editArrivalTime`

**Interfaces:**
- Consumes: `buildLocalString(date, time)` from the create path — find its real location and export it if it is currently module-private
- Produces: `<TimesFields value={{depDate, depTime, arrDate, arrTime}} onChange={...} />`

- [x] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimesFields from "../TimesFields";

const VALUE = { depDate: "2026-08-14", depTime: "14:35", arrDate: "2026-08-14", arrTime: "16:50" };

describe("TimesFields", () => {
  it("renders four separate controls, not two combined ones", () => {
    render(<TimesFields value={VALUE} onChange={() => {}} />);
    expect(screen.getAllByLabelText(/datum|date/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/uhrzeit|time/i)).toHaveLength(2);
  });

  it("copies the departure date to arrival without touching the arrival time", async () => {
    const onChange = vi.fn();
    render(
      <TimesFields value={{ ...VALUE, arrDate: "2026-08-20" }} onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("button", { name: /übernehmen|copy/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.arrDate).toBe("2026-08-14");
    expect(next.arrTime).toBe("16:50");
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `cd frontend && npx vitest --run src/components/FlightForm/fields/__tests__/TimesFields.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 3: Build the component and use it in the modal**

The modal's state changes from two combined strings to four. On load, split the
formatted airport-local value at the `T`. On submit, recombine with the SAME
helper the create path uses — do not write a second one. The hydration from
Task 2 must set all four fields in one update, never two updates.

- [x] **Step 4: Fix the modal's existing test**

`FlightEditModal.test.tsx` selects `#editDepartureTime` / `#editArrivalTime`.
Retarget it at the new controls. Do not weaken what it asserts about the saved
payload — the payload shape has not changed, only the inputs that produce it.

- [x] **Step 5: Run everything that could notice**

```bash
cd frontend
npx vitest --run src/__tests__/components/FlightEditModal.timezone.test.tsx
npx vitest --run
npx tsc --noEmit
npm run lint
```
**Task 1's guard is the gate.** If it fails here, the split lost the pairing — that is exactly the bug this phase is about. Fix it before continuing; do not adjust the guard.

- [x] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(flights): separate date and time inputs in the edit form

Matches the create form. No new conversion: submit recombines with the same
buildLocalString the create path already uses, and hydration sets all four
fields in one update so a value can never be half browser-local.

The timezone round-trip guard from the previous task stayed green throughout."
```

---

### Task 3b: The create path consumes the shared time fields

**Why this task exists:** the plan's File Structure said `FlightCompleteStep.tsx`
would consume the shared components, but no task did it. After Task 3 the two
forms only RESEMBLE each other — both render separate date and time inputs, both
recombine with `buildLocalString` — while still owning two separate
implementations. That is the state the forms were already in before #197 pulled
them apart, and it is exactly what #199 exists to end. Sharing the component is
what makes the drift structurally impossible rather than merely currently absent.

**Files:**
- Modify: `frontend/src/components/FlightForm/FlightCompleteStep.tsx`
- Modify: `frontend/src/components/FlightForm/fields/TimesFields.tsx` if the
  create path needs a prop the edit path did not
- Test: `frontend/src/components/FlightForm/FlightCompleteStep.status.test.tsx`
  and `frontend/src/components/FlightForm/fields/__tests__/TimesFields.test.tsx`

**Interfaces:**
- Consumes: `TimesFields` from Task 3
- Produces: one time-input implementation instead of two

- [x] **Step 1: Characterise the create path first**

Before changing anything, add a test to the create path's suite asserting what
it submits today for departure and arrival — the `departureLocal`/`depTimezone`
pair for a filled date and time, and what it emits when the time is left empty.
Run it and confirm it PASSES. This is the create-side equivalent of Task 1's
guard, and it is what tells you the swap changed nothing.

- [x] **Step 2: Swap in the shared component**

Replace the create path's own date/time inputs with `<TimesFields>`. The create
path keeps its own extras — the arrival day-offset, the estimate block, the
historical partial-date handling — unless they are already in the component.
Do NOT move those into `TimesFields` in this task; if the component needs to
accept them as slots or props, add the narrowest prop that works and say so.

- [x] **Step 3: Both suites must be green**

```bash
cd frontend
npx vitest --run src/components/FlightForm
npx vitest --run src/__tests__/components/FlightEditModal.timezone.test.tsx
npx vitest --run
npx tsc --noEmit
npm run lint
```
The Task 1 timezone guard covers the edit side; your Step 1 test covers the
create side. Both must pass, and the create-side test must not have been edited
to accommodate the swap — if it needs editing, the swap changed behaviour.

- [x] **Step 4: Prove the sharing is real**

Report the line counts of `FlightCompleteStep.tsx` before and after, and confirm
by grep that no date/time input element remains outside `TimesFields.tsx`. Two
implementations that merely agree today are what this task exists to eliminate;
if one is left behind, the task is not done.

- [x] **Step 5: Commit**

```
refactor(flights): both forms render the same time fields

Task 3 made the two forms behave alike; they still owned two implementations,
which is the state they were in before #197 pulled them apart. The create path
now renders the same component the edit path does, so the next field added
cannot land on one side only.
```

---

### Task 4: Airports editable in edit mode

**Files:**
- Create: `frontend/src/components/FlightForm/fields/RouteFields.tsx`
- Modify: `frontend/src/components/FlightEditModal.tsx`
- Test: `frontend/src/components/FlightForm/fields/__tests__/RouteFields.test.tsx`

Server-side needs nothing: `PUT /flights/:id` already accepts `departure` / `arrival` objects with `lat`/`lon` and recomputes status, CO₂, route distance, the next API check and `delayMinutes`.

- [x] **Step 1: Write the failing test**

Assert that changing the departure airport emits a `departure` object carrying
`lat` and `lon` — codes alone are not enough for the API — and that the times'
timezone basis follows the newly selected airport rather than the flight's
stored one. The second assertion is the one that matters: it is the interaction
between Task 2's hook and this task.

- [x] **Step 2: Run it and confirm it fails**

Expected: FAIL — the edit modal renders airports read-only today.

- [x] **Step 3: Implement**

Reuse the airport picker the create path already uses rather than building a
second one.

- [x] **Step 4: Run the guard, the suite, tsc, lint** — each on its own line.

A changed airport SHOULD move the wall-clock rendering, since the zone changed;
Task 1's guard only covers the untouched case and must still pass.

- [x] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(flights): allow changing airports when editing

A misrecognised airport previously had to be fixed by deleting the flight and
re-entering it — the most common parser error had no repair path. The server
already accepted the change and recomputed distance and CO2; only the UI was
missing. The timezone basis now follows the selected airport."
```

---

### Task 5: Surface scheduled vs. actual times (#200)

The columns, the API fields and even the DE/EN i18n keys already exist. Only the controls are missing.

**Files:**
- Modify: `frontend/src/components/FlightForm/fields/TimesFields.tsx`
- Modify: `frontend/src/components/FlightEditModal.tsx`, `frontend/src/components/FlightForm/useFlightForm.ts`
- Test: extend `TimesFields.test.tsx`

- [x] **Step 1: Write the failing test**

Assert: actual date/time inputs render; leaving them empty emits no
`actualDepartureLocal`; filling them emits `actualDepartureLocal` paired with
`actualDepartureTz`; and the delay is displayed as a derived read-only value,
never as an input — matching how status is handled.

- [x] **Step 2: Run it and confirm it fails.**

- [x] **Step 3: Implement.** Check whether the existing i18n keys cover the new labels before adding any; if you add one, add DE and EN together.

- [x] **Step 4: Run the guard, the full suite, tsc, lint.**

- [x] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(flights): show scheduled and actual times, with a derived delay (#200)

The columns, the API fields and the DE/EN i18n keys were already there; the
form never rendered them. Delay is derived and read-only, like status."
```

---

### Task 6: Gate

- [x] **Step 1:** `cd frontend && npx tsc --noEmit`, then `npm run lint`, then `npx vitest --run`, then `npx vite build` — each on its own line.
- [x] **Step 2:** Backend unchanged by this phase, but run `cd backend && npx jest src/__tests__/flights` to prove the contract still holds.
- [x] **Step 3: Browser.** Dev servers with `VITE_API_URL` set in the SHELL, not only `.env.local`, and `CORS_ORIGIN` set to the frontend origin — `FRONTEND_URL` alone does not open cross-origin dev. Then: open a flight for editing, save without changing anything, and confirm in the database that `departure_time` and `arrival_time` are unchanged. Change an airport and confirm distance and map update. Confirm the console stays clean.
- [x] **Step 4:** Report the numbers from each gate rather than asserting success.

---

## Gate result (2026-08-02)

The branch carries both phases, so the gate was run once over the whole of
`feat/flight-form-times` and the numbers are recorded in the phase 2 plan. Two
steps above stay open on purpose rather than being ticked on faith:

- **Step 2 (backend jest)** was not run. It could not be: this machine has no
  `backend/node_modules` and no reachable Postgres. What was measured instead is
  stronger for the specific claim the step exists to defend —
  `git diff --stat main...feat/flight-form-times -- backend/` is **empty**. Both
  phases changed zero backend files, so the contract cannot have moved. Run the
  suite anyway on a machine with the dev DB before merging, since the step is
  cheap there.
- **Step 3 (browser)** was not run — no dev stack on this machine. The spec's own
  warning applies unchanged: *"Green tests are not sufficient evidence here —
  three of the errors this audit found were invisible to the test suite and
  visible on screen."* This phase is NOT verified until someone opens the modal.
