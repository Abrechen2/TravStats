import { useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import {
  buildRailDeckLayers,
  buildRailPaths,
  buildRailStations,
  RAIL_PATH_GLOBE_ALTITUDE_M,
  type RailPathSource,
} from "../../layers/railPathsLayer";
import { hexToRgb } from "../../../lib/domainColor";
import { legendRow, type LegendRowFn } from "./allTabLegendRows";
import { useDashboardRail } from "../../../hooks/useDashboardRail";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";

type Translate = (key: string) => string;

/**
 * The rail layer and its legend for the dashboard maps — the rail tab and the
 * "Alle" map share it, so the two can never draw rail differently.
 *
 * The colour comes in as the domain colour store's value, resolved by the
 * caller; the legend swatch is built from the SAME value, so a user who
 * repaints rail sees the new colour on the line and in the key together.
 */
export function buildRailMapLayers(
  journeys: readonly RailPathSource[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix = "dashboard-rail"
): Layer[] {
  return buildRailDeckLayers(buildRailPaths(journeys), buildRailStations(journeys), {
    color: hexToRgb(colorHex),
    altitudeM: onGlobe ? RAIL_PATH_GLOBE_ALTITUDE_M : 0,
    idPrefix,
  });
}

/**
 * One row per kind of line actually on the map: the traced line and the
 * straight line are different claims, so the key names both, and only the ones
 * that are drawn.
 */
export function buildRailLegendRows(
  journeys: readonly RailPathSource[],
  colorHex: string,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  const paths = buildRailPaths(journeys);
  const rows: JSX.Element[] = [];
  const [r, g, b] = hexToRgb(colorHex);
  if (paths.some((p) => p.traced)) {
    rows.push(legendRow(`rgb(${r},${g},${b})`, t("dashboard:legend.railTraced"), "rail-traced"));
  }
  if (paths.some((p) => !p.traced)) {
    rows.push(
      legendRow(`rgba(${r},${g},${b},0.67)`, t("dashboard:legend.railStraight"), "rail-straight")
    );
  }
  return rows;
}

export interface RailOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
}

/**
 * The rail layer of the "Alle" map, as one hook so that 800-line tab gains a
 * line rather than a block. `show` must already carry every gate — the beta
 * switch, the user's domain, and the map's own domain chip — because it gates
 * the fetch as well as the drawing.
 */
export function useRailOverlay(show: boolean, onGlobe: boolean, t: Translate): RailOverlay {
  const year = useDashboardFilterStore((s) => s.year);
  const { journeys } = useDashboardRail(show, year);
  const { colorOf } = useDomainColors();
  const color = colorOf("rail");
  const drawn = show ? journeys : EMPTY;
  const layers = useMemo(
    () => buildRailMapLayers(drawn, color, onGlobe, "all-rail"),
    [drawn, color, onGlobe]
  );
  return { layers, legendRows: buildRailLegendRows(drawn, color, t, legendRow) };
}

const EMPTY: readonly RailPathSource[] = [];
