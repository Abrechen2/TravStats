import { rgb, tokens } from "../theme/tokens";
import type { Rgb } from "./cruiseColor";

/**
 * What a route's STATUS looks like on the map — the defaults of the two
 * user-settable colours in `flightColorMode: "status"` and its cruise twin.
 *
 * Since 2.7.0 they are tokens, and the rule they follow is the one the design
 * system already states for the status pill: **status displaces the domain
 * unless the entry is flown.** Applied to a route that reads:
 *
 *  - **flown → the DOMAIN colour.** The journey happened; what is worth saying
 *    about it is which domain it belongs to. Flights stay amber (their domain
 *    colour IS the accent, which is why `tokens.json → map` writes
 *    `flownStroke: "accent"`), cruises move from a blue that means `info`
 *    everywhere else to their own teal.
 *  - **planned → `info`, for every domain.** It has not happened yet, and that
 *    is the news. `tokens.json → map` says `plannedStroke: "dashed info"`; the
 *    dash is not drawn — see the note at the bottom — but the colour is.
 *
 * The trade this makes, stated plainly: a planned flight and a planned cruise
 * are now the same blue, where they used to be coral and cyan. On the "Alle"
 * tab you can no longer tell them apart by hue alone — only by the shape of
 * the line, the legend, and the tooltip. That is the cost of saying "planned"
 * with a colour, and it is the same trade the status pill makes on every row.
 * Anyone who wants the old separation back picks it: these are DEFAULTS, and
 * the colour slots stay user-settable.
 *
 * Both renderers (`layers/routesLayer.ts`, `Globe/buildGlobeLayers.ts`) and
 * the dashboard legend resolve through `flightColor.ts` / `cruiseColor.ts`,
 * which seed themselves from here, so map and legend cannot drift.
 */

/** Flown flights: the flight domain colour, which is the brand accent. */
export const FLIGHT_STATUS_PAST_COLOR: Rgb = rgb(tokens.domainColor.flight);

/**
 * Planned flights: `info`.
 *
 * Was coral `#fb7185`, chosen to pair with the orange and stay clear of the
 * cool cruise blues. It carried no meaning beyond "not the other one" — and
 * `info` is what the rest of the system says for "planned, waiting, offline".
 */
export const FLIGHT_STATUS_UPCOMING_COLOR: Rgb = rgb(tokens.color.info);

/** Sailed cruises: the cruise domain colour. Was `#4a90d9`, a second blue. */
export const CRUISE_STATUS_PAST_COLOR: Rgb = rgb(tokens.domainColor.cruise);

/** Planned cruises: `info`, the same as a planned flight. Was cyan `#22d3ee`. */
export const CRUISE_STATUS_PLANNED_COLOR: Rgb = rgb(tokens.color.info);

/**
 * NOT IMPLEMENTED: the dash on a planned stroke.
 *
 * `tokens.json → map` asks for `dashed info`, and a dash is how the whole
 * system says "provisional" — the pending pill is dashed, an unconfirmed row
 * is dashed. deck.gl's `PathLayer` and `ArcLayer` have no dash without
 * `PathStyleExtension`, which does not apply to arcs at all, so the planned
 * routes are drawn solid in `info` for now. The colour carries the meaning;
 * the dash is an open item for whoever gives the globe its own pass.
 */
export const PLANNED_STROKE_IS_DASHED = false;
