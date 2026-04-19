import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { GlobeLoader } from "./GlobeLoader";
import { VisModeSelector } from "./VisModeSelector";
import type { Cruise, GeoJSONFeature, Flight, Trip } from "../types";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";
import { useThemeStore } from "../store/themeStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { cruiseApi, tripsApi } from "../lib/api";

// Hold the branded Suspense fallback for at least 2 s on first mount so
// the GlobeLoader doesn't just flash by. React.lazy caches the resolved
// module, so this delay only fires the first time the 3D globe is
// opened in a session.
const GlobeView = lazy(() =>
  Promise.all([
    import("./GlobeView"),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]).then(([mod]) => mod)
);

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  flightList?: Flight[];
  onFlightClick?: (flightId: string) => void;
  onRouteClick?: (flightIds: string[]) => void;
  onEdit?: (flight: Flight) => void;
  visMode: VisMode;
  onVisModeChange: (mode: VisMode) => void;
  minRouteCount?: number;
  filterSlot?: React.ReactNode;
  activeTripId?: string | null;
  onResetTrip?: () => void;
}

export default function MapContainer3D({
  flights,
  flightList,
  onFlightClick,
  onRouteClick,
  onEdit,
  visMode,
  onVisModeChange,
  minRouteCount = 1,
  filterSlot,
  activeTripId,
  onResetTrip,
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const { isEnabled } = useEnabledDomains();
  const [fabOpen, setFabOpen] = useState(false);
  const [tripList, setTripList] = useState<Trip[]>([]);
  const [cruises, setCruises] = useState<Cruise[]>([]);

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

  // Fetch cruises as supplemental map overlay. User hides by disabling
  // the cruise domain in settings — no per-layer toggle in V1.
  useEffect(() => {
    if (!isEnabled("cruise")) {
      setCruises([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await cruiseApi.list();
        if (!cancelled) setCruises(data);
      } catch {
        if (!cancelled) setCruises([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

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
                <GlobeLoader size={180} label={t("map:loading3DGlobe")} />
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
            cruises={cruises}
            onFlightClick={onFlightClick}
            onRouteClick={onRouteClick}
            onEdit={onEdit}
            visMode={visMode}
            minRouteCount={minRouteCount}
            activeTripId={activeTripId}
            onResetTrip={onResetTrip}
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
