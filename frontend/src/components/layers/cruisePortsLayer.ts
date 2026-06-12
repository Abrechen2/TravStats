import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise, Port } from "../../types";

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
// Cruise domain hex per BRAND.md §3 (--domain-cruise = #6fa0d6 / rgb(111,160,214)).
// Was sky-400 [56, 189, 248] which is a different blue and not in the brand
// palette — port markers are the primary on-map signifier of the cruise
// domain so they have to render in the canonical domain colour.
const PORT_RGB: [number, number, number] = [111, 160, 214];

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
  const recordVisit = (port: Port, date: string | undefined): void => {
    const existing = byPort.get(port.id);
    if (existing) {
      existing.visits += 1;
      if (date && (!existing.lastVisit || date > existing.lastVisit)) {
        existing.lastVisit = date;
      }
    } else {
      byPort.set(port.id, {
        position: [port.lon, port.lat],
        portId: port.id,
        name: port.name,
        shortLabel: port.unlocode ?? port.name,
        visits: 1,
        lastVisit: date,
      });
    }
  };
  for (const cruise of cruises) {
    const firstPortCall = cruise.stops.find((s) => !s.isAtSea && s.port);
    const lastPortCall = [...cruise.stops].reverse().find((s) => !s.isAtSea && s.port);
    // Departure/arrival ports get markers too — skipped only when they
    // duplicate the first/last port-call stop (counted there instead).
    if (cruise.departurePort && cruise.departurePort.id !== firstPortCall?.port?.id) {
      recordVisit(cruise.departurePort, cruise.startDate ?? undefined);
    }
    for (const stop of cruise.stops) {
      if (stop.isAtSea || !stop.port) continue;
      recordVisit(stop.port, stop.arrivalTime ?? stop.departureTime ?? undefined);
    }
    if (cruise.arrivalPort && cruise.arrivalPort.id !== lastPortCall?.port?.id) {
      recordVisit(cruise.arrivalPort, cruise.endDate ?? undefined);
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
