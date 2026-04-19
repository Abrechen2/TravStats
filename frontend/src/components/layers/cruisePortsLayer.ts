import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";

interface PortDatum {
  position: [number, number];
  portId: number;
  name: string;
  visits: number;
}

/**
 * Build a ScatterplotLayer of unique ports visited across all cruises.
 * Visit count drives the dot radius so frequently-called ports stand
 * out. At-sea stops and stops without a resolved port are ignored.
 *
 * Returns `null` when no qualifying ports exist.
 */
export function createCruisePortsLayer(cruises: Cruise[]): Layer | null {
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
          visits: 1,
        });
      }
    }
  }
  const data = Array.from(byPort.values());
  if (data.length === 0) return null;

  return new ScatterplotLayer<PortDatum>({
    id: "cruise-ports",
    data,
    getPosition: (d) => d.position,
    getRadius: (d) => 4 + Math.min(d.visits, 10) * 0.6,
    radiusUnits: "pixels",
    getFillColor: [56, 189, 248, 220],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });
}
