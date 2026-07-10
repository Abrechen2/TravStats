# Cruise table: sortable columns + inline row actions

**Status:** approved (design + mockup) 2026-07-04 · **Target:** v2.3 · **Branch:** `dev/v2.3`

## Goal

Bring the cruise list table (`CruisesPage`) up to par with the flight table:
sortable column headers and per-row inline actions (edit / duplicate / delete).
Mirror the established flight-table patterns so the two lists feel consistent.

Mockup: the v2.3 dark-theme table with a gold active-sort header (`Datum ▼`),
hover arrows on inactive sortable headers, and an Actions column
(✏ Bearbeiten · ⧉ Duplizieren · 🗑 Löschen).

## Non-goals (YAGNI)

- No "return" duplicate mode (flights have it; meaningless for cruises).
- No cross-session sort persistence (the flight table doesn't persist either).
- `Kabine` (cabin) column stays non-sortable — free text, low value.
- No new backend endpoints — reuse `cruiseApi.create/update/delete`.

## A. Sorting (`CruisesPage.tsx` + new `sortCruises.ts`)

State (mirrors `FlightsTablePage`):
- `sortBy: "date" | "ship" | "line" | "ports" | "status" | "price"` — default `"date"`.
- `sortOrder: "asc" | "desc"` — default `"desc"` (newest first).
- `handleSort(col)`: same column → toggle `asc`/`desc`; different column → set it with
  a sensible default order (`date`/`price`/`ports` → `desc`; `ship`/`line`/`status` → `asc`).

Sortable headers: the six `<th>` become `<button class="sortbtn">` with a `▲/▼`
indicator — active column tinted with `--accent`, inactive columns show a faint arrow
on hover. `Kabine` header stays plain text. Each button gets an `aria-label`
("Nach Datum sortieren").

Pure helper `components/Cruise/sortCruises.ts`:
```
sortCruises(list: Cruise[], sortBy: SortKey, sortOrder: "asc"|"desc"): Cruise[]
```
- Comparators per key: `date` → `startDate`; `ship` → resolved ship name
  (`ship?.name ?? shipNameOverride`) `localeCompare`; `line` → resolved line
  (`cruiseLine ?? ship?.cruiseLine`) `localeCompare`; `ports` → `countUniquePorts`;
  `price` → numeric; `status` → a fixed rank order
  (`scheduled < flown < historical < cancelled`, i.e. upcoming-first when asc).
- **Nulls/blanks always sort last**, regardless of direction.
- Returns a new array (immutable); applied in a `useMemo` after the existing
  `filtered` list, so filters + search still run first.

## B. Inline actions (`CruisesPage.tsx` + new `CruiseRowActions.tsx`)

New column "Aktionen" (right-aligned, static header). `CruiseRow` gains an
`actions?: ReactNode` slot rendered in the last `<td>`; the row keeps its
`onClick={onOpen}` (navigate to detail).

New `components/Cruise/CruiseRowActions.tsx` (mirror `FlightRowActions`):
- Props: `{ cruise, onEdit, onDuplicate, onDelete }`.
- Renders an `Edit / Duplicate / Delete` button cluster (same colour tokens as the
  flight cluster: edit `#388bfd`, delete `--danger`, duplicate neutral).
- Every button calls `e.stopPropagation()` so it never triggers the row's `onOpen`.

`CruisesPage` owns the wiring + state:
- `editingCruise: Cruise | null` → `<CruiseEditModal mode="edit" cruise={…}>`.
- `duplicateSource: Cruise | null` → `<CruiseEditModal mode="create" cruise={…}>`
  (see modal enhancement below).
- `cruiseToDelete: string | null` + a confirm modal → `cruiseApi.delete(id)`.
- After any edit / duplicate / delete: reload the list (existing `load()`), toast
  on success/error (existing toast store).

## C. Duplicate → prefilled create (`CruiseEditModal.tsx` enhancement)

Today `CruiseEditModal` takes `{ mode, cruise?, onClose, onSaved }`. Verify first
whether `create` mode already reads `cruise` for its initial form state; if it
does not (expected), add prefill: when `mode === "create"` **and** a `cruise` is
passed, seed the form from that cruise's fields (ship, line, ports/stops,
cabin, price, notes, tags) **excluding** identity/date fields (`id`, `startDate`,
`endDate`, `bookingReference`) so the user sets the new dates. Saving calls
`cruiseApi.create` → a genuine copy. Existing `create` (no cruise) is unchanged.

## Files

- **New:** `frontend/src/components/Cruise/sortCruises.ts` + `sortCruises.test.ts`
- **New:** `frontend/src/components/Cruise/CruiseRowActions.tsx`
- **Edit:** `frontend/src/pages/CruisesPage.tsx` (sort state/headers, actions column,
  edit/duplicate/delete state + modals). Keep under the 800-line hard max — extract
  as needed.
- **Edit:** `frontend/src/components/Cruise/CruiseRow.tsx` (sortable-header-agnostic;
  add `actions` slot).
- **Edit:** `frontend/src/components/Cruise/CruiseEditModal.tsx` (create-mode prefill).
- **Edit:** `frontend/src/i18n/resources/{de,en}/cruise.json` — reuse the existing
  `list.columns.*` keys (incl. `dates`); add `list.actions.duplicate`,
  `list.delete.confirm*` and per-header sort `aria-label`s. Reuse
  `common:buttons.edit/delete`.

## Error handling

- Delete failure → error toast, keep the row (existing pattern).
- Create/update failure inside the modal → the modal already surfaces errors.
- `sortCruises` never throws on null fields (nulls-last guard).

## Testing

- **Unit — `sortCruises.test.ts`:** each sort key asc + desc; nulls-last for
  `startDate`/`price`/missing ship; status rank order; input array not mutated.
- **Component:** `CruiseRowActions` fires the right callback and stops propagation;
  a `CruisesPage`-level test that clicking a header toggles order and re-sorts rows,
  and that delete opens the confirm (mirror any existing flight-table tests).
- Full frontend `vitest --run` green; `tsc` + `eslint` clean.

## Rollout

Lands on `dev/v2.3`, ships in the next Beta (`2.3.0-beta.5`) and eventually the
2.3.0 release. No migration, no backend change.
