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
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
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

          return (
            <Polyline
              key={flight.properties.id}
              positions={positions}
              pathOptions={{
                color,
                weight: isSelected ? 4 : 2,
                opacity: isSelected ? 1 : 0.6,
              }}
              eventHandlers={{
                click: () => onFlightClick?.(flight.properties.id),
              }}
            />
          );
        })}

        {/* Airport markers with aggregated stats */}
        <AirportMarkers flights={flights} />
      </MapContainer>
    </div>
  );
}
