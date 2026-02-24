import { useEffect, useMemo, useCallback, memo } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { GeoJSONFeature } from "../types";
import { useThemeStore } from "../store/themeStore";
import { escapeHtml } from "../lib/escapeHtml";
import AirportMarkers from "./AirportMarkers";
import "leaflet/dist/leaflet.css";

interface MapProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
}

// Route representation for aggregation
interface AggregatedRoute {
  routeKey: string;
  departureName: string;
  arrivalName: string;
  departureIATA: string;
  arrivalIATA: string;
  count: number;
  segments: [number, number][][];
  flights: GeoJSONFeature[];
  color: string;
}

// Helper function to split lines that cross the antimeridian (dateline)
function splitLineAtAntimeridian(positions: [number, number][]): [number, number][][] {
  if (positions.length < 2) return [positions];

  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [positions[0]];

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];

    // Check if line crosses antimeridian (large longitude jump)
    const lonDiff = Math.abs(curr[1] - prev[1]);

    if (lonDiff > 180) {
      // Line crosses antimeridian - start a new segment
      segments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  }

  // Add the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

// Helper function to create bidirectional route key (FRA-JFK === JFK-FRA)
const createRouteKey = (airportA: string, airportB: string): string => {
  // Sort alphabetically to ensure bidirectional routes are treated as the same
  return airportA < airportB ? `${airportA}-${airportB}` : `${airportB}-${airportA}`;
};

// Calculate dynamic heatmap thresholds based on data distribution
const calculateHeatmapThresholds = (
  counts: number[]
): { q25: number; q50: number; q75: number; max: number } => {
  if (counts.length === 0) return { q25: 1, q50: 2, q75: 3, max: 5 };

  const sorted = [...counts].sort((a, b) => a - b);
  const len = sorted.length;
  const max = sorted[len - 1];
  const min = sorted[0];

  // If all values are the same, create artificial thresholds
  if (max === min) {
    return {
      q25: Math.floor(min * 0.75),
      q50: Math.floor(min * 0.85),
      q75: Math.floor(min * 0.95),
      max: max,
    };
  }

  // Use actual quantiles, but ensure they're distinct
  const q25Index = Math.floor(len * 0.25);
  const q50Index = Math.floor(len * 0.5);
  const q75Index = Math.floor(len * 0.75);

  const q25 = sorted[q25Index] || min;
  let q50 = sorted[q50Index] || min + Math.floor((max - min) * 0.33);
  let q75 = sorted[q75Index] || min + Math.floor((max - min) * 0.66);

  // Ensure thresholds are strictly increasing
  if (q50 <= q25) q50 = q25 + Math.max(1, Math.floor((max - q25) * 0.4));
  if (q75 <= q50) q75 = q50 + Math.max(1, Math.floor((max - q50) * 0.5));

  return { q25, q50, q75, max };
};

// Heatmap color based on dynamic quantiles
const getHeatmapColor = (
  count: number,
  thresholds: { q25: number; q50: number; q75: number }
): string => {
  // Use > instead of >= to ensure better distribution when values are equal
  if (count > thresholds.q75) return "#ef4444"; // red - top 25%
  if (count > thresholds.q50) return "#f59e0b"; // orange - 50-75%
  if (count > thresholds.q25) return "#eab308"; // yellow - 25-50%
  return "#10b981"; // green - bottom 25%
};

const MapUpdater = memo(function MapUpdater({ flights }: { flights: GeoJSONFeature[] }) {
  const map = useMap();

  useEffect(() => {
    if (flights && flights.length > 0) {
      const bounds = flights.reduce((acc, flight) => {
        flight.geometry.coordinates.forEach(([lon, lat]) => {
          if ((lat === 0 && lon === 0) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
          }
          acc.extend([lat, lon]);
        });
        return acc;
      }, L.latLngBounds([]));

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [flights, map]);

  return null;
});

function Map({
  flights = [],
  selectedFlightId,
  onFlightClick,
  minRouteCount = 1,
}: MapProps): JSX.Element {
  const themeStore = useThemeStore();
  const isDarkMode = themeStore?.isDarkMode ?? false;

  // Aggregate flights by route (departure-arrival pair) with dynamic heatmap colors
  const { aggregatedRoutes, heatmapThresholds } = useMemo<{
    aggregatedRoutes: AggregatedRoute[];
    heatmapThresholds: { q25: number; q50: number; q75: number; max: number };
  }>(() => {
    const routeMap: Record<string, AggregatedRoute> = {};

    flights.forEach((flight) => {
      if (!flight?.properties || !flight?.geometry) return;

      const depIATA =
        flight.properties.departureAirport?.iata ||
        flight.properties.departureAirport?.icao ||
        "UNKNOWN";
      const arrIATA =
        flight.properties.arrivalAirport?.iata ||
        flight.properties.arrivalAirport?.icao ||
        "UNKNOWN";

      // Create bidirectional route key (FRA-JFK === JFK-FRA)
      const routeKey = createRouteKey(depIATA, arrIATA);

      if (!routeMap[routeKey]) {
        // Convert coordinates from [lon, lat] to [lat, lon] for Leaflet
        const positions = flight.geometry.coordinates.map(
          ([lon, lat]) => [lat, lon] as [number, number]
        );

        // Validate positions
        const validPositions = positions.filter(
          (pos) =>
            pos &&
            pos.length === 2 &&
            !(pos[0] === 0 && pos[1] === 0) &&
            Number.isFinite(pos[0]) &&
            Number.isFinite(pos[1])
        );

        if (validPositions.length < 2) return;

        // Split at antimeridian
        const segments = splitLineAtAntimeridian(validPositions);

        routeMap[routeKey] = {
          routeKey,
          departureName: flight.properties.departureAirport?.name || depIATA,
          arrivalName: flight.properties.arrivalAirport?.name || arrIATA,
          departureIATA: depIATA,
          arrivalIATA: arrIATA,
          count: 1,
          segments,
          flights: [flight],
          color: "", // Will be set after threshold calculation
        };
      } else {
        // Increment count for existing route
        const route = routeMap[routeKey];
        route.count++;
        route.flights.push(flight);
      }
    });

    // Calculate thresholds based on all route counts
    const allRoutes = Object.values(routeMap);
    const counts = allRoutes.map((r) => r.count);
    const thresholds = calculateHeatmapThresholds(counts);

    // Filter routes by minimum count and assign colors based on thresholds
    const routes = allRoutes.filter((route) => route.count >= minRouteCount);
    routes.forEach((route) => {
      route.color = getHeatmapColor(route.count, thresholds);
    });

    return { aggregatedRoutes: routes, heatmapThresholds: thresholds };
  }, [flights, minRouteCount]);

  // Memoized click handler
  const handleRouteClick = useCallback(
    (route: AggregatedRoute) => {
      // Click on most recent flight in route
      if (route.flights.length > 0 && onFlightClick) {
        const mostRecentFlight = route.flights[route.flights.length - 1];
        onFlightClick(mostRecentFlight.properties.id);
      }
    },
    [onFlightClick]
  );

  return (
    <div className="h-full w-full" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
      <MapContainer
        center={[50, 10]}
        zoom={4}
        minZoom={2}
        worldCopyJump={true}
        preferCanvas={true}
        style={{ height: "100%", width: "100%", touchAction: "pan-x pan-y pinch-zoom" }}
        className="rounded-lg"
      >
        {isDarkMode ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
            noWrap={false}
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            noWrap={false}
          />
        )}

        <MapUpdater flights={flights} />

        {/* Aggregated route paths with heatmap colors */}
        {aggregatedRoutes.map((route: AggregatedRoute) => {
          // Check if any flight in this route is selected
          const isSelected = route.flights.some(
            (flight: GeoJSONFeature) => flight.properties.id === selectedFlightId
          );

          // Render each segment as a separate polyline
          return route.segments.map((segment: [number, number][], index: number) => (
            <Polyline
              key={`${route.routeKey}-${index}`}
              positions={segment}
              pathOptions={{
                color: route.color,
                weight: isSelected ? 5 : 3,
                opacity: isSelected ? 1 : 0.7,
              }}
              eventHandlers={{
                click: () => handleRouteClick(route),
                mouseover: (e: L.LeafletMouseEvent) => {
                  const layer = e.target as L.Polyline;
                  layer.setStyle({
                    weight: 5,
                    opacity: 1,
                  });
                  layer
                    .bindTooltip(
                      `<div style="text-align: center;">
                      <strong>${escapeHtml(route.departureIATA)} ↔ ${escapeHtml(route.arrivalIATA)}</strong><br/>
                      <span>${route.count}x geflogen</span>
                    </div>`,
                      { sticky: true }
                    )
                    .openTooltip();
                },
                mouseout: (e: L.LeafletMouseEvent) => {
                  const layer = e.target as L.Polyline;
                  layer.setStyle({
                    weight: isSelected ? 5 : 3,
                    opacity: isSelected ? 1 : 0.7,
                  });
                  layer.closeTooltip();
                },
              }}
            />
          ));
        })}

        {/* Airport markers with aggregated stats */}
        <AirportMarkers flights={flights} />
      </MapContainer>

      {/* Heatmap Legend */}
      {aggregatedRoutes.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-[var(--bg-surface)] rounded-lg shadow-lg p-3 border border-[var(--color-border)] z-10">
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
            Routenfrequenz
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#10b981" }}></div>
              <span className="text-xs text-[var(--text-muted)]">1-{heatmapThresholds.q25}x</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#eab308" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q25 + 1}-{heatmapThresholds.q50}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#f59e0b" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q50 + 1}-{heatmapThresholds.q75}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#ef4444" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q75 + 1}+ ({heatmapThresholds.max}x max)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export memoized version
export default memo(Map);
