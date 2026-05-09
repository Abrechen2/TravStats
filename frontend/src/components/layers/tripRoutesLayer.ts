import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../../types";

// Amber — same highlight as routes mode
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
const DIM_ALPHA = 18;
// Same dot color as routes mode
const DOT_RGB: [number, number, number] = [240, 169, 71];

function hexToRgba(hex: string, alpha = 200): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

interface ArcData {
  flightId: string;
  sourcePosition: [number, number];
  targetPosition: [number, number];
  // Color is pre-computed so deck.gl detects data change on re-render
  color: [number, number, number, number];
  width: number;
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
  selectedIds: string[] = [],
  onAirportClick?: (iata: string, lon: number, lat: number) => void
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

  // Pre-compute colors and widths in the data — ensures deck.gl sees a real data change
  // whenever selectedIds or activeTripId changes, guaranteeing a full layer re-render.
  const arcData: ArcData[] = validFlights.map((f) => {
    const isSelected = hasSelection && selectedSet.has(f.id);
    const isActive = !activeTripId || f.tripId === activeTripId;

    let color: [number, number, number, number];
    if (isSelected) {
      color = HIGHLIGHT_COLOR;
    } else {
      const tripColor = f.tripId
        ? (tripColorMap.get(f.tripId) ?? ([100, 100, 120, 200] as [number, number, number, number]))
        : ([100, 100, 120, 100] as [number, number, number, number]);
      const baseColor = isActive ? tripColor : dimmedTripColor;
      color = hasSelection
        ? ([baseColor[0], baseColor[1], baseColor[2], DIM_ALPHA] as [
            number,
            number,
            number,
            number,
          ])
        : baseColor;
    }

    const width = isSelected ? 5 : isActive ? 3 : 2;

    return {
      flightId: f.id,
      sourcePosition: [f.depLon!, f.depLat!],
      targetPosition: [f.arrLon!, f.arrLat!],
      color,
      width,
    };
  });

  // Airport markers: only for the active trip (or all trip flights if none highlighted)
  const airportMap = new Map<string, PointData>();
  for (const f of validFlights) {
    if (activeTripId && f.tripId !== activeTripId) continue;
    if (!f.tripId) continue; // only show airports for trip-assigned flights
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
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => d.color,
    getTargetColor: (d) => d.color,
    getWidth: (d) => d.width,
    getHeight: 0.3,
    widthMinPixels: 1,
    pickable: true,
    onClick: ({ object }) => {
      if (object?.flightId) onFlightClick?.(object.flightId);
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
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
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
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
    parameters: { depthCompare: "always" as const },
  });

  return [arcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}
