import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { busPaths, type BusPathDatum } from "../../Trips/tripBusLayer";
import { RAIL_PATH_GLOBE_ALTITUDE_M } from "../../layers/railPathsLayer";
import { hexToRgb } from "../../../lib/domainColor";
import { legendRow, type LegendRowFn } from "./allTabLegendRows";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { busApi } from "../../../lib/api/bus";
import { useBusVisible } from "../../../hooks/useBusVisible";
import { logger } from "../../../lib/logger";
import type { BusJourney } from "../../../types/bus";

type Translate = (key: string) => string;

/** Same widths as rail's: a road line firm, the chord between terminals thinner. */
const WIDTH_PX = { road: 3, chord: 2 } as const;
/** The chord is drawn fainter, so a straight line never passes for the road taken. */
const CHORD_ALPHA = 170;

/**
 * The bus layer of the "Alle" map (forgejo#180): one line per ride — its
 * frozen road geometry where one was fetched, else the chord between the two
 * terminals (`busPaths`, the trip map's own rule, so the two maps cannot draw
 * a ride differently). The colour is the domain colour store's value, and the
 * legend is built from the same value and the same paths, so a repainted bus
 * shows the new colour on the line and in the key together, and the key never
 * names a kind of line the map does not draw. Lifted on the globe like rail,
 * or it z-fights with the sphere.
 */
export function buildBusMapLayers(
  rides: readonly BusJourney[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix = "dashboard-bus"
): Layer[] {
  const data = busPaths(rides);
  if (data.length === 0) return [];
  const [r, g, b] = hexToRgb(colorHex);
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
      getWidth: (d) => (d.routed ? WIDTH_PX.road : WIDTH_PX.chord),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
      updateTriggers: { getColor: colorHex, getPath: altitude },
    }),
  ];
}

/** One key per kind of line actually on the map. */
export function buildBusLegendRows(
  rides: readonly BusJourney[],
  colorHex: string,
  t: Translate,
  row: LegendRowFn
): JSX.Element[] {
  const paths = busPaths(rides);
  const [r, g, b] = hexToRgb(colorHex);
  const rows: JSX.Element[] = [];
  if (paths.some((p) => p.routed)) {
    rows.push(row(`rgb(${r},${g},${b})`, t("dashboard:legend.busRoad"), "bus-road"));
  }
  if (paths.some((p) => !p.routed)) {
    const faint = `rgba(${r},${g},${b},${(CHORD_ALPHA / 255).toFixed(2)})`;
    rows.push(row(faint, t("dashboard:legend.busStraight"), "bus-straight"));
  }
  return rows;
}

/**
 * Every ride the map draws, for one year or all. `enabled` gates the FETCH,
 * not just the drawing — a domain behind the beta switch or switched off by
 * the user never reaches the network. A failed load is logged and drawn as
 * nothing; the logbook page is where it is said out loud.
 */
export function useDashboardBus(enabled: boolean, year: number | null): BusJourney[] {
  const [rides, setRides] = useState<BusJourney[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRides([]);
      return;
    }
    let cancelled = false;
    void busApi
      .listAll(year === null ? {} : { year })
      .then((all) => {
        if (!cancelled) setRides(all);
      })
      .catch((err: unknown) => {
        logger.error("useDashboardBus: failed to load bus rides", err);
        if (!cancelled) setRides([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, year]);
  return rides;
}

export interface BusOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
}

/**
 * The bus layer of the "Alle" map as one hook, so that tab gains a line, not a
 * block. `wanted` is the map's own condition (the filter row, the overlay
 * view); the domain gate — the `busDomain` beta switch AND the user's domain —
 * is added here, so a hidden domain never reaches the network.
 */
export function useBusOverlay(wanted: boolean, onGlobe: boolean, t: Translate): BusOverlay {
  const show = useBusVisible() && wanted;
  const year = useDashboardFilterStore((s) => s.year);
  const rides = useDashboardBus(show, year);
  const { colorOf } = useDomainColors();
  const color = colorOf("bus");
  const drawn = show ? rides : EMPTY;
  const layers = useMemo(
    () => buildBusMapLayers(drawn, color, onGlobe, "all-bus"),
    [drawn, color, onGlobe]
  );
  return { layers, legendRows: buildBusLegendRows(drawn, color, t, legendRow) };
}

const EMPTY: readonly BusJourney[] = [];
