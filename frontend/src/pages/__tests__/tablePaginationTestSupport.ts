import { screen } from "@testing-library/react";

/**
 * Shared by the four logbook pagination tests (FlightsTablePage, CruisesPage,
 * LodgingListPage, PlacesListPage) — all four render through the same `Table`
 * + `TablePagination` primitives, so "how many rows actually rendered" and
 * "is the pager showing" are asked identically everywhere. Kept here instead
 * of copy-pasted four times (review finding 1, 2026-09-17: nothing tested the
 * wiring, and four independent copies of the same assertion is exactly where
 * one of them drifts unnoticed).
 */

/** Data rows only. `[role="row"]` also matches the `Table` primitive's own
 *  header row, which carries the same role — `.ts-table-row` does not. */
export function countRenderedRows(container: HTMLElement): number {
  return container.querySelectorAll(".ts-table-row").length;
}

/** True once `TablePagination` has rendered its next/previous controls. The
 *  global `react-i18next` test mock returns the raw key, so the accessible
 *  names are the untranslated `common:table.pagination.*` keys.
 *
 *  `queryAll`, because each list renders the control at BOTH ends since
 *  2026-09-21 — a single-match query would now throw on every page rather
 *  than answer the question this helper is asked. */
export function paginationControlsRendered(): boolean {
  return (
    screen.queryAllByRole("button", { name: "common:table.pagination.next" }).length > 0 &&
    screen.queryAllByRole("button", { name: "common:table.pagination.previous" }).length > 0
  );
}

/** Both copies of the page-size select — above and below the table. They are
 *  the same control rendered twice, so a test that only needs "the" select
 *  takes the first. */
export function pageSizeSelects(): HTMLSelectElement[] {
  return screen.queryAllByLabelText("common:table.pagination.pageSize") as HTMLSelectElement[];
}
