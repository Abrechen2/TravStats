import { useState } from 'react';
import Map from './Map';
import GlobeView from './GlobeView';
import type { GeoJSONFeature } from '../types';

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
}

export default function MapContainer3D({ flights, selectedFlightId, onFlightClick }: MapContainer3DProps) {
  const [is3D, setIs3D] = useState(true);

  return (
    <div className="relative h-full w-full">
      {/* View Toggle Button */}
      <div className="absolute top-4 right-4 z-[9999]">
        <button
          onClick={() => setIs3D(!is3D)}
          className="
            flex items-center gap-2 px-4 py-2
            bg-white dark:bg-gray-800
            text-gray-700 dark:text-gray-200
            border border-gray-300 dark:border-gray-600
            rounded-lg shadow-lg
            hover:bg-gray-50 dark:hover:bg-gray-700
            transition-all duration-200
            font-medium text-sm
          "
          title={is3D ? 'Zur 2D-Karte wechseln' : 'Zur 3D-Globus wechseln'}
        >
          {is3D ? (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              <span>2D-Karte</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>3D-Globus</span>
            </>
          )}
        </button>
      </div>

      {/* Map Views */}
      {is3D ? (
        <GlobeView
          flights={flights}
          selectedFlightId={selectedFlightId}
          onFlightClick={onFlightClick}
        />
      ) : (
        <Map
          flights={flights}
          selectedFlightId={selectedFlightId}
          onFlightClick={onFlightClick}
        />
      )}
    </div>
  );
}
