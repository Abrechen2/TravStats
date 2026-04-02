import { lazy, Suspense, useState, useMemo } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { VisModeSelector } from "./VisModeSelector";
import type { GeoJSONFeature } from "../types";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";
import { useThemeStore } from "../store/themeStore";

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
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const [fabOpen, setFabOpen] = useState(false);

  const routeCount = useMemo(() => {
    if (visMode !== "routes") return null;
    const seen = new Set<string>();
    for (const f of flights) {
      const dep = f.properties.departureAirport?.iata;
      const arr = f.properties.arrivalAirport?.iata;
      if (dep && arr) seen.add([dep, arr].sort().join("-"));
    }
    return seen.size;
  }, [flights, visMode]);

  return (
    <div
      data-map-theme={mapTheme}
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
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--map-accent)] mx-auto mb-2" />
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

      {/* Backdrop — dims map when FAB is open, click to close */}
      {fabOpen && (
        <div
          className="absolute inset-0 z-10"
          style={{ background: "rgba(10, 8, 30, 0.45)", backdropFilter: "blur(1px)" }}
          onClick={() => setFabOpen(false)}
        />
      )}

      {/* Info pill — flights + routes count, routes mode only */}
      {visMode === "routes" && routeCount !== null && (
        <div
          className="absolute top-3 left-3 z-10"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "5px 10px",
            fontSize: "9px",
            color: "rgba(148,163,184,0.8)",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <span style={{ color: "var(--map-accent)", fontWeight: 600 }}>{flights.length}</span>{" "}
          {t("map:infoPill.flights")}
          {" · "}
          <span style={{ color: "var(--map-accent)", fontWeight: 600 }}>{routeCount}</span>{" "}
          {t("map:infoPill.routes")}
        </div>
      )}

      {/* FAB — bottom right, always on top */}
      <div className="absolute bottom-4 right-4 z-20">
        <VisModeSelector
          current={visMode}
          onChange={onVisModeChange}
          isOpen={fabOpen}
          onOpenChange={setFabOpen}
        />
      </div>
    </div>
  );
}
