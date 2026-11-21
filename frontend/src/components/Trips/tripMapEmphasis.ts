// How the trip map tells the chosen day from the rest, and how it keeps the
// order numbers from burying the map (forgejo#424).
//
// Owner, 2026-11-21: "das Ausgrauen ist nicht richtig sichtbar bei Tageswahl".
// The old dim only dropped alpha to 55 and kept the entry's hue, so a faint
// teal line next to a full teal line read as "the same, a bit lighter" on both
// basemaps. A day that is not chosen is now desaturated to a neutral grey AND
// faint AND thinner; the chosen day keeps its colour and gets wider lines and
// bigger dots. The hue still comes from the colour stores — only the dim is
// derived from it here.

import { declutterByDistance } from "../map/labelPriority";
import type { TripLabelItem } from "./tripMapLabels";

type Rgb = readonly [number, number, number];
type Rgba = [number, number, number, number];

/** Alpha an entry off the chosen day keeps (of 255). */
export const DIM_ALPHA = 85;
/** How much of its own colour a dimmed entry keeps; the rest is grey. */
const DIM_KEEP = 0.15;
const DIM_GREY = 140;

export type DayState = "normal" | "dim" | "active";

/** `normal` while no day is chosen; otherwise the entry is on the day or it is not. */
export function dayState(dim: boolean | undefined, dayChosen: boolean): DayState {
  if (!dayChosen) return "normal";
  return dim ? "dim" : "active";
}

/** A tour line's state: with no day to judge it by, it keeps the all-days style. */
export function tourState(d: { dim?: boolean; neutral?: boolean }, dayChosen: boolean): DayState {
  return d.neutral ? "normal" : dayState(d.dim, dayChosen);
}

/** Tour lines drawn faint first, undated next, the chosen day's on top. */
export function tourDrawOrder<T extends { dim?: boolean; neutral?: boolean }>(
  items: readonly T[]
): T[] {
  const rank = (d: T): number => (d.dim ? 0 : d.neutral ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** The entry's colour at its day state: desaturated when dim, untouched otherwise. */
export function emphasisColor(color: Rgb, state: DayState, fullAlpha: number): Rgba {
  if (state !== "dim") return [color[0], color[1], color[2], fullAlpha];
  const mix = (c: number): number => Math.round(c * DIM_KEEP + DIM_GREY * (1 - DIM_KEEP));
  return [mix(color[0]), mix(color[1]), mix(color[2]), DIM_ALPHA];
}

const WIDTH_FACTOR: Record<DayState, number> = { normal: 1, dim: 0.55, active: 1.5 };

/** A line or radius scaled for the day state. */
export function emphasisWidth(base: number, state: DayState): number {
  return base * WIDTH_FACTOR[state];
}

/** Dimmed entries first, so the chosen day's lines and dots are drawn on top. */
export function dimFirst<T extends { dim?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(b.dim === true) - Number(a.dim === true));
}

/** Below this zoom no order number is drawn unless a day is chosen. */
export const NUMBERS_MIN_ZOOM = 6;
/** Gap between two numbers in `declutterByDistance`'s 256-px pixels (about twice that on screen); tighter than a name's. */
const NUMBER_GAP_PX = 16;

/**
 * The order numbers worth printing. With a day chosen only that day's are
 * (a faint number is noise, and the day is what the reader is walking);
 * with none chosen they wait for zoom 6 and are thinned by screen distance,
 * earliest first. The number of a dropped stop stays on its info card.
 */
export function pickSequenceItems(
  items: readonly TripLabelItem[],
  zoom: number,
  dayChosen: boolean
): TripLabelItem[] {
  const numbered = items.filter((i) => i.seq !== undefined && !(dayChosen && i.dim));
  if (!dayChosen && zoom < NUMBERS_MIN_ZOOM) return [];
  return declutterByDistance(
    numbered,
    (i) => 10000 - (i.seq ?? 9999),
    (i) => i.position,
    zoom,
    NUMBER_GAP_PX
  );
}
