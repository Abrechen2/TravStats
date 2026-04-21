import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise, Port } from "../../../types/cruise";

export interface PortFrequency {
  portId: number;
  port: Port;
  count: number;
}

export function computePortFrequency(cruises: readonly Cruise[]): PortFrequency[] {
  const byPort = new Map<number, PortFrequency>();
  for (const c of cruises) {
    for (const s of c.stops) {
      if (s.isAtSea || s.port === null || s.portId === null) continue;
      const existing = byPort.get(s.portId);
      if (existing) {
        byPort.set(s.portId, { ...existing, count: existing.count + 1 });
      } else {
        byPort.set(s.portId, { portId: s.portId, port: s.port, count: 1 });
      }
    }
  }
  return Array.from(byPort.values());
}

export function buildPortFrequencyLayer(cruises: readonly Cruise[]): Layer {
  const data = computePortFrequency(cruises);
  const max = data.reduce((m, p) => (p.count > m ? p.count : m), 1);
  return new ScatterplotLayer<PortFrequency>({
    id: "port-frequency",
    data,
    getPosition: (d) => [d.port.lon, d.port.lat],
    getRadius: (d) => 4 + 18 * (d.count / max),
    radiusUnits: "pixels",
    getFillColor: [34, 211, 238, 230],
    getLineColor: [0, 0, 0, 180],
    stroked: true,
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    pickable: true,
  });
}
