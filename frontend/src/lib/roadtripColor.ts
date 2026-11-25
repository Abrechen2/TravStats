// How roadtrip lines are coloured on the maps (GitHub #408).
//
// Two explicit modes, like the flight and cruise ones — never decided by a view:
//   - "single"      — every roadtrip in the roadtrip domain colour (the default)
//   - "perRoadtrip" — each roadtrip in a colour of its own: the colour set on
//                     the roadtrip, else one picked from the shared list palette
//                     by its id, so the same roadtrip keeps its colour on every
//                     visit and on every map.
//
// Lines (`hooks/useDashboardTours`, `hooks/useTripTourGeometries`) and the
// dashboard legend (`Dashboard/tabs/tourMapOverlay`) resolve through
// `roadtripLineHex` below, so the map and its key cannot disagree.

import { LIST_PALETTE_HEX } from "./listPalette";

export type RoadtripColorMode = "single" | "perRoadtrip";

/** Render order of the mode picker. */
export const ROADTRIP_COLOR_MODES = ["single", "perRoadtrip"] as const;

export const DEFAULT_ROADTRIP_COLOR_MODE: RoadtripColorMode = "single";

/** A stored blob is external data: anything but a known mode is the default. */
export function roadtripColorModeFromStored(raw: unknown): RoadtripColorMode {
  return raw === "perRoadtrip" || raw === "single" ? raw : DEFAULT_ROADTRIP_COLOR_MODE;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** FNV-1a: small, stable across sessions and browsers (unlike anything seeded). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The palette colour a roadtrip gets when nobody chose one for it. */
export function paletteColorForRoadtrip(id: string): string {
  return LIST_PALETTE_HEX[hashId(id) % LIST_PALETTE_HEX.length];
}

/**
 * The hex a roadtrip's line is drawn in. `ownColor` is the colour saved on the
 * roadtrip; a malformed one is ignored rather than drawn as an invalid fill.
 */
export function roadtripLineHex(
  mode: RoadtripColorMode,
  roadtrip: { id: string; color?: string | null },
  domainHex: string
): string {
  if (mode === "single") return domainHex;
  return roadtrip.color && HEX.test(roadtrip.color)
    ? roadtrip.color
    : paletteColorForRoadtrip(roadtrip.id);
}
