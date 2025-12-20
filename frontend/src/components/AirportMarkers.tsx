import { useMemo, memo } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import type { GeoJSONFeature } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface AirportMarkersProps {
  flights: GeoJSONFeature[];
}

interface AirportStats {
  code: string;
  name: string;
  lat: number;
  lon: number;
  visits: number;
  departures: number;
  arrivals: number;
  lastVisit: string;
  firstVisit: string;
  airlines: string[];
}

function AirportMarkers({ flights }: AirportMarkersProps) {
  const { t } = useTranslation(['map', 'common']);
  const airportStats = useMemo(() => {
    const statsMap = new Map<string, AirportStats>();

    flights.forEach((flight) => {
      if (!flight?.properties || !flight?.geometry) return;

      const { properties, geometry } = flight;
      const depCode = properties.departureAirport?.iata || properties.departureAirport?.icao;
      const arrCode = properties.arrivalAirport?.iata || properties.arrivalAirport?.icao;

      // Process departure
      if (depCode && geometry.coordinates?.[0]) {
        const [lon, lat] = geometry.coordinates[0];

        // Only create new entry if coordinates are valid
        const coordsValid = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

        if (!statsMap.has(depCode)) {
          // Skip if coordinates are invalid and airport doesn't exist yet
          if (!coordsValid) return;

          statsMap.set(depCode, {
            code: depCode,
            name: properties.departureAirport.name || depCode,
            lat,
            lon,
            visits: 0,
            departures: 0,
            arrivals: 0,
            lastVisit: properties.departureTime,
            firstVisit: properties.departureTime,
            airlines: [],
          });
        }

        // Update stats (even if current flight has invalid coords)
        const stats = statsMap.get(depCode)!;
        stats.visits++;
        stats.departures++;
        if (properties.airline && !stats.airlines.includes(properties.airline)) {
          stats.airlines.push(properties.airline);
        }
        if (new Date(properties.departureTime) > new Date(stats.lastVisit)) {
          stats.lastVisit = properties.departureTime;
        }
        if (new Date(properties.departureTime) < new Date(stats.firstVisit)) {
          stats.firstVisit = properties.departureTime;
        }
      }

      // Process arrival
      if (arrCode && geometry.coordinates?.length > 0) {
        const [lon, lat] = geometry.coordinates[geometry.coordinates.length - 1];

        // Only create new entry if coordinates are valid
        const coordsValid = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

        if (!statsMap.has(arrCode)) {
          // Skip if coordinates are invalid and airport doesn't exist yet
          if (!coordsValid) return;

          statsMap.set(arrCode, {
            code: arrCode,
            name: properties.arrivalAirport.name || arrCode,
            lat,
            lon,
            visits: 0,
            departures: 0,
            arrivals: 0,
            lastVisit: properties.arrivalTime,
            firstVisit: properties.arrivalTime,
            airlines: [],
          });
        }

        // Update stats (even if current flight has invalid coords)
        const stats = statsMap.get(arrCode)!;
        stats.visits++;
        stats.arrivals++;
        if (properties.airline && !stats.airlines.includes(properties.airline)) {
          stats.airlines.push(properties.airline);
        }
        if (new Date(properties.arrivalTime) > new Date(stats.lastVisit)) {
          stats.lastVisit = properties.arrivalTime;
        }
        if (new Date(properties.arrivalTime) < new Date(stats.firstVisit)) {
          stats.firstVisit = properties.arrivalTime;
        }
      }
    });

    return Array.from(statsMap.values());
  }, [flights]);

  const getAirportColor = (visits: number) => {
    if (visits >= 10) return '#ef4444';
    if (visits >= 5) return '#f59e0b';
    if (visits >= 3) return '#eab308';
    return '#10b981';
  };

  const getAirportRadius = (visits: number) => {
    // Reduced maximum size from 15 to 12 for better visibility
    return Math.min(4 + visits * 0.5, 12);
  };

  return (
    <>
      {airportStats.map((airport) => {
        if (!Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) return null;

        const position: [number, number] = [airport.lat, airport.lon];
        const color = getAirportColor(airport.visits);
        const radius = getAirportRadius(airport.visits);

        return (
          <CircleMarker
            key={airport.code}
            center={position}
            radius={radius}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.6,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm space-y-2" style={{ minWidth: '200px' }}>
                <div className="font-bold text-base border-b pb-1 mb-2">
                  {airport.code}
                </div>

                <div className="text-xs text-gray-600">
                  {airport.name}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                  <div>
                    <div className="text-xs text-gray-500">{t('map:airportMarkers.visits')}</div>
                    <div className="font-semibold text-blue-600">{airport.visits}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('map:airportMarkers.airlines')}</div>
                    <div className="font-semibold text-purple-600">{airport.airlines.length}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('map:airportMarkers.departures')}</div>
                    <div className="font-semibold text-green-600">{airport.departures}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('map:airportMarkers.arrivals')}</div>
                    <div className="font-semibold text-orange-600">{airport.arrivals}</div>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="text-xs text-gray-500 mb-1">{t('map:airportMarkers.lastVisit')}</div>
                  <div className="text-xs text-gray-600">
                    {new Date(airport.lastVisit).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="text-xs text-gray-500 mb-1">{t('map:airportMarkers.firstVisit')}</div>
                  <div className="text-xs text-gray-600">
                    {new Date(airport.firstVisit).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                </div>

                {airport.airlines.length > 0 && (
                  <div className="pt-2 border-t">
                    <div className="text-xs text-gray-500 mb-1">{t('map:airportMarkers.airlines')}</div>
                    <div className="text-xs text-gray-600">
                      {airport.airlines.slice(0, 3).join(', ')}
                      {airport.airlines.length > 3 && ` ${t('map:airportMarkers.moreAirlines', { count: airport.airlines.length - 3 })}`}
                    </div>
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

// Export memoized version to prevent unnecessary re-renders
export default memo(AirportMarkers);
