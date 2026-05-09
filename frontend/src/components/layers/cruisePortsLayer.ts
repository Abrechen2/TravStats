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
}

// Match the airport `routes-dot` radius (meters) so flat-map ports
// read as the same visual weight as airport markers. Halo ring +
// solid centre + label mirror the airport stack in routesLayer.ts.
const PORT_DOT_RADIUS_M = 2200;
const PORT_RING_RADIUS_M = 6000;
const PORT_RGB: [number, number, number] = [56, 189, 248]; // sky-400

/**
 * Build a stack of layers (halo ring, solid dot, label) for unique
 * ports visited across all cruises. At-sea stops and stops without a
 * resolved port are ignored.
 *
 * Returns `null` when no qualifying ports exist.
 */
export function createCruisePortsLayer(cruises: Cruise[]): Layer[] | null {
  const byPort = new Map<number, PortDatum>();
  for (const cruise of cruises) {
    for (const stop of cruise.stops) {
      if (stop.isAtSea || !stop.port) continue;
      const existing = byPort.get(stop.port.id);
      if (existing) {
        existing.visits += 1;
      } else {
        byPort.set(stop.port.id, {
          position: [stop.port.lon, stop.port.lat],
          portId: stop.port.id,
          name: stop.port.name,
          shortLabel: stop.port.unlocode ?? stop.port.name,
          visits: 1,
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
  });

  return [ringLayer, dotLayer, labelLayer];
}
