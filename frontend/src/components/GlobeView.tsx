import { useEffect, useRef, useMemo, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GeoJSONFeature } from '../types';
import { useThemeStore } from '../store/themeStore';

interface GlobeViewProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
}

// Helper function for status/category colors
const getStatusColor = (status: string, category?: string) => {
  if (category) {
    if (category === 'business') return '#3b82f6';
    if (category === 'private') return '#10b981';
    if (category === 'vacation') return '#f59e0b';
  }
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

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Calculate arc altitude based on distance - shorter flights = lower arcs, longer = higher
const getArcAltitude = (startLat: number, startLng: number, endLat: number, endLng: number): number => {
  const distance = calculateDistance(startLat, startLng, endLat, endLng);

  // Scale altitude based on distance (halved for closer to surface)
  // Short flights (< 1000km): 0.05 - 0.075
  // Medium flights (1000-5000km): 0.075 - 0.15
  // Long flights (> 5000km): 0.15 - 0.225
  if (distance < 1000) {
    return 0.05 + (distance / 1000) * 0.025;
  } else if (distance < 5000) {
    return 0.075 + ((distance - 1000) / 4000) * 0.075;
  } else {
    return Math.min(0.35 + ((distance - 5000) / 10000) * 0.075, 0.28);
  }
};

export default function GlobeView({ flights = [], selectedFlightId, onFlightClick }: GlobeViewProps) {
  const globeRef = useRef<any>();
  const themeStore = useThemeStore();
  const isDarkMode = themeStore?.isDarkMode ?? false;
  const [autoRotate, setAutoRotate] = useState(false);

  // Center globe initially
  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat: 0, lng: 0, altitude: 2.2 }, 0);
    }
  }, []);

  // Control auto-rotation
  useEffect(() => {
    if (globeRef.current && globeRef.current.controls()) {
      globeRef.current.controls().autoRotate = autoRotate;
      globeRef.current.controls().autoRotateSpeed = 0.3;
    }
  }, [autoRotate]);

  // Convert flights to arcs format
  const arcsData = useMemo(() => {
    return flights.map(flight => {
      if (!flight?.properties || !flight?.geometry) return null;

      const coords = flight.geometry.coordinates;
      if (coords.length < 2) return null;

      const start = coords[0];
      const end = coords[coords.length - 1];

      return {
        id: flight.properties.id,
        startLat: start[1],
        startLng: start[0],
        endLat: end[1],
        endLng: end[0],
        status: flight.properties.status,
        category: (flight as any).properties.category,
        airline: flight.properties.airline,
        flightNumber: flight.properties.flightNumber,
        departure: flight.properties.departureAirport,
        arrival: flight.properties.arrivalAirport,
        color: getStatusColor(flight.properties.status, (flight as any).properties.category),
        altitude: getArcAltitude(start[1], start[0], end[1], end[0]),
      };
    }).filter(arc => arc !== null);
  }, [flights]);

  // Extract airport points
  const pointsData = useMemo(() => {
    const airportMap = new Map();

    flights.forEach(flight => {
      if (!flight?.properties || !flight?.geometry) return;

      const coords = flight.geometry.coordinates;
      if (coords.length < 2) return;

      const depCode = flight.properties.departureAirport?.iata || 'Unknown';
      const arrCode = flight.properties.arrivalAirport?.iata || 'Unknown';

      // Departure airport
      if (!airportMap.has(depCode)) {
        airportMap.set(depCode, {
          lat: coords[0][1],
          lng: coords[0][0],
          name: flight.properties.departureAirport?.name || depCode,
          code: depCode,
          size: 0,
        });
      }
      airportMap.get(depCode).size++;

      // Arrival airport
      if (!airportMap.has(arrCode)) {
        airportMap.set(arrCode, {
          lat: coords[coords.length - 1][1],
          lng: coords[coords.length - 1][0],
          name: flight.properties.arrivalAirport?.name || arrCode,
          code: arrCode,
          size: 0,
        });
      }
      airportMap.get(arrCode).size++;
    });

    return Array.from(airportMap.values());
  }, [flights]);

  return (
    <div className="h-full w-full relative flex items-center justify-center">
      {/* Control Panel */}
      <div className="absolute bottom-4 left-4 z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-200 dark:border-gray-700">
        {/* Auto-Rotation Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            🌍 Auto-Rotation
          </span>
        </label>
      </div>

      <Globe
        ref={globeRef}
        style={{ width: '100%', height: '100%' }}
        globeImageUrl="https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png"
        backgroundImageUrl={null}
        // Arcs (Flight paths) - Static, thin lines that stay above globe
        arcsData={arcsData}
        arcColor={(arc: any) => arc.color}
        arcStroke={0.4}
        arcAltitude={(arc: any) => arc.altitude}
        arcCurveResolution={64}
        arcDashLength={1}
        arcDashGap={0}
        arcDashInitialGap={() => 0}
        arcLabel={(arc: any) => `
          <div style="
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: system-ui;
            font-size: 12px;
          ">
            <div style="font-weight: bold; margin-bottom: 4px;">
              ${arc.airline} ${arc.flightNumber}
            </div>
            <div>${arc.departure?.iata || arc.departure?.name} → ${arc.arrival?.iata || arc.arrival?.name}</div>
            <div style="margin-top: 4px; color: ${arc.color};">
              ${arc.status.toUpperCase()}
            </div>
          </div>
        `}
        onArcClick={(arc: any) => {
          if (onFlightClick && arc.id) {
            onFlightClick(arc.id);
          }
        }}
        // Points (Airports)
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => isDarkMode ? '#fbbf24' : '#f59e0b'}
        pointAltitude={0.01}
        pointRadius={(point: any) => Math.sqrt(point.size) * 0.2}
        pointLabel={(point: any) => `
          <div style="
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 6px 10px;
            border-radius: 4px;
            font-family: system-ui;
            font-size: 11px;
          ">
            <div style="font-weight: bold;">${point.code}</div>
            <div style="opacity: 0.8;">${point.name}</div>
            <div style="margin-top: 2px; color: #fbbf24;">
              ${point.size} flight${point.size !== 1 ? 's' : ''}
            </div>
          </div>
        `}
        // Globe settings
        atmosphereColor={isDarkMode ? '#4a5568' : '#3b82f6'}
        atmosphereAltitude={0.25}
        enablePointerInteraction={true}
        animateIn={true}
      />
    </div>
  );
}
