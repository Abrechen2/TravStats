# Cruise Table: Sorting + Inline Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cruise list table sortable column headers and per-row inline actions (edit / duplicate / delete), mirroring the flight table.

**Architecture:** A pure `sortCruises` helper (unit-tested) does the ordering; `CruisesPage` owns the `sortBy`/`sortOrder` state and renders clickable headers. A new `CruiseRowActions` cluster renders in a new Actions column of each `CruiseRow`. Edit/Duplicate reuse the existing `CruiseEditModal` (edit mode; create mode with a date-cleared source = duplicate); delete uses `cruiseApi.delete` behind a confirm modal.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Vitest + Testing Library, Tailwind + CSS custom-property tokens, react-i18next (project wrapper `../../hooks/useTranslation`).

## Global Constraints

- Branch: `dev/v2.3` (all work + commits here). Spec: `docs/superpowers/specs/2026-07-04-cruise-table-sort-actions-design.md`.
- `strict: true`; `any` FORBIDDEN — use `unknown` + guards.
- ESLint + Prettier: printWidth 100, `singleQuote: false`. File hard-max 800 lines.
- i18n: add DE **and** EN together. Frontend user copy DE-primary; reuse `common:buttons.edit`/`common:buttons.delete`.
- `useTranslation` is imported from `../../hooks/useTranslation` (or `../hooks/...` by depth), never from `react-i18next`.
- Verify each step: `cd frontend && npx tsc --noEmit && npx eslint <file> && npx vitest --run <file>`.
- Cruise status values: `"scheduled" | "flown" | "cancelled" | "historical" | "duplicated"`.

---

### Task 1: `sortCruises` pure helper

**Files:**
- Create: `frontend/src/components/Cruise/sortCruises.ts`
- Test: `frontend/src/components/Cruise/sortCruises.test.ts`

**Interfaces:**
- Produces: `type CruiseSortKey = "date" | "ship" | "line" | "ports" | "status" | "price"`; `type SortOrder = "asc" | "desc"`; `sortCruises(list: Cruise[], sortBy: CruiseSortKey, order: SortOrder): Cruise[]` (new array, input not mutated).
- Consumes: `Cruise` from `../../types`; `countUniquePorts` from `./cruisePorts`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/Cruise/sortCruises.test.ts
import { describe, it, expect } from "vitest";
import { sortCruises } from "./sortCruises";
import type { Cruise } from "../../types";

// Minimal Cruise stand-in — sortCruises only reads the fields below.
function c(over: Partial<Cruise>): Cruise {
  return {
    id: "x",
    startDate: null,
    endDate: null,
    status: "scheduled",
    price: null,
    currency: "EUR",
    cruiseLine: null,
    shipNameOverride: null,
    ship: null,
    stops: [],
    departurePort: null,
    arrivalPort: null,
    cabinNumber: null,
    ...(over as object),
  } as Cruise;
}

const A = c({ id: "a", startDate: "2024-01-01", price: 100, shipNameOverride: "Zebra", cruiseLine: "MSC", status: "flown" });
const B = c({ id: "b", startDate: "2025-06-01", price: 300, shipNameOverride: "Alpha", cruiseLine: "AIDA", status: "scheduled" });
const C = c({ id: "c", startDate: null, price: null, shipNameOverride: null, cruiseLine: null, status: "cancelled" });

describe("sortCruises", () => {
  it("sorts by date desc (newest first), nulls last", () => {
    expect(sortCruises([A, B, C], "date", "desc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by date asc, nulls last", () => {
    expect(sortCruises([A, B, C], "date", "asc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by price asc, nulls last", () => {
    expect(sortCruises([A, B, C], "price", "asc").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by ship name asc (case-insensitive), blanks last", () => {
    expect(sortCruises([A, B, C], "ship", "asc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by status rank (scheduled first when asc)", () => {
    expect(sortCruises([A, B, C], "status", "asc").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("does not mutate the input array", () => {
    const input = [A, B, C];
    sortCruises(input, "date", "asc");
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Cruise/sortCruises.test.ts`
Expected: FAIL — "Failed to resolve import ./sortCruises" / `sortCruises is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/components/Cruise/sortCruises.ts
import type { Cruise } from "../../types";
import { countUniquePorts } from "./cruisePorts";

export type CruiseSortKey = "date" | "ship" | "line" | "ports" | "status" | "price";
export type SortOrder = "asc" | "desc";

// Upcoming-first rank when ascending; unknown → end.
const STATUS_RANK: Record<string, number> = {
  scheduled: 0,
  flown: 1,
  historical: 2,
  duplicated: 3,
  cancelled: 4,
};

const shipName = (c: Cruise): string => (c.ship?.name ?? c.shipNameOverride ?? "").trim();
const lineName = (c: Cruise): string => (c.cruiseLine ?? c.ship?.cruiseLine ?? "").trim();

// Comparator returning [isNull, value] so null/blank entries always land last
// regardless of sort direction.
function keyOf(c: Cruise, sortBy: CruiseSortKey): { nul: boolean; num?: number; str?: string } {
  switch (sortBy) {
    case "date": {
      const v = c.startDate ? Date.parse(c.startDate) : NaN;
      return { nul: Number.isNaN(v), num: v };
    }
    case "price":
      return { nul: c.price === null || c.price === undefined, num: c.price ?? NaN };
    case "ports":
      return { nul: false, num: countUniquePorts(c) };
    case "status":
      return { nul: false, num: STATUS_RANK[c.status] ?? 99 };
    case "ship": {
      const s = shipName(c);
      return { nul: s === "", str: s };
    }
    case "line": {
      const s = lineName(c);
      return { nul: s === "", str: s };
    }
  }
}

export function sortCruises(list: Cruise[], sortBy: CruiseSortKey, order: SortOrder): Cruise[] {
  const dir = order === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const ka = keyOf(a, sortBy);
    const kb = keyOf(b, sortBy);
    if (ka.nul !== kb.nul) return ka.nul ? 1 : -1; // nulls always last
    if (ka.nul && kb.nul) return 0;
    if (ka.str !== undefined && kb.str !== undefined) {
      return ka.str.localeCompare(kb.str, undefined, { sensitivity: "base" }) * dir;
    }
    return ((ka.num as number) - (kb.num as number)) * dir;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Cruise/sortCruises.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), tsc exit 0. If the `Cruise` stand-in misses a required field, add it to the `c()` factory — do not loosen the real type.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Cruise/sortCruises.ts frontend/src/components/Cruise/sortCruises.test.ts
git commit -m "feat(cruise): add sortCruises helper (date/ship/line/ports/status/price, nulls-last)"
```

---

### Task 2: Sortable headers in `CruisesPage`

**Files:**
- Modify: `frontend/src/pages/CruisesPage.tsx`

**Interfaces:**
- Consumes: `sortCruises`, `CruiseSortKey`, `SortOrder` from `../components/Cruise/sortCruises`.
- Produces: nothing new for other tasks (internal state).

- [ ] **Step 1: Add sort state + handler + apply sorting**

In `CruisesPage.tsx`, add the import:
```ts
import { sortCruises, type CruiseSortKey, type SortOrder } from "../components/Cruise/sortCruises";
```
Add state near the other `useState`s:
```ts
const [sortBy, setSortBy] = useState<CruiseSortKey>("date");
const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

const handleSort = (col: CruiseSortKey): void => {
  if (col === sortBy) {
    setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
  } else {
    setSortBy(col);
    // date/price/ports default to desc (biggest/newest first); text asc.
    setSortOrder(col === "ship" || col === "line" || col === "status" ? "asc" : "desc");
  }
};
```
After the existing `const filtered = useMemo(...)`, add:
```ts
const sorted = useMemo(
  () => sortCruises(filtered, sortBy, sortOrder),
  [filtered, sortBy, sortOrder]
);
```
Change the row render to iterate `sorted` instead of `filtered`:
```ts
{sorted.map((c) => (
  <CruiseRow key={c.id} cruise={c} onOpen={() => navigate(`/cruises/${c.id}`)} />
))}
```

- [ ] **Step 2: Make the six headers clickable**

Replace the six sortable `<th>` cells (ship, line, dates, ports, status, price) with sort buttons; leave `cabin` as-is. Example for each — the pattern (keep existing classes; `ports`/`price` stay right-aligned):
```tsx
<th className="px-3 py-2 text-left">
  <button
    type="button"
    onClick={() => handleSort("ship")}
    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
    aria-label={t("list.sortBy", { col: t("list.columns.ship") })}
  >
    {t("list.columns.ship")}
    <span aria-hidden className={sortBy === "ship" ? "text-[var(--accent)]" : "opacity-0"}>
      {sortBy === "ship" ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}
    </span>
  </button>
</th>
```
Map: `ship→"ship"`, `line→"line"`, `dates→"date"`, `ports→"ports"` (wrap in the existing `text-right` th, add `justify-end` to the button), `status→"status"`, `price→"price"` (right-aligned like ports). Leave the `cabin` header unchanged.

- [ ] **Step 3: Add the i18n sort label (DE + EN)**

`frontend/src/i18n/resources/de/cruise.json` — inside `"list"`, add after `"loading"`:
```json
    "sortBy": "Nach {{col}} sortieren",
```
`frontend/src/i18n/resources/en/cruise.json` — same spot:
```json
    "sortBy": "Sort by {{col}}",
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/pages/CruisesPage.tsx`
Expected: exit 0 both. Manual smoke (optional): `npx vite` → open `/cruises`, click headers, arrows toggle and rows reorder.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CruisesPage.tsx frontend/src/i18n/resources/de/cruise.json frontend/src/i18n/resources/en/cruise.json
git commit -m "feat(cruise): sortable column headers on the cruise table"
```

---

### Task 3: `CruiseRowActions` cluster component

**Files:**
- Create: `frontend/src/components/Cruise/CruiseRowActions.tsx`
- Test: `frontend/src/components/Cruise/CruiseRowActions.test.tsx`

**Interfaces:**
- Produces: `interface CruiseRowActionsProps { cruise: Cruise; onEdit: (c: Cruise) => void; onDuplicate: (c: Cruise) => void; onDelete: (id: string) => void; }`; default export `CruiseRowActions`.
- Consumes: `Cruise` from `../../types`; `useTranslation` from `../../hooks/useTranslation`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Cruise/CruiseRowActions.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CruiseRowActions from "./CruiseRowActions";
import type { Cruise } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const cruise = { id: "c1" } as Cruise;

describe("CruiseRowActions", () => {
  it("fires the matching callback per button and stops row propagation", async () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={onRow}>
            <td>
              <CruiseRowActions
                cruise={cruise}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.edit" }));
    await userEvent.click(screen.getByRole("button", { name: "cruise:list.duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    expect(onEdit).toHaveBeenCalledWith(cruise);
    expect(onDuplicate).toHaveBeenCalledWith(cruise);
    expect(onDelete).toHaveBeenCalledWith("c1");
    expect(onRow).not.toHaveBeenCalled(); // stopPropagation
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Cruise/CruiseRowActions.test.tsx`
Expected: FAIL — cannot resolve `./CruiseRowActions`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/Cruise/CruiseRowActions.tsx
import type { JSX, MouseEvent } from "react";
import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

export interface CruiseRowActionsProps {
  cruise: Cruise;
  onEdit: (c: Cruise) => void;
  onDuplicate: (c: Cruise) => void;
  onDelete: (id: string) => void;
}

// Edit / Duplicate / Delete cluster on each cruise row. Mirrors FlightRowActions.
// Every handler stops propagation so the row's onOpen navigation never fires.
export default function CruiseRowActions({
  cruise,
  onEdit,
  onDuplicate,
  onDelete,
}: CruiseRowActionsProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={stop(() => onEdit(cruise))}
        className="px-3 py-1 text-xs font-medium rounded"
        style={{ background: "rgba(56,139,253,0.15)", color: "#388bfd" }}
      >
        {t("common:buttons.edit")}
      </button>
      <button
        onClick={stop(() => onDuplicate(cruise))}
        className="px-3 py-1 text-xs font-medium rounded"
        style={{ background: "rgba(139,148,158,0.15)", color: "var(--text-muted)" }}
      >
        {t("cruise:list.duplicate")}
      </button>
      <button
        onClick={stop(() => onDelete(cruise.id))}
        className="px-3 py-1 text-xs font-medium rounded"
        style={{ background: "rgba(248,81,73,0.15)", color: "var(--danger, #f85149)" }}
      >
        {t("common:buttons.delete")}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Cruise/CruiseRowActions.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Cruise/CruiseRowActions.tsx frontend/src/components/Cruise/CruiseRowActions.test.tsx
git commit -m "feat(cruise): CruiseRowActions edit/duplicate/delete cluster"
```

---

### Task 4: Actions column + edit & delete wiring

**Files:**
- Modify: `frontend/src/components/Cruise/CruiseRow.tsx`
- Modify: `frontend/src/pages/CruisesPage.tsx`
- Modify: `frontend/src/i18n/resources/{de,en}/cruise.json`

**Interfaces:**
- Consumes: `CruiseRowActions` (Task 3), `CruiseEditModal` (existing, `{ mode, cruise?, onClose, onSaved }`), `cruiseApi.delete(id)` from `../lib/api`, existing `reload` + toast store in `CruisesPage`.

- [ ] **Step 1: Add an `actions` slot to `CruiseRow`**

In `CruiseRow.tsx`, extend `Props` and render a trailing cell:
```ts
interface Props {
  cruise: Cruise;
  onOpen: () => void;
  actions?: JSX.Element;
}
```
Add `actions` to the destructure and, as the **last** `<td>` (after price), render:
```tsx
<td className="px-3 py-2 text-right text-sm" onClick={(e) => e.stopPropagation()}>
  {actions}
</td>
```
(The wrapper `stopPropagation` is a belt-and-braces guard; `CruiseRowActions` also stops.)

- [ ] **Step 2: Add the Actions header + wire state in `CruisesPage`**

Add imports:
```ts
import CruiseRowActions from "../components/Cruise/CruiseRowActions";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { cruiseApi } from "../lib/api";
```
Add state:
```ts
const [editingCruise, setEditingCruise] = useState<Cruise | null>(null);
const [cruiseToDelete, setCruiseToDelete] = useState<Cruise | null>(null);
```
Add the header cell after the `price` `<th>`:
```tsx
<th className="px-3 py-2 text-right">{t("list.columns.actions")}</th>
```
Pass `actions` into each row:
```tsx
<CruiseRow
  key={c.id}
  cruise={c}
  onOpen={() => navigate(`/cruises/${c.id}`)}
  actions={
    <CruiseRowActions
      cruise={c}
      onEdit={setEditingCruise}
      onDuplicate={/* Task 5 */ () => undefined}
      onDelete={(id) => setCruiseToDelete(sorted.find((x) => x.id === id) ?? null)}
    />
  }
/>
```

- [ ] **Step 3: Render the edit modal + delete confirm**

Near the existing `{showAdd && ...}`:
```tsx
{editingCruise && (
  <CruiseEditModal
    mode="edit"
    cruise={editingCruise}
    onClose={() => setEditingCruise(null)}
    onSaved={async () => {
      setEditingCruise(null);
      await reload();
    }}
  />
)}
{cruiseToDelete && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
    <div className="w-full max-w-sm rounded-xl p-6 space-y-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      role="dialog" aria-modal="true">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {t("list.delete.confirm", { ship: cruiseToDelete.ship?.name ?? cruiseToDelete.shipNameOverride ?? "" })}
      </h2>
      <div className="flex justify-end gap-2">
        <button onClick={() => setCruiseToDelete(null)} className="px-4 py-2 rounded-lg text-sm"
          style={{ color: "var(--text-muted)" }}>
          {t("common:buttons.cancel")}
        </button>
        <button
          onClick={async () => {
            try {
              await cruiseApi.delete(cruiseToDelete.id);
              addToast("success", t("list.delete.done"));
            } catch {
              addToast("error", t("list.delete.error"));
            } finally {
              setCruiseToDelete(null);
              await reload();
            }
          }}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--danger, #f85149)" }}>
          {t("common:buttons.delete")}
        </button>
      </div>
    </div>
  </div>
)}
```
If `addToast` / `common` namespace aren't already available in this file, wire them like the flight table: `const addToast = useToastStore((s) => s.addToast);` and `useTranslation(["cruise", "common"])`. Verify the actual `useTranslation` call/namespaces at the top of `CruisesPage` and extend, don't duplicate.

- [ ] **Step 4: i18n keys (DE + EN)**

`de/cruise.json` — add `"actions": "Aktionen"` **inside `list.columns`** (next to
`price`), and a `delete` object directly under `list`:
```json
    "columns": { "...": "...", "actions": "Aktionen" },
    "delete": {
      "confirm": "Kreuzfahrt „{{ship}}" wirklich löschen?",
      "done": "Kreuzfahrt gelöscht",
      "error": "Löschen fehlgeschlagen"
    },
```
`en/cruise.json` — same shape:
```json
    "columns": { "...": "...", "actions": "Actions" },
    "delete": {
      "confirm": "Delete cruise \"{{ship}}\"?",
      "done": "Cruise deleted",
      "error": "Failed to delete cruise"
    },
```
(Confirm `common:buttons.cancel` exists in both locales; add if missing. Keep the
header key as `list.columns.actions` — Task 4 Step 2 uses `t("list.columns.actions")`.)

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/pages/CruisesPage.tsx src/components/Cruise/CruiseRow.tsx && npx vitest --run src/components/Cruise`
Expected: exit 0, cruise tests green.

```bash
git add frontend/src/components/Cruise/CruiseRow.tsx frontend/src/pages/CruisesPage.tsx frontend/src/i18n/resources/de/cruise.json frontend/src/i18n/resources/en/cruise.json
git commit -m "feat(cruise): inline edit + delete actions on the cruise table"
```

---

### Task 5: Duplicate action

**Files:**
- Modify: `frontend/src/pages/CruisesPage.tsx`
- Modify: `frontend/src/i18n/resources/{de,en}/cruise.json`

**Interfaces:**
- Consumes: `CruiseEditModal` in `create` mode. Its `useState` initializers already seed every field from the passed `cruise`; `handleSave` calls `cruiseApi.create` when `mode==="create"` (source `id` ignored). Passing the source with dates/booking cleared → a real copy the user re-dates.

- [ ] **Step 1: Add duplicate state + build the date-cleared source**

In `CruisesPage.tsx`:
```ts
const [duplicateSource, setDuplicateSource] = useState<Cruise | null>(null);

const startDuplicate = (c: Cruise): void => {
  // Copy everything but identity + dates + booking ref, so the user sets new
  // dates. CruiseEditModal(create) seeds its form from this and calls create().
  setDuplicateSource({ ...c, startDate: null, endDate: null, bookingReference: null });
};
```
Wire the row action (replace the Task-4 placeholder):
```tsx
onDuplicate={startDuplicate}
```

- [ ] **Step 2: Render the duplicate modal (create mode, prefilled)**

Next to the edit modal:
```tsx
{duplicateSource && (
  <CruiseEditModal
    mode="create"
    cruise={duplicateSource}
    onClose={() => setDuplicateSource(null)}
    onSaved={async () => {
      setDuplicateSource(null);
      await reload();
    }}
  />
)}
```

- [ ] **Step 3: i18n `list.duplicate` (DE + EN)**

Add a flat `duplicate` key directly under `list` in both locales — the label
`CruiseRowActions` (Task 3) and its test already reference as `cruise:list.duplicate`.
This is distinct from the header key `list.columns.actions` (Task 4), so there is no
nesting collision.

`de/cruise.json` `"list"`:
```json
    "duplicate": "Duplizieren",
```
`en/cruise.json` `"list"`:
```json
    "duplicate": "Duplicate",
```

- [ ] **Step 4: Full verification**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```
Expected: tsc 0, lint 0, **all** frontend tests pass. Manual smoke (optional): `/cruises` → Duplicate a row → modal opens prefilled with empty dates → save → new cruise appears after reload.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CruisesPage.tsx frontend/src/components/Cruise/CruiseRowActions.tsx frontend/src/components/Cruise/CruiseRowActions.test.tsx frontend/src/i18n/resources/de/cruise.json frontend/src/i18n/resources/en/cruise.json
git commit -m "feat(cruise): duplicate action (prefilled create) on the cruise table"
```

---

## Self-Review

- **Spec coverage:** A(sorting)→Tasks 1-2; B(inline actions/CruiseRowActions/actions column)→Tasks 3-4; C(duplicate/create-prefill)→Task 5; files/i18n/tests folded into the owning tasks; YAGNI (no return-dup, no persistence, cabin static) honored.
- **Placeholder scan:** the only intentional forward-ref is Task 4's `onDuplicate` placeholder, explicitly replaced in Task 5 Step 1.
- **Type consistency:** `CruiseSortKey`/`SortOrder` (Task 1) used verbatim in Task 2; `CruiseRowActionsProps` (Task 3) matches the wiring in Task 4/5. i18n paths are now consistent: header = `list.columns.actions` (Task 4), duplicate label = `list.duplicate` (Tasks 3 + 5) — no nesting collision.
