import type { TableColumn } from "../ui/Table";

/**
 * What a logbook row must still say at 390px.
 *
 * The owner's acceptance question for this round, in his words: route or
 * destination, date and status have to be readable in all four logbooks on a
 * phone, without scrolling sideways. The `Table` primitive already collapses
 * into a row below 640px and gives each column an `onNarrow` place; what was
 * missing is the guarantee that the three columns carrying those three facts
 * are the ones that survive.
 *
 * Two things could break it, and both are closed here rather than remembered:
 *
 * 1. A column could simply not declare a narrow place. `narrowColumn` makes
 *    the declaration the only way to build one.
 * 2. The column picker could hide the date or the status on a desktop, and the
 *    phone would inherit the choice — a hidden column has no cell to collapse.
 *    Hence `NARROW_ESSENTIAL`: the three places a list cannot give up, checked
 *    against each domain's always-visible set by `narrowColumns.test.ts`.
 *
 * `mark` and `hide` are free: an airline monogram is decoration, and anything
 * dropped on a phone is reachable in the entry itself.
 */
export type NarrowPlace = NonNullable<TableColumn["onNarrow"]>;

/** The three a row may not drop: destination, when, and what state it is in. */
export const NARROW_ESSENTIAL: readonly NarrowPlace[] = ["title", "subtitle", "trailing"];

export function isEssential(place: NarrowPlace | undefined): boolean {
  return place !== undefined && NARROW_ESSENTIAL.includes(place);
}
