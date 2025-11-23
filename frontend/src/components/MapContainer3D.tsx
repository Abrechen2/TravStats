import Map from './Map';
import GlobeView from './GlobeView';
import type { GeoJSONFeature } from '../types';

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  is3D: boolean;
}

export default function MapContainer3D({
  flights,
  selectedFlightId,
  onFlightClick,
  is3D,
}: MapContainer3DProps) {
  return (
    <div className="relative h-full w-full rounded-lg shadow overflow-hidden bg-white dark:bg-gray-900 flex items-center justify-center" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
      <div className="h-full w-full max-w-[1200px] flex items-center justify-center px-4" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
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
    </div>
  );
}
