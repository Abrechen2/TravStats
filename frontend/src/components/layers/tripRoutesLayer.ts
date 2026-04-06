import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../../types";

// Amber — same highlight as routes mode
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
const DIM_ALPHA = 18;
// Same dot color as routes mode
const DOT_RGB: [number, number, number] = [232, 160, 69];

function hexToRgba(hex: string, alpha = 200): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

interface ArcData {
  flight: Flight;
  baseColor: [number, number, number, number];
  flightId: string;
}

interface PointData {
  position: [number, number];
  iata: string;
}

export function createTripRoutesLayer(
  flights: Flight[],
  trips: Array<{ id: string; color: string }>,
  activeTripId?: string | null,
  onFlightClick?: (flightId: string) => void,
  selectedIds: string[] = []
): Layer[] {
  const tripColorMap = new Map(trips.map((t) => [t.id, hexToRgba(t.color)]));
  const dimmedTripColor: [number, number, number, number] = [80, 80, 90, 40];
  const hasSelection = selectedIds.length > 0;
  const selectedSet = new Set(selectedIds);

  const validFlights = flights.filter(
    (f) =>
      f.depLat != null &&
      f.depLat !== 0 &&
      f.depLon != null &&
      f.depLon !== 0 &&
      f.arrLat != null &&
      f.arrLat !== 0 &&
      f.arrLon != null &&
      f.arrLon !== 0
  );

  const arcData: ArcData[] = validFlights.map((f) => {
    const tripColor = f.tripId
      ? (tripColorMap.get(f.tripId) ?? [100, 100, 120, 200])
      : [100, 100, 120, 100];
    const baseColor =
      activeTripId && f.tripId !== activeTripId
        ? dimmedTripColor
        : (tripColor as [number, number, number, number]);
    return { flight: f, baseColor, flightId: f.id };
  });

  // Airport markers: only for the active trip (or all trips if none highlighted)
  const airportMap = new Map<string, PointData>();
  for (const f of validFlights) {
    if (activeTripId && f.tripId !== activeTripId) continue;
    if (f.depIata) {
      airportMap.set(f.depIata, { position: [f.depLon!, f.depLat!], iata: f.depIata });
    }
    if (f.arrIata) {
      airportMap.set(f.arrIata, { position: [f.arrLon!, f.arrLat!], iata: f.arrIata });
    }
  }
  const points = [...airportMap.values()];
  const airportOpacity = hasSelection ? 0.15 : 1;

  const arcLayer = new ArcLayer<ArcData>({
    id: "trip-routes-arc",
    data: arcData,
    getSourcePosition: (d) => [d.flight.depLon!, d.flight.depLat!],
    getTargetPosition: (d) => [d.flight.arrLon!, d.flight.arrLat!],
    getSourceColor: (d) => {
      if (!hasSelection) return d.baseColor;
      if (selectedSet.has(d.flightId)) return HIGHLIGHT_COLOR;
      return [d.baseColor[0], d.baseColor[1], d.baseColor[2], DIM_ALPHA] as [
        number,
        number,
        number,
        number,
      ];
    },
    getTargetColor: (d) => {
      if (!hasSelection) return d.baseColor;
      if (selectedSet.has(d.flightId)) return HIGHLIGHT_COLOR;
      return [d.baseColor[0], d.baseColor[1], d.baseColor[2], DIM_ALPHA] as [
        number,
        number,
        number,
        number,
      ];
    },
    getWidth: (d) => {
      const isActive = activeTripId ? d.flight.tripId === activeTripId : true;
      const base = isActive ? 3 : 2;
      if (!hasSelection) return base;
      return selectedSet.has(d.flightId) ? Math.max(base * 2, 5) : base;
    },
    getHeight: 0.3,
    widthMinPixels: 1,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }) => {
          if (object?.flightId) onFlightClick(object.flightId);
        }
      : undefined,
    updateTriggers: {
      getSourceColor: [selectedIds, activeTripId],
      getTargetColor: [selectedIds, activeTripId],
      getWidth: [selectedIds, activeTripId],
    },
  });

  const ringInnerLayer = new ScatterplotLayer<PointData>({
    id: "trip-routes-ring-inner",
    data: points,
    getPosition: (d) => d.position,
    getRadius: 4000,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...DOT_RGB, 180] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 1.2,
    opacity: airportOpacity,
    pickable: false,
  });

  const ringOuterLayer = new ScatterplotLayer<PointData>({
    id: "trip-routes-ring-outer",
    data: points,
    getPosition: (d) => d.position,
    getRadius: 7200,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...DOT_RGB, 60] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 0.8,
    opacity: airportOpacity,
    pickable: false,
  });

  const dotLayer = new ScatterplotLayer<PointData>({
    id: "trip-routes-dot",
    data: points,
    getPosition: (d) => d.position,
    getRadius: 2200,
    getFillColor: [...DOT_RGB, 220] as [number, number, number, number],
    stroked: false,
    opacity: airportOpacity,
    pickable: false,
  });

  const labelLayer = new TextLayer<PointData>({
    id: "trip-routes-labels",
    data: points,
    getPosition: (d) => d.position,
    getText: (d) => d.iata,
    getSize: 11,
    getColor: [230, 230, 230, 220] as [number, number, number, number],
    getBackgroundColor: [13, 17, 23, 170] as [number, number, number, number],
    background: true,
    backgroundPadding: [4, 2, 4, 2],
    fontFamily: '"Inter", system-ui, monospace',
    fontWeight: "bold",
    getPixelOffset: [0, -18],
    billboard: true,
    characterSet: "auto",
    opacity: airportOpacity,
    parameters: { depthCompare: "always" as const },
  });

  return [arcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}
