import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { DeckGLMap } from "./DeckGLMap";
import type { CruiseColorMode } from "./layers/cruiseArcsLayer";
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
import SpecialFlightsLegend from "./specialFlights/SpecialFlightsLegend";
import type { SpecialType } from "./specialFlights/specialTypeMeta";

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
  /** Globe-only: fires when the pinned-card "Open last flight" CTA is
      clicked — should open the flight (modal or detail page). */
  onFlightOpen?: (flightId: string) => void;
  /** Globe-only: fires when the pinned-card "Open cruise" CTA is
      clicked — should navigate to the cruise detail page. */
  onCruiseOpen?: (cruiseId: string) => void;
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
  /**
   * Split flight arcs into a two-tone gradient by status (scheduled vs.
   * historical) instead of a single flightRouteColor fill. Passed straight
   * through to DeckGLMap's buildRouteData call; undefined on tabs that keep
   * the default single-color/heatmap behaviour.
   */
  statusTwoTone?: boolean;
  /**
   * Color strategy for cruise arcs/arrows: shared two-tone by status, or
   * a distinct hue per cruise. Passed straight through to DeckGLMap.
   * Defaults to `"status"`.
   */
  cruiseColorMode?: CruiseColorMode;
  /**
   * Restrict which vis modes appear in the in-map FAB selector. Defaults
   * to all 4 (existing behaviour). Per-domain tabs pass a subset that
   * excludes cross-domain-only modes like `globe`.
   */
  availableModes?: readonly MapMode[];
  /**
   * Hide the in-map mode FAB entirely. Used by tabs that own mode
   * switching outside the map (e.g. CruisesTab uses the dashboard-level
   * mode dropdown only — its modes don't map 1:1 to MapMode).
   */
  hideVisModeSelector?: boolean;
  /**
   * Hide the top-left "<count> Flüge · <count> Routen" info pill.
   * Used by tabs that render their own overlay at top-left (e.g.
   * AllTab's Aktivität toggle + domain legend), so the info pill
   * doesn't sit underneath them and bleed through.
   */
  hideInfoPill?: boolean;
  /**
   * Pre-filtered cruise list. When provided, the internal cruiseApi
   * fetch is bypassed and these cruises are rendered instead. Lets
   * tabs pre-filter cruises by year / domain visibility upstream
   * before the data reaches the map. `showInternalCruises` is the
   * binary on/off; `cruisesOverride` is the "yes but with this list"
   * variant.
   */
  cruisesOverride?: readonly Cruise[];
}

export default function MapContainer3D({
  flights,
  flightList,
  onFlightClick,
  onRouteClick,
  onEdit,
  onFlightOpen,
  onCruiseOpen,
  visMode,
  onVisModeChange,
  minRouteCount = 1,
  filterSlot,
  onResetTrip,
  extraLayers,
  showInternalCruises = true,
  flightRouteColor,
  statusTwoTone,
  cruiseColorMode,
  availableModes,
  hideVisModeSelector = false,
  hideInfoPill = false,
  cruisesOverride,
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const { isEnabled } = useEnabledDomains();
  // Cruise-specific overlay gate. Deliberately a single-domain check (this
  // overlay renders cruise data via cruiseApi + the cruise arc layer), not
  // generic domain iteration — a future hotel/POI overlay would add its own
  // parallel gate rather than reuse this one. Routed through the memoized
  // isEnabled() helper (the sanctioned gating API) so the boolean still stays
  // stable in the effect dep array below (see the beta.28 ref-stability fix).
  const cruiseEnabled = isEnabled("cruise");
  const [fabOpen, setFabOpen] = useState(false);
  const [internalCruises, setInternalCruises] = useState<Cruise[]>([]);

  // Fetch cruises as supplemental map overlay. User hides by disabling
  // the cruise domain in settings — no per-layer toggle in V1. Depends
  // on the stable boolean (not the `isEnabled` closure) to avoid an
  // effect loop when Zustand returns a fresh selector object.
  // Suppressed when showInternalCruises=false (tab owns rendering) or
  // when cruisesOverride is provided (tab passed a pre-filtered list).
  useEffect(() => {
    if (!showInternalCruises || !cruiseEnabled || cruisesOverride !== undefined) {
      setInternalCruises((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await cruiseApi.list();
        if (!cancelled) setInternalCruises(data);
      } catch {
        if (!cancelled) setInternalCruises((prev) => (prev.length === 0 ? prev : []));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cruiseEnabled, showInternalCruises, cruisesOverride]);

  // Materialise the cruise array: override > internal fetch. When
  // override is set we trust the caller's list verbatim (already
  // filtered upstream).
  const cruises = useMemo<Cruise[]>(
    () => (cruisesOverride !== undefined ? [...cruisesOverride] : internalCruises),
    [cruisesOverride, internalCruises]
  );

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

  // Populate the legend only with specialType values actually present
  // in the current flight set — otherwise 8 entries (most empty) would
  // dominate the corner.
  const specialTypesPresent = useMemo(() => {
    const s = new Set<SpecialType>();
    for (const f of flightList ?? []) {
      if (!f.specialType) continue;
      s.add(f.specialType as SpecialType);
    }
    return s;
  }, [flightList]);

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
              onFlightOpen={onFlightOpen ?? onFlightClick}
              onCruiseOpen={onCruiseOpen}
              flightRouteColor={flightRouteColor}
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
            statusTwoTone={statusTwoTone}
            cruiseColorMode={cruiseColorMode}
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

      {/* Special-flight legend — routes mode only, only when we have
          at least one special flight to explain. Sits as an overlay,
          NOT a separate MapMode (per the V2 architectural call). */}
      {visMode === "routes" && specialTypesPresent.size > 0 && (
        <SpecialFlightsLegend presentTypes={specialTypesPresent} />
      )}

      {/* Info pill — flights + routes count, routes mode only.
          Skipped when the tab owns no flights (e.g. the Cruises tab
          renders this component with flights={[]} to reuse the
          base-map — a flight counter there would always read "0"). */}
      {!hideInfoPill && visMode === "routes" && routeCount !== null && flights.length > 0 && (
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
        {!hideVisModeSelector && (
          <VisModeSelector
            current={visMode}
            onChange={onVisModeChange}
            isOpen={fabOpen}
            onOpenChange={setFabOpen}
            availableModes={availableModes}
          />
        )}
        {filterSlot}
      </div>
    </div>
  );
}
