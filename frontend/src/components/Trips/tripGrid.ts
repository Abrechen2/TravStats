/**
 * The one grid the trips page lays its rows out on.
 *
 * The insights tiles and the trip cards below them must share breakpoints
 * AND gap, or their column edges drift apart down the page: with its own
 * `sm:grid-cols-3 gap-3` the tile row was three-across while the cards were
 * still one, and even at full width its right edge missed theirs by 3 px
 * (#271). Both read this string, so there is one place the grid can change.
 */
export const TRIP_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";
