import type { EntryWindow } from "../../locationEvidence/journeys/entryWindows";
import type { LegMode } from "./types";

/**
 * What a logbook entry says about HOW a stretch was travelled (spec §1.2).
 * The adapters of `entryWindows.ts` say THAT an entry covers movement; the
 * mode is the entry's own domain. An entry whose domain names no mode (a stay
 * or a place visit never holds movement) is `unknown`.
 */
export function entryModeOf(domain: EntryWindow["domain"]): LegMode {
  switch (domain) {
    case "flight":
      return "flight";
    case "rail":
      return "train";
    case "bus":
      return "bus";
    case "ferry":
    case "cruise":
      return "boat";
    case "rental":
    case "roadtrip":
      return "car";
    default:
      return "unknown";
  }
}

/**
 * A rental or a roadtrip covers days, most of it spent on foot or parked: its
 * window does not CUT a day into legs, it names a mode only for a stretch the
 * phone does not clearly show on foot (`derive.ts`).
 */
export const isBroadEntry = (domain: EntryWindow["domain"]): boolean =>
  domain === "rental" || domain === "roadtrip";

/** The shortest window holding `tMs`: the most specific entry wins. */
export function tightestWindow(tMs: number, windows: readonly EntryWindow[]): EntryWindow | null {
  let best: EntryWindow | null = null;
  for (const w of windows) {
    if (tMs < w.fromMs || tMs > w.untilMs) continue;
    if (best === null || w.untilMs - w.fromMs < best.untilMs - best.fromMs) best = w;
  }
  return best;
}
