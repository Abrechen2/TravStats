import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { GlobeLoader } from "./GlobeLoader";
import { VisModeSelector } from "./VisModeSelector";
import type { Cruise, GeoJSONFeature, Flight } from "../types";
import type { Layer } from "@deck.gl/core";

/**
 * The narrow set of map-rendering modes that MapContainer3D actually implements.
 * Replaces the retired global VisMode union — callers import this type instead.
 */
export type MapMode = "routes" | "heatmap" | "trips" | "globe";
import { useTranslation } from "../hooks/useTranslation";
import { useThemeStore } from "../store/themeStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { cruiseApi } from "../lib/api";

// Globe mode renders on MapLibre's native globe projection (same engine
// as the 2D map), with deck.gl as the data-layer overlay. Lazy-loaded so
// the dashboard's first paint isn't blocked on MapLibre + deck.gl boot.
const GlobeView = lazy(() => import("./GlobeView"));

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  flightList?: Flight[];
  onFlightClick?: (flightId: string) => void;
  onRouteClick?: (flightIds: string[]) => void;
  onEdit?: (flight: Flight) => void;
  visMode: MapMode;
  onVisModeChange: (mode: MapMode) => void;
  minRouteCount?: number;
  filterSlot?: React.ReactNode;
  onResetTrip?: () => void;
  /** Extra deck.gl layers appended after all internally-built layers. */
  extraLayers?: Layer[];
  /**
   * When false, the internal cruise fetch + cruise arc/port layers are
   * suppressed. Defaults to true (no behaviour change for existing callers).
   * Set to false on tabs that manage their own cruise rendering to avoid
   * cross-tab layer bleed.
   */
  showInternalCruises?: boolean;
  /**
   * Override the count-based heatmap palette for flight route arcs with
   * a single monochrome color. Set on the Alle-tab so flights read as
   * "pink / domain-flight" against sky-blue cruises; other tabs leave
   * it undefined to keep the count-encoded heatmap behaviour.
   */
  flightRouteColor?: [number, number, number];
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
  onResetTrip,
  extraLayers,
  showInternalCruises = true,
  flightRouteColor,
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const { enabled: enabledDomains } = useEnabledDomains();
  const cruiseEnabled = enabledDomains.includes("cruise");
  const [fabOpen, setFabOpen] = useState(false);
  const [cruises, setCruises] = useState<Cruise[]>([]);

  // Fetch cruises as supplemental map overlay. User hides by disabling
  // the cruise domain in settings — no per-layer toggle in V1. Depends
  // on the stable boolean (not the `isEnabled` closure) to avoid an
  // effect loop when Zustand returns a fresh selector object.
  // Suppressed when showInternalCruises=false so that tabs owning their
  // own cruise rendering (e.g. CruisesTab) don't double-fetch.
  useEffect(() => {
    if (!showInternalCruises || !cruiseEnabled) {
      setCruises((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await cruiseApi.list();
        if (!cancelled) setCruises(data);
      } catch {
        if (!cancelled) setCruises((prev) => (prev.length === 0 ? prev : []));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cruiseEnabled, showInternalCruises]);

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
              cruises={cruises}
              onFlightClick={onFlightClick}
              minRouteCount={minRouteCount}
            />
          </Suspense>
        ) : (
          <DeckGLMap
            flights={flights}
            flightList={flightList}
            cruises={cruises}
            onFlightClick={onFlightClick}
            onRouteClick={onRouteClick}
            onEdit={onEdit}
            visMode={visMode}
            minRouteCount={minRouteCount}
            onResetTrip={onResetTrip}
            extraLayers={extraLayers}
            flightRouteColor={flightRouteColor}
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

      {/* Info pill — flights + routes count, routes mode only.
          Skipped when the tab owns no flights (e.g. the Cruises tab
          renders this component with flights={[]} to reuse the
          base-map — a flight counter there would always read "0"). */}
      {visMode === "routes" && routeCount !== null && flights.length > 0 && (
        <div
          className="absolute top-3 left-3 z-10 select-none"
          style={{
            background: "rgba(13, 17, 23, 0.78)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "8px",
            padding: "6px 12px",
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.01em",
            color: "rgba(241,245,249,0.95)",
            fontFamily: "'Inter', sans-serif",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          <span style={{ color: "var(--map-accent)", fontWeight: 700 }}>{flights.length}</span>{" "}
          {t("map:infoPill.flights")}
          {" · "}
          <span style={{ color: "var(--map-accent)", fontWeight: 700 }}>{routeCount}</span>{" "}
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
