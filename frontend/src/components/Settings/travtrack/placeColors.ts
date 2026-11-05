import type { FixedPlaceKind } from "../../../lib/api/travtrackPlaces";

/** The place kinds' colours, shared by the list's dots and the map's circles (mock-up Settings.dc.html). */
export type Rgb = [number, number, number];

export const PLACE_RGB: Record<FixedPlaceKind, Rgb> = {
  home: [94, 194, 178],
  work: [240, 169, 71],
  custom: [165, 151, 232],
};

/** Privacy zones are drawn dashed in this red, never filled. */
export const ZONE_RGB: Rgb = [238, 108, 97];

export const rgbCss = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`;
