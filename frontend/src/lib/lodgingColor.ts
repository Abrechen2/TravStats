// Single source of truth for the lodging pin colour and its map-legend row.
//
// Unlike flights/cruises, lodging has no user-settable colour MODE — it's
// always ONE fixed brand colour (BRAND.md §3, `DOMAINS.lodging.color` in
// `shared/domains.ts`). There is nothing to derive per-render, but the same
// invariant applies: the pin layer (`layers/lodgingPinsLayer.ts`'s
// `LODGING_RGB`) and the dashboard legend (`Dashboard/tabs/AllTab.tsx`) must
// resolve the SAME constant rather than two independently maintained hex
// literals that could drift apart.

import { DOMAINS } from "../shared/domains";
import type { Rgb } from "./cruiseColor";
import { hexToRgb } from "../components/map/controlPanelKit";

/** The one lodging pin colour — derived from the SAME constant
 *  `lodgingPinsLayer.ts`'s `LODGING_RGB` derives from, via the ONE shared
 *  `hexToRgb` (`controlPanelKit.tsx`) rather than a third private hex parser. */
export const LODGING_COLOR: Rgb = hexToRgb(DOMAINS.lodging.color);

/** One row of the map legend. Lodging has exactly one — there is no mode to
 *  switch between — but the shape mirrors `FlightLegendRow`/`CruiseLegendRow`'s
 *  "swatch" variant so a caller (`AllTab.tsx`) can render all three domains'
 *  rows through the same renderer. */
export interface LodgingLegendRow {
  kind: "swatch";
  slot: "lodging";
  color: Rgb;
}

/**
 * The (single) legend row for lodging pins — derived from `LODGING_COLOR`,
 * NOT from a parallel colour literal. This is what makes it structurally
 * impossible for the legend and the pin layer to disagree.
 */
export function buildLodgingLegend(): LodgingLegendRow[] {
  return [{ kind: "swatch", slot: "lodging", color: LODGING_COLOR }];
}
