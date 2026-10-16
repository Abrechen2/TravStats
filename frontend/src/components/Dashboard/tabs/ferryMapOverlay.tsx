import type { JSX } from "react";
import type { LegendRowFn } from "./allTabLegendRows";
import { ferryApi } from "../../../lib/api/ferry";
import type { FerryJourney } from "../../../types/ferry";
import {
  buildTerminalRideLegendRows,
  useTerminalRideOverlay,
  type TerminalRideOverlay,
  type TerminalRideOverlaySpec,
} from "./terminalRideMapOverlay";

type Translate = (key: string) => string;

/**
 * The ferry layer of the "Alle" map: one line per crossing — its hand-drawn sea
 * lane where one was drawn, else the chord between the two ports — in the
 * ferry colour of the domain colour store. The terminal-ride overlay bus uses
 * (`terminalRideMapOverlay.tsx`); a ferry has no routed line, so a stored line
 * is always one the user drew.
 */
export const FERRY_OVERLAY: TerminalRideOverlaySpec<FerryJourney> = {
  domain: "ferry",
  idPrefix: "all-ferry",
  legend: {
    only: "dashboard:legend.ferry",
    drawn: "dashboard:legend.ferryDrawn",
    straight: "dashboard:legend.ferryStraight",
    drawnRow: "ferry-drawn",
    straightRow: "ferry-straight",
  },
  load: (query) => ferryApi.listAll(query),
};

/** One key per kind of line actually on the map. */
export function buildFerryLegendRows(
  crossings: readonly FerryJourney[],
  colorHex: string,
  t: Translate,
  row: LegendRowFn
): JSX.Element[] {
  return buildTerminalRideLegendRows(crossings, colorHex, t, row, FERRY_OVERLAY.legend);
}

export function useFerryOverlay(
  wanted: boolean,
  onGlobe: boolean,
  t: Translate
): TerminalRideOverlay {
  return useTerminalRideOverlay(FERRY_OVERLAY, wanted, onGlobe, t);
}
