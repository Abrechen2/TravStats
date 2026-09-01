/**
 * What a place on the map is labelled with.
 *
 * Two levels decide it. A places list carries a DEFAULT (`labelMode`): the
 * McDonald's list wants a 🍟, the hotels list wants names. The map then carries
 * an override that applies to the whole map at once (`placeLabelSource`), so a
 * single flip brings every name back without editing a list, and a flip back
 * restores the symbols.
 *
 * Both levels meet here and nowhere else. The pin layer, the legend and the
 * control panel all ask this function rather than each re-deciding — the last
 * display rule this project kept in two places shipped wrong in three release
 * candidates because only one of the copies was fixed.
 */

/** The list's own default. */
export type PlaceLabelMode = "name" | "icon";

/**
 * The map-wide override. `list` defers to each list's own default and is what
 * an absent stored value means — a user whose localStorage predates this
 * setting must see their lists' choices, not have them silently overruled.
 */
export type PlaceLabelSource = "list" | "name" | "icon";

/** The list a place takes its appearance from, or `null` for a place in none. */
export interface PlaceLabelList {
  labelMode: PlaceLabelMode;
  icon: string | null;
}

/** `name` carries no payload: the layer already knows the place's name. */
export type PlaceLabel = { kind: "name" } | { kind: "icon"; glyph: string };

const NAME: PlaceLabel = { kind: "name" };

export function resolvePlaceLabel({
  source,
  list,
}: {
  source: PlaceLabelSource | undefined;
  list: PlaceLabelList | null;
}): PlaceLabel {
  if (source === "name") return NAME;

  // A place in no list has no symbol to inherit, and "always symbols" must not
  // erase it from the map.
  if (!list) return NAME;
  const glyph = list.icon?.trim();
  if (!glyph) return NAME;

  if (source === "icon") return { kind: "icon", glyph };

  // "list", and the absent case that means the same thing.
  return list.labelMode === "icon" ? { kind: "icon", glyph } : NAME;
}
