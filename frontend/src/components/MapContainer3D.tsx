import { lazy, Suspense } from 'react';
import Map from './Map';
import type { GeoJSONFeature } from '../types';

// Lazy load GlobeView as it's heavy (Three.js, react-globe.gl)
const GlobeView = lazy(() => import('./GlobeView'));

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  is3D: boolean;
  minRouteCount?: number;
}

export default function MapContainer3D({
  flights,
  selectedFlightId,
  onFlightClick,
  is3D,
  minRouteCount = 1,
}: MapContainer3DProps) {
  return (
    <div className="relative h-full w-full rounded-lg shadow overflow-hidden bg-white dark:bg-gray-900 flex items-center justify-center" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
      <div className="h-full w-full max-w-[1200px] flex items-center justify-center px-4" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        {is3D ? (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-gray-600 dark:text-gray-300 text-sm">Loading 3D globe...</p>
              </div>
            </div>
          }>
            <GlobeView
              flights={flights}
              selectedFlightId={selectedFlightId}
              onFlightClick={onFlightClick}
              minRouteCount={minRouteCount}
            />
          </Suspense>
        ) : (
          <Map
            flights={flights}
            selectedFlightId={selectedFlightId}
            onFlightClick={onFlightClick}
            minRouteCount={minRouteCount}
          />
        )}
      </div>
    </div>
  );
}
