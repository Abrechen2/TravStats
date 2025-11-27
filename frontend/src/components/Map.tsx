import { useEffect, useMemo, useCallback, memo } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { GeoJSONFeature } from '../types';
import { useThemeStore } from '../store/themeStore';
import AirportMarkers from './AirportMarkers';
import 'leaflet/dist/leaflet.css';

interface MapProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
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

// Heatmap color based on route frequency
const getHeatmapColor = (count: number): string => {
  if (count >= 11) return '#ef4444'; // red - very frequent
  if (count >= 6) return '#f59e0b';  // orange - frequent
  if (count >= 2) return '#eab308';  // yellow - moderate
  return '#10b981';                  // green - single flight
};

const MapUpdater = memo(({ flights }: { flights: GeoJSONFeature[] }) => {
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

function Map({ flights = [], selectedFlightId, onFlightClick }: MapProps) {
  const themeStore = useThemeStore();
  const isDarkMode = themeStore?.isDarkMode ?? false;

  // Aggregate flights by route (departure-arrival pair)
  const aggregatedRoutes = useMemo<AggregatedRoute[]>(() => {
    const routeMap: Record<string, AggregatedRoute> = {};

    flights.forEach((flight) => {
      if (!flight?.properties || !flight?.geometry) return;

      const depIATA = flight.properties.departureAirport?.iata ||
                      flight.properties.departureAirport?.icao || 'UNKNOWN';
      const arrIATA = flight.properties.arrivalAirport?.iata ||
                      flight.properties.arrivalAirport?.icao || 'UNKNOWN';

      // Create unique route key
      const routeKey = `${depIATA}-${arrIATA}`;

      if (!routeMap[routeKey]) {
        // Convert coordinates from [lon, lat] to [lat, lon] for Leaflet
        const positions = flight.geometry.coordinates.map(
          ([lon, lat]) => [lat, lon] as [number, number]
        );

        // Validate positions
        const validPositions = positions.filter(pos =>
          pos && pos.length === 2 &&
          !(pos[0] === 0 && pos[1] === 0) &&
          Number.isFinite(pos[0]) && Number.isFinite(pos[1])
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
          color: getHeatmapColor(1),
        };
      } else {
        // Increment count for existing route
        const route = routeMap[routeKey];
        route.count++;
        route.flights.push(flight);
        route.color = getHeatmapColor(route.count);
      }
    });

    return Object.values(routeMap);
  }, [flights]);

  // Memoized click handler
  const handleRouteClick = useCallback((route: AggregatedRoute) => {
    // Click on most recent flight in route
    if (route.flights.length > 0 && onFlightClick) {
      const mostRecentFlight = route.flights[route.flights.length - 1];
      onFlightClick(mostRecentFlight.properties.id);
    }
  }, [onFlightClick]);

  return (
    <div className="h-full w-full" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
      <MapContainer
        center={[50, 10]}
        zoom={4}
        minZoom={2}
        worldCopyJump={true}
        preferCanvas={true}
        style={{ height: '100%', width: '100%', touchAction: 'pan-x pan-y pinch-zoom' }}
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
                mouseover: (e: any) => {
                  const layer = e.target;
                  layer.setStyle({
                    weight: 5,
                    opacity: 1,
                  });
                  layer.bindTooltip(
                    `<div style="text-align: center;">
                      <strong>${route.departureIATA} → ${route.arrivalIATA}</strong><br/>
                      <span>${route.count}x geflogen</span>
                    </div>`,
                    { sticky: true }
                  ).openTooltip();
                },
                mouseout: (e: any) => {
                  const layer = e.target;
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
    </div>
  );
}

// Export memoized version
export default memo(Map);
