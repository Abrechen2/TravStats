import { lazy, Suspense } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { VisModeSelector } from "./VisModeSelector";
import type { GeoJSONFeature } from "../types";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";

const GlobeView = lazy(() => import("./GlobeView"));

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  visMode: VisMode;
  onVisModeChange: (mode: VisMode) => void;
  minRouteCount?: number;
}

export default function MapContainer3D({
  flights,
  selectedFlightId,
  onFlightClick,
  visMode,
  onVisModeChange,
  minRouteCount = 1,
}: MapContainer3DProps) {
  const { t } = useTranslation(["common", "map"]);

  return (
    <div
      className="relative h-full w-full rounded-lg shadow overflow-hidden bg-[var(--bg-surface)] flex items-center justify-center"
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
    >
      <div
        className="h-full w-full max-w-[1200px] flex items-center justify-center px-4"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
      >
        {visMode === "globe" ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-[var(--text-muted)] text-sm">{t("map:loading3DGlobe")}</p>
                </div>
              </div>
            }
          >
            <GlobeView
              flights={flights}
              selectedFlightId={selectedFlightId}
              onFlightClick={onFlightClick}
              minRouteCount={minRouteCount}
            />
          </Suspense>
        ) : (
          <DeckGLMap
            flights={flights}
            selectedFlightId={selectedFlightId}
            onFlightClick={onFlightClick}
            visMode={visMode}
            minRouteCount={minRouteCount}
          />
        )}
      </div>

      {/* Mode selector — always visible, below the dashboard toolbar */}
      <div className="absolute top-16 right-3 z-10">
        <VisModeSelector current={visMode} onChange={onVisModeChange} />
      </div>
    </div>
  );
}
