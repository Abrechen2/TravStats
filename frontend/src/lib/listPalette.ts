import { rgb, tokens, type Rgb } from "../theme/tokens";

/**
 * The ten colours a user may pick from, everywhere.
 *
 * The web had six separate quick-pick lists — for trips, cruises, flights,
 * lodgings, places and place lists — assembled independently and overlapping
 * by accident. Between them they offered the same slate-200 four times and,
 * worse, several of the hues the shared system reserves: the `info` blue, the
 * `good` mint, the cruise teal. A map reads colour as MEANING, so letting a
 * user paint a trip in the exact blue that means "planned" quietly breaks the
 * legend for them.
 *
 * `listColor.palette` in the token file is the answer both apps share, and it
 * excludes those hues on purpose (`accent`, `bad`, `info`, `good`, `cruise` —
 * see `_excluded` there). This module is that palette, in the two shapes the
 * app needs: hex for a swatch in the DOM, `[r, g, b]` for a deck.gl layer.
 *
 * NOT done here, and deliberately: the token file also says `freeHex: false`,
 * meaning the user picks a NAME and never types a hex. The pickers still offer
 * a free colour input beside these swatches. Removing it is a change to five
 * separate control panels and belongs with the rest of the clean-up in block 7.
 */

export type ListColorName = keyof typeof tokens.listColor;

/** In the token file's order, which is the order the swatches render in. */
export const LIST_COLOR_NAMES = Object.keys(tokens.listColor) as ListColorName[];

export const LIST_PALETTE_HEX: readonly string[] = LIST_COLOR_NAMES.map(
  (name) => tokens.listColor[name]
);

export const LIST_PALETTE_RGB: readonly Rgb[] = LIST_PALETTE_HEX.map(rgb);

/**
 * The palette with a domain's own colour in front.
 *
 * A cruise panel should offer the cruise teal first — it is the value the
 * field already holds, and a picker whose current value is missing from its
 * own swatch row reads as broken. The domain colour is one of the hues
 * `listColor` excludes, which is right for a LIST (a user-named grouping) and
 * wrong for the domain's own default, so it is prepended rather than added to
 * the shared palette.
 */
export function paletteLedBy(hex: string): readonly Rgb[] {
  return [rgb(hex), ...LIST_PALETTE_RGB];
}
