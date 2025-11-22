import { useEffect } from 'react';
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

function MapUpdater({ flights }: { flights: GeoJSONFeature[] }) {
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
}

export default function Map({ flights = [], selectedFlightId, onFlightClick }: MapProps) {
  const themeStore = useThemeStore();
  const isDarkMode = themeStore?.isDarkMode ?? false;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'flown':
        return '#10b981';
      case 'scheduled':
        return '#3b82f6';
      case 'cancelled':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const maxBounds: L.LatLngBoundsExpression = [
    [-90, -180],
    [90, 180],
  ];

  return (
    <div className="h-full w-full">
      <MapContainer
        center={[50, 10]}
        zoom={4}
        minZoom={2}
        maxBounds={maxBounds}
        maxBoundsViscosity={1.0}
        worldCopyJump={false}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg"
      >
        {isDarkMode ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
            noWrap={true}
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            noWrap={true}
          />
        )}

        <MapUpdater flights={flights} />

        {/* Flight paths */}
        {flights.map((flight) => {
          if (!flight?.properties || !flight?.geometry) return null;

          const isSelected = flight.properties.id === selectedFlightId;
          const color = getStatusColor(flight.properties.status);

          const positions = flight.geometry.coordinates.map(
            ([lon, lat]) => [lat, lon] as [number, number]
          );

          if (positions.length === 0 ||
              positions.some(pos => !pos || pos.length !== 2 ||
                            (pos[0] === 0 && pos[1] === 0) ||
                            !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]))) {
            return null;
          }

          // Split line at antimeridian crossings
          const segments = splitLineAtAntimeridian(positions);

          // Render each segment as a separate polyline
          return segments.map((segment, index) => (
            <Polyline
              key={`${flight.properties.id}-${index}`}
              positions={segment}
              pathOptions={{
                color,
                weight: isSelected ? 4 : 2,
                opacity: isSelected ? 1 : 0.6,
              }}
              eventHandlers={{
                click: () => onFlightClick?.(flight.properties.id),
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
