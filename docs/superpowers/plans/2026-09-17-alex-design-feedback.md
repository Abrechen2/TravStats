# Alex's design-beta feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nine points the tester raised against the design beta (CT134, `2.7.0-design.6`) are fixed on `dev/design-system`, so the next build carries them.

**Architecture:** Eight small, independent frontend changes plus one larger one (client-side pagination in the four logbook lists). No backend change. Each point already has its cause located; this plan carries it.

**Tech Stack:** React + Vite + TypeScript, Zustand, react-i18next, Vitest + Testing Library.

**Source:** Discord `#dev-talk`, 2026-09-17 17:13/17:14 UTC (tester "Alex"), approved by the owner the same day ("Alles wie Alex es wollte ist ok"). Leitstand items `design-feedback-alex-*`.

## Global Constraints

- Worktree `D:\TravStats_Projekt\TravStats\.worktrees\design-system`, branch `dev/design-system`. Never commit to main, never merge, never push, never `git stash`, never `taskkill`.
- Code, comments and commits in English; UI copy German first with English mirrored in the same change (`frontend/src/i18n/__tests__/localeKeyParity.test.ts`).
- Gate per task: `cd frontend && npx tsc --noEmit && npm run lint` (max-warnings 0, no `any`) and the tests covering the change; the full frontend suite (`npx vitest --run`) once per task before committing.
- The frontend test setup fails any real network request — mock the APIs a component calls.
- No source file over 800 lines; files in `scripts/file-size-baseline.json` may not grow (`node scripts/check-file-size.mjs` from the worktree root).
- Every behaviour change ships with a test that fails without it.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Owner decisions binding here: the passport page becomes dark like the rest of the app (the "paper" look goes); the inbox keeps only the header icon; the admin page becomes one long page with anchor jumps, like settings.

---

### Task 1: One order for the settings sections, and a reachable last section

**Files:**
- Modify: `frontend/src/pages/Settings/settingsModel.ts:65-146` (`SETTINGS_GROUPS`, `GENERAL_CONTENT_ORDER`)
- Modify: `frontend/src/pages/SettingsPage.tsx:123-148`, `:260-269`
- Test: `frontend/src/pages/__tests__/settingsSectionOrder.test.ts` (create), plus the existing SettingsPage tests

**Interfaces:**
- Produces: one exported order helper (e.g. `sectionOrderFor(groupId)` or a single flattened `SECTION_ORDER`) used by both the index column and the page body.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/pages/__tests__/settingsSectionOrder.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_GROUPS, sectionsForGroup, contentOrderForGroup } from "../Settings/settingsModel";

// The tester saw the left menu highlight jump while scrolling: the menu listed
// the sections in one order and the page rendered them in another, so the
// section in view was never the neighbour of the one highlighted before it.
describe("settings section order", () => {
  it("lists a group's sections in the order the page renders them", () => {
    for (const group of SETTINGS_GROUPS) {
      expect(sectionsForGroup(group.id).map((s) => s.id)).toEqual(contentOrderForGroup(group.id));
    }
  });
});
```

(Names: use whatever the model exports after the change; the assertion — menu order equals render order for every group — is the point.)

- [ ] **Step 2: Run it — expect FAIL** (`cd frontend && npx vitest --run src/pages/__tests__/settingsSectionOrder.test.ts`)

- [ ] **Step 3: Make one order the source**

In `settingsModel.ts`, delete `GENERAL_CONTENT_ORDER` and derive the page order from each group's `sections` array (the menu's order), or keep the "everyday first" order and rebuild the menu from it — pick the one that keeps the everyday sections (profile, display, units, …) near the top, and say in a comment why one array is gone. `SettingsPage.tsx` then feeds both the index column and the body from that single order.

- [ ] **Step 4: Make the last section reachable**

In `SettingsPage.tsx`, after the last rendered section add a spacer so every section can reach its `scrollMarginTop`:

```tsx
{/* The last section must be able to reach the top of the viewport, or its
    menu entry can never become active — the tester could not open
    "Über TravStats" at all. */}
<div aria-hidden style={{ minHeight: "calc(100vh - var(--ts-size-web-header) - 120px)" }} />
```

- [ ] **Step 5: Test the spacer**

Add to the same new test file (or a SettingsPage test that renders the page with a stubbed section list): assert the spacer element exists after the last section — e.g. `expect(container.querySelector('[data-testid="settings-scroll-tail"]')).toBeInTheDocument()` with that `data-testid` on the spacer. Keep it honest: jsdom cannot measure scrolling, so the test pins the spacer's presence, and the comment says the browser check is what proves the behaviour.

- [ ] **Step 6: Run the covering tests, then the full suite, then commit**

```bash
cd frontend && npx vitest --run src/pages src/components/Settings && npx tsc --noEmit && npm run lint && npx vitest --run
git add frontend/src && git commit -m "fix(settings): one section order, and a last section that can reach the top

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The dashboard tab counts stop flickering

**Files:**
- Modify: `frontend/src/App.tsx:249-251` (the `Routes` key) **or** `frontend/src/pages/DashboardPage.tsx:67-131` (hoist the counts)
- Test: `frontend/src/pages/__tests__/DashboardPage.counts.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Render the dashboard at `/dashboard/flights` with mocked count APIs, wait for the counts, then navigate to `/dashboard/cruises` within the same `MemoryRouter`, and assert the count badge text never returns to its loading state: query the tab strip's flight badge and assert it still shows the loaded number immediately after the tab change (no `0`, no empty badge).

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Fix the remount**

`Routes` is keyed on `location.pathname`, so `/dashboard/flights` → `/dashboard/cruises` remounts `DashboardPage` and resets its `counts` state. Key the animated `Routes` on the first path segment instead (`location.pathname.split("/")[1]`), with a comment naming this bug. If that breaks a page transition test, prefer the alternative: move `counts` into a small module-level cache or a Zustand store so a remount reuses the loaded numbers.

- [ ] **Step 4: Run the test, the dashboard tests and the full suite, then commit**

---

### Task 3: Passport in the app's own dark colours, without the stray back link

**Files:**
- Modify: `frontend/src/pages/PassportPage.tsx:114-131,160-390`
- Modify: `frontend/src/theme/ui.css:122-141` (`.ts-paper`) — delete the class if nothing else uses it (grep first)
- Test: `frontend/src/pages/__tests__/PassportPage*.test.tsx` (extend the existing ones)

- [ ] **Step 1: Write the failing test** — assert the page's wrapper no longer carries the `ts-paper` class and that no link to `/stats` labelled "Zurück…" is rendered.
- [ ] **Step 2: Run it — expect FAIL**
- [ ] **Step 3: Remove the `.ts-paper` wrapper** so the page inherits the app's dark tokens, and delete the back link. If a passport card genuinely needs a warmer surface, use the existing tokens (`--ts-surface`, `paperAccent`) rather than re-defining colour variables. Keep the contrast of the stamp accents (`paperAccent #8a5213` was measured at 5.16:1 against the paper background — on dark it must be re-picked; use an existing accent token instead of inventing a colour).
- [ ] **Step 4: Run the passport tests, the design-warden tests (`src/__tests__/designWardens.test.ts`), the full suite; commit.**

---

### Task 4: Admin link in the account menu, inbox only in the header

**Files:**
- Modify: `frontend/src/components/Nav/useNavItems.ts:154-187` (drop the `inbox` and `admin` leaves)
- Modify: `frontend/src/components/Nav/UserMenu.tsx:8-14,99-178` (add an admin entry, admins only)
- Test: `frontend/src/components/Nav/__tests__/` (extend the existing nav tests; create a `UserMenu.admin.test.tsx` if none fits)

- [ ] **Step 1: Write the failing tests** — (a) `useNavItems` returns no `admin` and no `inbox` leaf under "Mehr"/tools, for an admin and for a normal user; (b) `UserMenu` renders a link to `/admin` for `isAdmin: true` and none for `isAdmin: false`.
- [ ] **Step 2: Run them — expect FAIL**
- [ ] **Step 3: Implement.** The account menu gets the admin link between the settings link and the support group, with the same styling as its neighbours; i18n key reuses the existing admin label (grep for it) — no new copy if one exists.
- [ ] **Step 4: Full suite; commit.**

---

### Task 5: The map loses its rounded corners

**Files:**
- Modify: `frontend/src/components/MapContainer3D.tsx:242-246`
- Test: `frontend/src/components/__tests__/MapContainer3D*.test.tsx` (extend, or assert in an existing dashboard test)

- [ ] **Step 1: Write the failing test** — the map's outer element does not carry `rounded-lg`/`shadow-sm`.
- [ ] **Step 2: Run it — expect FAIL**
- [ ] **Step 3: Drop `rounded-lg shadow-sm`** from the wrapper, with a comment saying why (full-bleed surface, no frame to round against).
- [ ] **Step 4: Run the map/dashboard tests and the full suite; commit.**

---

### Task 6: The admin page becomes one page with anchor jumps

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx:156-160,565-596,600-846`
- Modify: `frontend/src/components/Admin/AdminIndex.tsx:52-146`
- Test: `frontend/src/pages/__tests__/AdminPage.sections.test.tsx` (create)

**Interfaces:**
- Consumes the settings pattern: `SettingsIndex` renders `<a href="#settings-x">` + `scrollIntoView`; `SettingsPage` renders every section with `id` and `scrollMarginTop`.

- [ ] **Step 1: Write the failing test** — render `AdminPage` with its APIs mocked and assert that several section headings are in the document at once (today only the active one is), and that the index entries are links to `#admin-<id>` rather than buttons.
- [ ] **Step 2: Run it — expect FAIL**
- [ ] **Step 3: Port the pattern.** Render every section in the page order with `id={`admin-${section.id}`}` and the same `scrollMarginTop` value settings uses; `AdminIndex` entries become anchors that `scrollIntoView`; keep `?section=` working as a deep link by scrolling to it on mount. Keep the sections' own data loading lazy if a section fetches on mount and that would now fire for all of them — in that case load on first intersection, and say so in a comment. `AdminPage.tsx` is in the file-size baseline (847 lines): the change must not make it longer — extract the section list into a small module if needed.
- [ ] **Step 4: Run the admin tests, `node scripts/check-file-size.mjs`, the full suite; commit.**

---

### Task 7: The four logbook lists page through their rows

**Files:**
- Create: `frontend/src/components/table/TablePagination.tsx`
- Create: `frontend/src/components/table/usePagination.ts`
- Modify: `frontend/src/pages/FlightsTablePage.tsx`, `CruisesPage.tsx`, `LodgingListPage.tsx`, `PlacesListPage.tsx` (render `paged` rows, add the control under the table)
- Modify: `frontend/src/i18n/resources/{de,en}/common.json`
- Test: `frontend/src/components/table/__tests__/usePagination.test.ts`, `TablePagination.test.tsx` (create)

**Decision carried from the controller:** pagination happens in the browser over the already-loaded, filtered and sorted rows. The pages keep loading the full set, because filters, sorting and the summary strip are computed over all rows; server-side paging would silently narrow them. Page size choices: 25 / 50 / 100 / all, default 50, remembered per list in `localStorage` (key `travstats:table-page-size:<tableKey>`), reset to page 1 whenever the filtered row count or the page size changes.

- [ ] **Step 1: Write the failing hook test**

```ts
// frontend/src/components/table/__tests__/usePagination.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "../usePagination";

// The tester's logbook had 123 flights in one endless list.
describe("usePagination", () => {
  const rows = Array.from({ length: 123 }, (_, i) => i);

  it("cuts the rows into pages of the chosen size", () => {
    const { result } = renderHook(() => usePagination(rows, "flights-test"));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.paged).toHaveLength(50);
    expect(result.current.pageCount).toBe(3);
    act(() => result.current.setPage(3));
    expect(result.current.paged).toEqual([100, 101, 102, /* … */ 122].slice(0, 23));
  });

  it("goes back to the first page when the row set shrinks under the current page", () => {
    const { result, rerender } = renderHook(({ r }) => usePagination(r, "flights-test"), {
      initialProps: { r: rows },
    });
    act(() => result.current.setPage(3));
    rerender({ r: rows.slice(0, 10) });
    expect(result.current.page).toBe(1);
    expect(result.current.paged).toHaveLength(10);
  });

  it("shows everything when the size is 'all'", () => {
    const { result } = renderHook(() => usePagination(rows, "flights-test"));
    act(() => result.current.setPageSize("all"));
    expect(result.current.paged).toHaveLength(123);
    expect(result.current.pageCount).toBe(1);
  });
});
```

(Fix the third assertion of the first case to the real slice — the point is the last page holds the remaining 23 rows.)

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Write `usePagination`** — signature `usePagination<T>(rows: readonly T[], tableKey: string): { paged: T[]; page: number; pageCount: number; pageSize: number | "all"; setPage(n: number): void; setPageSize(s: number | "all"): void; total: number }`. Persist the size per `tableKey` in `localStorage` inside try/catch (the storage can throw), default 50.

- [ ] **Step 4: Write `TablePagination`** — a row under the table: "„x–y von z“", first/prev/next/last buttons (disabled at the ends, each with an accessible name), and a page-size select with 25/50/100/Alle. All copy through i18n (`common:table.pagination.*`), DE and EN together. Buttons are real `<button>`s with `aria-label`s; the select has a visible label.

- [ ] **Step 5: Test the control** — renders the range text, calls `setPage` on next/prev, disables prev on page 1 and next on the last page, and calls `setPageSize` from the select.

- [ ] **Step 6: Wire the four pages** — each list feeds its already filtered+sorted array through `usePagination(rows, "<domain>-list")`, renders `paged` in the `Table`, and puts `<TablePagination …/>` directly under the table frame. The summary strip and filter counts keep using the full filtered set, not the page. Keep the existing "load everything" fetch as it is.

- [ ] **Step 7: Run the list-page tests, the i18n parity test, `node scripts/check-file-size.mjs`, the full suite; commit.**

---

### Task 8: Browser check of all nine points

Not a code task — the controller runs it after Task 7 against a local stack (backend 8011, frontend 3021, design DB on 5434) at 1440×900 and 390×844, and records what it measured per point.
