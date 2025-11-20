import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { GeoJSONFeature } from '../types';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface MapProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
}

function MapUpdater({ flights }: { flights: GeoJSONFeature[] }) {
  const map = useMap();

  useEffect(() => {
    if (flights.length > 0) {
      const bounds = flights.reduce((acc, flight) => {
        flight.geometry.coordinates.forEach(([lon, lat]) => {
          // Skip invalid coordinates (0,0 or non-finite)
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

export default function Map({ flights, selectedFlightId, onFlightClick }: MapProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'flown':
        return '#10b981'; // green
      case 'scheduled':
        return '#3b82f6'; // blue
      case 'cancelled':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  return (
    <div className="h-full w-full">
      <MapContainer
        center={[50, 10]}
        zoom={4}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapUpdater flights={flights} />

        {flights.map((flight) => {
          const isSelected = flight.properties.id === selectedFlightId;
          const color = getStatusColor(flight.properties.status);

          // Convert coordinates from [lon, lat] to [lat, lon] for Leaflet
          const positions = flight.geometry.coordinates.map(
            ([lon, lat]) => [lat, lon] as [number, number]
          );

          // Skip flights with invalid coordinates (0,0 or missing data)
          if (positions.length === 0 ||
              positions.some(pos => !pos || pos.length !== 2 ||
                            (pos[0] === 0 && pos[1] === 0) ||
                            !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]))) {
            return null;
          }

          const startPos = positions[0];
          const endPos = positions[positions.length - 1];

          return (
            <div key={flight.properties.id}>
              {/* Flight path */}
              <Polyline
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

              {/* Departure marker */}
              <Marker position={startPos}>
                <Popup>
                  <div className="text-sm">
                    <strong>Departure</strong>
                    <br />
                    {flight.properties.departureAirport.iata || flight.properties.departureAirport.icao}
                    {flight.properties.departureAirport.name && (
                      <>
                        <br />
                        {flight.properties.departureAirport.name}
                      </>
                    )}
                    <br />
                    {new Date(flight.properties.departureTime).toLocaleString()}
                  </div>
                </Popup>
              </Marker>

              {/* Arrival marker */}
              <Marker position={endPos}>
                <Popup>
                  <div className="text-sm">
                    <strong>Arrival</strong>
                    <br />
                    {flight.properties.arrivalAirport.iata || flight.properties.arrivalAirport.icao}
                    {flight.properties.arrivalAirport.name && (
                      <>
                        <br />
                        {flight.properties.arrivalAirport.name}
                      </>
                    )}
                    <br />
                    {new Date(flight.properties.arrivalTime).toLocaleString()}
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>
    </div>
  );
}
