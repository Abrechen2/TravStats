import { useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import {
  buildRailDeckLayers,
  buildRailPaths,
  buildRailStations,
  RAIL_PATH_GLOBE_ALTITUDE_M,
  type RailPathSource,
  type RailPathSourceKind,
} from "../../layers/railPathsLayer";
import { buildStationLabelLayers, type StationLabelGroup } from "../../layers/stationLabelsLayer";
import type { LabelsMode } from "../../map/labelPriority";
import { hexToRgb } from "../../../lib/domainColor";
import { legendRow, type LegendRowFn } from "./allTabLegendRows";
import { useDashboardRail } from "../../../hooks/useDashboardRail";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { useOverlayAppearance } from "../../../store/overlayAppearanceStore";
import { useMapLabelsModeStore } from "../../../store/mapLabelsModeStore";

type Translate = (key: string) => string;

/** The map panel's section for this domain (forgejo#198). */
export interface RailMapStyle {
  lineWidth: number;
  stationSize: number;
  /** The map's label reveal, which the station names follow (forgejo#320). Absent = "important". */
  labelsMode?: LabelsMode;
}

const DEFAULT_RAIL_STYLE: RailMapStyle = { lineWidth: 1, stationSize: 1, labelsMode: "important" };

/**
 * The rail layer and its legend for the dashboard maps — the rail tab and the
 * "Alle" map share it, so the two can never draw rail differently.
 *
 * The colour comes in as the domain colour store's value, resolved by the
 * caller; the legend swatch is built from the SAME value, so a user who
 * repaints rail sees the new colour on the line and in the key together.
 *
 * `style` is the map panel's rail section (forgejo#198) — line width and
 * station size, read from `useOverlayAppearance` by every caller — and the
 * panel's label reveal, which the station names follow (forgejo#320). The
 * names are built from the same journeys as the lines and painted in the same
 * colour, so a filtered-out domain names no station.
 */
export function buildRailMapLayers(
  journeys: readonly RailPathSource[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix = "dashboard-rail",
  style: RailMapStyle = DEFAULT_RAIL_STYLE
): Layer[] {
  const color = hexToRgb(colorHex);
  const lines = buildRailDeckLayers(buildRailPaths(journeys), buildRailStations(journeys), {
    color,
    altitudeM: onGlobe ? RAIL_PATH_GLOBE_ALTITUDE_M : 0,
    idPrefix,
    widthScale: style.lineWidth,
    stationSize: style.stationSize,
  });
  const labels = buildStationLabelLayers([{ rides: journeys, color }], {
    labelsMode: style.labelsMode ?? "important",
    idPrefix,
    onGlobe,
  });
  return [...lines, ...labels];
}

/** The rail style the user set in the map panel, memoised for a layer `useMemo`. */
export function useRailMapStyle(): RailMapStyle {
  const { railLineWidth, railStationSize } = useOverlayAppearance();
  const labelsMode = useMapLabelsModeStore((s) => s.mode);
  return useMemo(
    () => ({ lineWidth: railLineWidth, stationSize: railStationSize, labelsMode }),
    [railLineWidth, railStationSize, labelsMode]
  );
}

/**
 * One legend key per actual line source, so a translation key never claims a
 * different source than the one that drew the line — "(Transitous)" for
 * every firmly-drawn line used to cover BRouter's offline demo routing and a
 * self-hosted OpenRailRouting too, neither of which is Transitous.
 */
const SOURCE_KEYS: Record<RailPathSourceKind, string> = {
  transitous: "dashboard:legend.railTraced",
  openrailrouting: "dashboard:legend.railRouted",
  brouter: "dashboard:legend.railBrouter",
  manual: "dashboard:legend.railManual",
  straight: "dashboard:legend.railStraight",
};

/**
 * One row per kind of line actually on the map — Transitous, OpenRailRouting,
 * BRouter and the straight-line chord are different claims, so each gets its
 * own key, and only the ones actually drawn appear.
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
  for (const source of [
    "transitous",
    "openrailrouting",
    "brouter",
    "manual",
    "straight",
  ] as const) {
    if (!paths.some((p) => p.source === source)) continue;
    const rgba = source === "straight" ? `rgba(${r},${g},${b},0.67)` : `rgb(${r},${g},${b})`;
    rows.push(legendRow(rgba, t(SOURCE_KEYS[source]), `rail-${source}`));
  }
  return rows;
}

export interface RailOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
  /** The drawn journeys and their colour, for the map's ONE station-label pass. */
  stations: StationLabelGroup;
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
  const style = useRailMapStyle();
  const drawn = show ? journeys : EMPTY;
  // The station names are left to the map's single pass across all three
  // ground domains (`useTransportOverlays`), so they are not drawn here.
  const layers = useMemo(
    () => buildRailMapLayers(drawn, color, onGlobe, "all-rail", { ...style, labelsMode: "off" }),
    [drawn, color, onGlobe, style]
  );
  const stations = useMemo(() => ({ rides: drawn, color: hexToRgb(color) }), [drawn, color]);
  return { layers, legendRows: buildRailLegendRows(drawn, color, t, legendRow), stations };
}

const EMPTY: readonly RailPathSource[] = [];
