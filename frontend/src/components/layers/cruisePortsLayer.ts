import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";

interface PortDatum {
  position: [number, number];
  portId: number;
  name: string;
  /**
   * Short label rendered on the marker — UN/LOCODE if available
   * (5-letter international port code, e.g. "DEHAM"), falling back
   * to the full port name. Mirrors airport markers showing IATA codes.
   */
  shortLabel: string;
  visits: number;
  /** ISO date of the most recent stop at this port (max of
   *  stop.arrivalTime across cruises). Surfaced in the hover tooltip. */
  lastVisit?: string;
}

// Match the airport `routes-dot` radius (meters) so flat-map ports
// read as the same visual weight as airport markers. Halo ring +
// solid centre + label mirror the airport stack in routesLayer.ts.
const PORT_DOT_RADIUS_M = 2200;
const PORT_RING_RADIUS_M = 6000;
const PORT_RGB: [number, number, number] = [56, 189, 248]; // sky-400

/**
 * Match the airport-label zoom gate from routesLayer
 * (LABEL_VISIBILITY_MIN_ZOOM). Below this zoom the dots stay visible
 * but the UN/LOCODE labels are hidden — at world view dozens of
 * 5-letter codes overlap into noise.
 */
const PORT_LABEL_VISIBILITY_MIN_ZOOM = 4;

/**
 * Build a stack of layers (halo ring, solid dot, label) for unique
 * ports visited across all cruises. At-sea stops and stops without a
 * resolved port are ignored.
 *
 * `zoom` gates the label layer visibility — same threshold as airport
 * IATA labels (LABEL_VISIBILITY_MIN_ZOOM in routesLayer). Defaults to
 * "always visible" so legacy callers without zoom plumbing don't break.
 *
 * Returns `null` when no qualifying ports exist.
 */
export function createCruisePortsLayer(
  cruises: Cruise[],
  zoom: number = PORT_LABEL_VISIBILITY_MIN_ZOOM,
): Layer[] | null {
  const byPort = new Map<number, PortDatum>();
  for (const cruise of cruises) {
    for (const stop of cruise.stops) {
      if (stop.isAtSea || !stop.port) continue;
      const stopDate = stop.arrivalTime ?? stop.departureTime ?? undefined;
      const existing = byPort.get(stop.port.id);
      if (existing) {
        existing.visits += 1;
        if (stopDate && (!existing.lastVisit || stopDate > existing.lastVisit)) {
          existing.lastVisit = stopDate;
        }
      } else {
        byPort.set(stop.port.id, {
          position: [stop.port.lon, stop.port.lat],
          portId: stop.port.id,
          name: stop.port.name,
          shortLabel: stop.port.unlocode ?? stop.port.name,
          visits: 1,
          lastVisit: stopDate,
        });
      }
    }
  }
  const data = Array.from(byPort.values());
  if (data.length === 0) return null;

  const ringLayer = new ScatterplotLayer<PortDatum>({
    id: "cruise-ports-ring",
    data,
    getPosition: (d) => d.position,
    getRadius: PORT_RING_RADIUS_M,
    radiusMinPixels: 7,
    radiusMaxPixels: 14,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...PORT_RGB, 80] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 1,
    pickable: false,
  });

  const dotLayer = new ScatterplotLayer<PortDatum>({
    id: "cruise-ports",
    data,
    getPosition: (d) => d.position,
    getRadius: PORT_DOT_RADIUS_M,
    // Cap the marker so it stays a recognisable dot at every zoom —
    // sub-pixel meters at low zoom collapse to just the white stroke
    // (visible "clipping"), and at very high zoom the meter radius
    // would balloon to cover the entire port city.
    radiusMinPixels: 4,
    radiusMaxPixels: 8,
    getFillColor: [...PORT_RGB, 220] as [number, number, number, number],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });

  const labelsVisible = zoom >= PORT_LABEL_VISIBILITY_MIN_ZOOM;
  const labelLayer = new TextLayer<PortDatum>({
    id: "cruise-ports-labels",
    data,
    getPosition: (d) => d.position,
    getText: (d) => d.shortLabel,
    getColor: [241, 245, 249, 235],
    getSize: 11,
    fontFamily: "Inter, sans-serif",
    fontWeight: 700,
    background: true,
    backgroundPadding: [4, 2],
    getBackgroundColor: [13, 17, 23, 200],
    getBorderColor: [...PORT_RGB, 200] as [number, number, number, number],
    getBorderWidth: 1,
    getPixelOffset: [0, -16],
    sizeUnits: "pixels",
    pickable: true,
    billboard: true,
    visible: labelsVisible,
  });

  return [ringLayer, dotLayer, labelLayer];
}
