import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { busPaths, type BusPathDatum, type TerminalRideLine } from "../../Trips/tripBusLayer";
import { RAIL_PATH_GLOBE_ALTITUDE_M } from "../../layers/railPathsLayer";
import { buildStationLabelLayers, type StationLabelSource } from "../../layers/stationLabelsLayer";
import type { LabelsMode } from "../../map/labelPriority";
import { hexToRgb } from "../../../lib/domainColor";
import { legendRow, type LegendRowFn } from "./allTabLegendRows";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { useDomainVisible } from "../../../hooks/useDomainVisible";
import { useMapLabelsModeStore } from "../../../store/mapLabelsModeStore";
import { logger } from "../../../lib/logger";

type Translate = (key: string) => string;

/** Same widths as rail's: a drawn line firm, the chord between terminals thinner. */
const WIDTH_PX = { drawn: 3, chord: 2 } as const;
/** The chord is drawn fainter, so a straight line never passes for the way taken. */
const CHORD_ALPHA = 170;

/**
 * The line of a ride between two terminals on the "Alle" map — a bus ride
 * (forgejo#180) or a ferry crossing: its stored line where there is one (a
 * routed road, a hand-drawn sea lane), else the chord between the two
 * terminals (`busPaths`, the trip map's own rule, so the two maps cannot draw
 * a ride differently). The colour is the domain colour store's value, and the
 * legend is built from the same value and the same paths, so a repainted
 * domain shows the new colour on the line and in the key together, and the key
 * never names a kind of line the map does not draw. Lifted on the globe like
 * rail, or it z-fights with the sphere.
 *
 * The terminals' names (forgejo#320) come from the same rides in the same
 * colour, revealed by the map's `labelsMode` like the airport names.
 */
export function buildTerminalRideMapLayers(
  rides: readonly (TerminalRideLine & StationLabelSource)[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix: string,
  labelsMode: LabelsMode = "important"
): Layer[] {
  const data = busPaths(rides);
  if (data.length === 0) return [];
  const color = hexToRgb(colorHex);
  const [r, g, b] = color;
  const altitude = onGlobe ? RAIL_PATH_GLOBE_ALTITUDE_M : 0;
  return [
    new PathLayer<BusPathDatum>({
      id: `${idPrefix}-paths`,
      data,
      getPath: (d) =>
        altitude === 0
          ? d.path
          : d.path.map(([lon, lat]) => [lon, lat, altitude] as [number, number, number]),
      getColor: (d) => [r, g, b, d.routed ? 255 : CHORD_ALPHA],
      getWidth: (d) => (d.routed ? WIDTH_PX.drawn : WIDTH_PX.chord),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
      updateTriggers: { getColor: colorHex, getPath: altitude },
    }),
    ...buildStationLabelLayers(rides, { color, labelsMode, idPrefix, onGlobe }),
  ];
}

/** The legend's words and row keys for one domain's two kinds of line. */
export interface TerminalRideLegendKeys {
  /** The label when only drawn lines are on the map ("Bus"). */
  only: string;
  /** The drawn line's label when chords are on the map too. */
  drawn: string;
  /** The chord's label ("Luftlinie"). */
  straight: string;
  drawnRow: string;
  straightRow: string;
}

/** One key per kind of line actually on the map. */
export function buildTerminalRideLegendRows(
  rides: readonly TerminalRideLine[],
  colorHex: string,
  t: Translate,
  row: LegendRowFn,
  keys: TerminalRideLegendKeys
): JSX.Element[] {
  const paths = busPaths(rides);
  const [r, g, b] = hexToRgb(colorHex);
  const rows: JSX.Element[] = [];
  const hasDrawn = paths.some((p) => p.routed);
  const hasChord = paths.some((p) => !p.routed);
  // "Luftlinie" is said only when a chord is actually drawn. A map of drawn
  // lines alone is just the domain; the two kinds are told apart only when
  // both are on the map.
  if (hasDrawn) {
    rows.push(row(`rgb(${r},${g},${b})`, t(hasChord ? keys.drawn : keys.only), keys.drawnRow));
  }
  if (hasChord) {
    const faint = `rgba(${r},${g},${b},${(CHORD_ALPHA / 255).toFixed(2)})`;
    rows.push(row(faint, t(keys.straight), keys.straightRow));
  }
  return rows;
}

/**
 * Every ride the map draws, for one year or all. `enabled` gates the FETCH,
 * not just the drawing — a domain behind the beta switch or switched off by
 * the user never reaches the network. A failed load is logged and drawn as
 * nothing; the logbook page is where it is said out loud.
 */
export function useDashboardRides<R extends TerminalRideLine>(
  enabled: boolean,
  year: number | null,
  load: (query: { year?: number }) => Promise<R[]>,
  what: string
): R[] {
  const [rides, setRides] = useState<R[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRides([]);
      return;
    }
    let cancelled = false;
    void load(year === null ? {} : { year })
      .then((all) => {
        if (!cancelled) setRides(all);
      })
      .catch((err: unknown) => {
        logger.error(`useDashboardRides: failed to load ${what}`, err);
        if (!cancelled) setRides([]);
      });
    return () => {
      cancelled = true;
    };
    // `load` is a module-level api method; the fetch follows the gate and the year.
  }, [enabled, year]);
  return rides;
}

export interface TerminalRideOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
}

export interface TerminalRideOverlaySpec<R extends TerminalRideLine & StationLabelSource> {
  domain: "bus" | "ferry";
  idPrefix: string;
  legend: TerminalRideLegendKeys;
  load: (query: { year?: number }) => Promise<R[]>;
}

/**
 * One domain's layer of the "Alle" map as one hook. `wanted` is the map's own
 * condition (the filter row, the overlay view); the domain gate — its beta
 * switch AND the user's domain — is added here, so a hidden domain never
 * reaches the network.
 */
export function useTerminalRideOverlay<R extends TerminalRideLine & StationLabelSource>(
  spec: TerminalRideOverlaySpec<R>,
  wanted: boolean,
  onGlobe: boolean,
  t: Translate
): TerminalRideOverlay {
  const show = useDomainVisible(spec.domain) && wanted;
  const year = useDashboardFilterStore((s) => s.year);
  const rides = useDashboardRides(show, year, spec.load, spec.domain);
  const { colorOf } = useDomainColors();
  const color = colorOf(spec.domain);
  const labelsMode = useMapLabelsModeStore((s) => s.mode);
  const drawn = show ? rides : EMPTY;
  const layers = useMemo(
    () => buildTerminalRideMapLayers(drawn, color, onGlobe, spec.idPrefix, labelsMode),
    [drawn, color, onGlobe, spec.idPrefix, labelsMode]
  );
  return {
    layers,
    legendRows: buildTerminalRideLegendRows(drawn, color, t, legendRow, spec.legend),
  };
}

const EMPTY: readonly (TerminalRideLine & StationLabelSource)[] = [];
