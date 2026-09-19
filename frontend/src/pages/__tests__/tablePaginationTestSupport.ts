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
 *  names are the untranslated `common:table.pagination.*` keys. */
export function paginationControlsRendered(): boolean {
  return (
    screen.queryByRole("button", { name: "common:table.pagination.next" }) !== null &&
    screen.queryByRole("button", { name: "common:table.pagination.previous" }) !== null
  );
}
