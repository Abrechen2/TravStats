/**
 * How far a bottom-right map overlay has to sit above the map's bottom edge.
 *
 * MapLibre draws its attribution bar in that corner, and CARTO and
 * OpenStreetMap both require the credit to stay visible — covering it is a
 * licence matter, not a cosmetic one. At `bottom: 12` the map key's lower
 * rows sat on the line reading "MapLibre | © CARTO, © OpenStreetMap
 * contributors": measured at 32 px of overlap on the dashboard (#273), so
 * anything under 44 px is known to collide. 52 leaves a visible gap.
 *
 * One constant for every tab that draws a key in that corner. Three tabs used
 * to carry their own copy of the number, which is how a value like this
 * drifts: a tidy-up on one tab and the credit is covered again on that tab
 * only.
 */
export const ATTRIBUTION_CLEARANCE = 52;

/** The overlap measured at bottom: 12 was 32 px, so this is the least that clears the bar. */
export const ATTRIBUTION_BAR_CLEARANCE_MIN = 44;
