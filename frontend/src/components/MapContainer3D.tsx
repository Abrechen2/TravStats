import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { VisModeSelector } from "./VisModeSelector";
import type { GeoJSONFeature, Flight, Trip } from "../types";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";
import { useThemeStore } from "../store/themeStore";
import { tripsApi } from "../lib/api";

const GlobeView = lazy(() => import("./GlobeView"));

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  flightList?: Flight[];
  onFlightClick?: (flightId: string) => void;
  onEdit?: (flight: Flight) => void;
  visMode: VisMode;
  onVisModeChange: (mode: VisMode) => void;
  minRouteCount?: number;
  filterSlot?: React.ReactNode;
}

export default function MapContainer3D({
  flights,
  flightList,
  onFlightClick,
  onEdit,
  visMode,
  onVisModeChange,
  minRouteCount = 1,
  filterSlot,
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const [fabOpen, setFabOpen] = useState(false);
  const [tripList, setTripList] = useState<Trip[]>([]);

  useEffect(() => {
    const loadTrips = async (): Promise<void> => {
      try {
        const data = await tripsApi.getAll();
        setTripList(data);
      } catch {
        // Non-critical — map still works without trips
      }
    };
    void loadTrips();
  }, []);

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
      <div className="h-full w-full" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
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
              onFlightClick={onFlightClick}
              minRouteCount={minRouteCount}
            />
          </Suspense>
        ) : (
          <DeckGLMap
            flights={flights}
            flightList={flightList}
            tripList={tripList.map((t) => ({ id: t.id, color: t.color }))}
            onFlightClick={onFlightClick}
            onEdit={onEdit}
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

      {/* Bottom-right stack: mode FAB (top) + filter FAB (bottom) */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
        <VisModeSelector
          current={visMode}
          onChange={onVisModeChange}
          isOpen={fabOpen}
          onOpenChange={setFabOpen}
        />
        {filterSlot}
      </div>
    </div>
  );
}
