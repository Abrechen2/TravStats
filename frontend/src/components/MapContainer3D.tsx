import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { GlobeLoader } from "./GlobeLoader";
import type { Cruise, GeoJSONFeature, Flight } from "../types";
import type { Lodging } from "../types/lodging";
import type { Layer } from "@deck.gl/core";
import type { AppearanceDomain } from "./map/controlPanelKit";
import { loadMapAppearance, saveMapAppearance } from "./map/mapAppearance";

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
  // NOTE: there is deliberately no `cruiseColorMode` prop any more. The mode is
  // the USER's, not the tab's — it lives in `store/cruiseColorStore.ts`, which
  // both renderers and the dashboard legend read. A tab that forced a mode here
  // was exactly the reported defect (#reported-2.3.1): the Alle tab pinned
  // "status", the Kreuzfahrten tab pinned "perCruise", and the panel's setting
  // reached neither.
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
  /**
   * Lodging places (hotels/campsites) to render as pins on the flat map.
   * Unlike `cruisesOverride`, there is no internal fetch fallback —
   * MapContainer3D has no lodging-domain equivalent of `showInternalCruises`
   * yet, so the pin layer only ever renders what the caller passes here.
   * Undefined (the default) means "no lodging layer at all", so tabs that
   * don't pass it (flight/cruise tabs) are unaffected. Lodgings without
   * both `lat` and `lon` are silently skipped by `buildLodgingPins`.
   * Globe mode doesn't render this yet — pins are flat-map only for now.
   */
  lodgingsOverride?: Lodging[];
  /**
   * Fired when a lodging pin is clicked — receives the lodging id.
   * Threaded straight through to DeckGLMap, which builds the actual pin
   * layer (see its `onLodgingClick` doc comment for why the layer itself
   * lives there and not here). Undefined means pins render but aren't
   * clickable — the callers that don't pass `lodgingsOverride` don't have
   * any pins to click anyway.
   */
  onLodgingClick?: (lodgingId: string) => void;
  /**
   * Which domain appearance sections the map control panel exposes. The
   * Alle tab passes both; single-domain tabs pass just their own domain
   * so the panel only surfaces the relevant route/marker controls.
   * Defaults to both for callers that don't specify.
   */
  appearanceDomains?: readonly AppearanceDomain[];
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
  minRouteCount = 1,
  filterSlot,
  onResetTrip,
  extraLayers,
  showInternalCruises = true,
  hideInfoPill = false,
  cruisesOverride,
  lodgingsOverride,
  onLodgingClick,
  appearanceDomains = ["flight", "cruise"],
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

  // Lodging marker-size slider (Task 8). Lives HERE rather than in
  // DeckGLMap's local state (unlike the flight/cruise marker sizes) purely
  // so it persists via `saveMapAppearance` the same way every other
  // appearance field does — a merge-write that only touches this key.
  // Threaded down into DeckGLMap both to render the slider AND (since
  // Task 9) to actually build the lodging pin layer — DeckGLMap is what
  // calls `buildLodgingPins` now (it needs the private zoom/labelsMode
  // state that only exists there; see DeckGLMap's `lodgingsOverride` doc
  // comment), this component just supplies the raw list + the size value.
  const [lodgingMarkerSize, setLodgingMarkerSize] = useState<number>(
    () => loadMapAppearance().lodgingMarkerSize ?? 1
  );
  useEffect(() => {
    saveMapAppearance({ lodgingMarkerSize });
  }, [lodgingMarkerSize]);

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
      className="relative h-full w-full rounded-lg shadow-sm overflow-hidden bg-(--bg-surface) flex items-center justify-center"
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
              minRouteCount={minRouteCount}
              appearanceDomains={appearanceDomains}
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
            appearanceDomains={appearanceDomains}
            lodgingMarkerSize={lodgingMarkerSize}
            onLodgingMarkerSizeChange={setLodgingMarkerSize}
            lodgingsOverride={lodgingsOverride}
            onLodgingClick={onLodgingClick}
          />
        )}
      </div>

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

      {/* Bottom-right: filter FAB only. The in-map mode FAB was removed —
          mode switching lives solely in the top "Modus" dropdown (the FAB
          duplicated it). */}
      {filterSlot && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
          {filterSlot}
        </div>
      )}
    </div>
  );
}
