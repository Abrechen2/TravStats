import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import type { LegendRowFn } from "./allTabLegendRows";
import { busApi } from "../../../lib/api/bus";
import type { BusJourney } from "../../../types/bus";
import {
  buildTerminalRideLegendRows,
  buildTerminalRideMapLayers,
  useTerminalRideOverlay,
  type TerminalRideOverlay,
  type TerminalRideOverlaySpec,
} from "./terminalRideMapOverlay";

type Translate = (key: string) => string;

/**
 * The bus layer of the "Alle" map (forgejo#180) — the terminal-ride overlay
 * (`terminalRideMapOverlay.tsx`, which ferry uses too) with bus's own words:
 * a stored line is the road the coach took.
 */
const BUS_OVERLAY: TerminalRideOverlaySpec<BusJourney> = {
  domain: "bus",
  idPrefix: "all-bus",
  legend: {
    only: "dashboard:legend.bus",
    drawn: "dashboard:legend.busRoad",
    straight: "dashboard:legend.busStraight",
    drawnRow: "bus-road",
    straightRow: "bus-straight",
  },
  load: (query) => busApi.listAll(query),
};

export function buildBusMapLayers(
  rides: readonly BusJourney[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix = "dashboard-bus"
): Layer[] {
  return buildTerminalRideMapLayers(rides, colorHex, onGlobe, idPrefix);
}

/** One key per kind of line actually on the map. */
export function buildBusLegendRows(
  rides: readonly BusJourney[],
  colorHex: string,
  t: Translate,
  row: LegendRowFn
): JSX.Element[] {
  return buildTerminalRideLegendRows(rides, colorHex, t, row, BUS_OVERLAY.legend);
}

export function useBusOverlay(
  wanted: boolean,
  onGlobe: boolean,
  t: Translate
): TerminalRideOverlay {
  return useTerminalRideOverlay(BUS_OVERLAY, wanted, onGlobe, t);
}
