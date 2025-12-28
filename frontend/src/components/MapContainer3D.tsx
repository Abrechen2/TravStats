import { lazy, Suspense, useEffect } from 'react';
import Map from './Map';
import type { GeoJSONFeature } from '../types';
import { useTranslation } from '../hooks/useTranslation';

// #region agent log
const debugLog = (location: string, message: string, data: any = {}, hypothesisId?: string) => {
  // Only log in development mode
  if (import.meta.env.MODE !== 'development') {
    return;
  }
  
  // Development-only console logging
  console.log(`[DEBUG ${hypothesisId || '?'}] ${location}: ${message}`, data);
  
  // Store in localStorage for development debugging (max 100 entries)
  try {
    const logEntry = {
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId,
    };
    const stored = localStorage.getItem('debug-logs') || '[]';
    const logs = JSON.parse(stored);
    logs.push(logEntry);
    if (logs.length > 100) logs.shift();
    localStorage.setItem('debug-logs', JSON.stringify(logs));
  } catch (e) {
    // Ignore localStorage errors
  }
};
// #endregion

// #region agent log
// Lazy load GlobeView with logging
const GlobeView = lazy(() => {
  debugLog('MapContainer3D.tsx:lazy-import', 'Starting GlobeView lazy import', {}, 'E');
  return import('./GlobeView').then((module) => {
    debugLog('MapContainer3D.tsx:lazy-import', 'GlobeView module loaded successfully', {
      hasDefault: !!module.default,
    }, 'E');
    return module;
  }).catch((error) => {
    debugLog('MapContainer3D.tsx:lazy-import', 'GlobeView import failed', {
      error: error?.toString(),
      stack: error?.stack,
    }, 'E');
    throw error;
  });
});
// #endregion

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
  const { t } = useTranslation(['common', 'map']);
  
  // #region agent log
  useEffect(() => {
    debugLog('MapContainer3D.tsx:render', 'MapContainer3D rendered', {
      is3D,
      flightsCount: flights.length,
      minRouteCount,
    }, is3D ? 'E' : undefined);
  }, [is3D, flights.length, minRouteCount]);
  // #endregion
  
  return (
    <div className="relative h-full w-full rounded-lg shadow overflow-hidden bg-white dark:bg-gray-900 flex items-center justify-center" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
      <div className="h-full w-full max-w-[1200px] flex items-center justify-center px-4" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        {is3D ? (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-gray-600 dark:text-gray-300 text-sm">{t('map:loading3DGlobe')}</p>
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
