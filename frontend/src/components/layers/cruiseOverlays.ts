import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types/cruise";
import type { LabelsMode } from "../map/labelPriority";
import type { CruiseColorConfig } from "../../lib/cruiseColor";
import {
  withSharedArcs,
  createCruiseArcsLayer,
  createCruiseArrowsLayer,
  type CruiseGeometryMap,
} from "./cruiseArcsLayer";
import { createCruisePortsLayer } from "./cruisePortsLayer";

interface CruiseOverlayAppearance {
  zoom: number;
  arcWidthScale: number;
  arrowSizeScale: number;
  colorConfig: CruiseColorConfig;
  portColor?: [number, number, number];
  portSizeScale: number;
  labelsMode: LabelsMode;
}

/**
 * The flat map's cruise layers in two groups: "below" (arcs and arrows render
 * beneath flight arcs and airport markers) and "above" (port halo/dot/label sit
 * on top of everything). Without the split, cruise paths drew over airport
 * dots at every crossing and visually clipped them.
 *
 * The arcs splines the coarse waypoints from /cruises/:id/geometry; until the
 * fetch resolves for a cruise, each leg falls back to a 2-vertex chord. They
 * are built once and shared by the arc and the arrow layer (PERF-23).
 */
export function buildCruiseOverlays(
  cruises: Cruise[],
  geometry: CruiseGeometryMap,
  selectedCruiseId: string | null,
  onCruiseClick: (cruise: Cruise) => void,
  appearance: CruiseOverlayAppearance
): { below: Layer[]; above: Layer[] } {
  const { portColor, portSizeScale, labelsMode, ...arcAppearance } = appearance;
  const shared = withSharedArcs(cruises, geometry, arcAppearance);
  const arcs = createCruiseArcsLayer(
    cruises,
    geometry,
    selectedCruiseId,
    (cruiseId: string) => {
      const cruise = cruises.find((c) => c.id === cruiseId);
      if (cruise) onCruiseClick(cruise);
    },
    shared
  );
  const arrows = createCruiseArrowsLayer(cruises, geometry, selectedCruiseId, shared);
  const ports = createCruisePortsLayer(cruises, appearance.zoom, {
    portColor,
    portSizeScale,
    labelsMode,
  });
  return {
    below: [...(arcs !== null ? [arcs] : []), ...(arrows !== null ? [arrows] : [])],
    above: ports ?? [],
  };
}
