import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useFlightLookup } from "../../../hooks/useFlightLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { cruiseApi } from "../../../lib/api/cruise";
import { flightsApi } from "../../../lib/api/flights";
import { listLodgings } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api/trips";
import { buildCruiseLegend, type CruiseLegendRow } from "../../../lib/cruiseColor";
import { buildFlightLegend, rgbCss, type FlightLegendRow } from "../../../lib/flightColor";
import { buildLodgingLegend } from "../../../lib/lodgingColor";
import { logger } from "../../../lib/logger";
import { useCruiseColorStore } from "../../../store/cruiseColorStore";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import { useFlightColorStore } from "../../../store/flightColorStore";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import type { Flight, FlightInput, GeoJSONFeature, Trip } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { AllMode } from "../../../types/dashboard";
import { ALL_MODES } from "../../../types/dashboard";
import FlightEditModal from "../../FlightEditModal";
import MapContainer3D, { type MapMode } from "../../MapContainer3D";
import { buildJourneyLayers, groupByTripId } from "../modes/buildJourneyLayers";
import { UnifiedActivityPanel } from "../sidebars/UnifiedActivityPanel";
import type { Layer } from "@deck.gl/core";

// Legend row → i18n key. The COLOURS never appear here — they come from
// `buildFlightLegend`, i.e. the same function the map layers resolve through
// (see lib/flightColor.ts). Adding a 4th colour mode later means adding a
// label here, never a colour value.
const FLIGHT_LEGEND_LABEL_KEY: Record<FlightLegendRow["slot"], string> = {
  past: "dashboard:legend.flightPast",
  upcoming: "dashboard:legend.flightUpcoming",
  frequency: "dashboard:legend.flightFrequency",
  solid: "dashboard:legend.flightSolid",
};

// Same contract on the cruise side (#reported-2.3.1): the legend used to
// hardcode rgb(74,144,217) / rgb(34,211,238) as string literals, so it kept
// claiming blue/cyan while the user's colours were already on the map.
const CRUISE_LEGEND_LABEL_KEY: Record<CruiseLegendRow["slot"], string> = {
  past: "dashboard:legend.cruisePast",
  planned: "dashboard:legend.cruisePlanned",
  perCruise: "dashboard:legend.cruisePerCruise",
  solid: "dashboard:legend.cruiseSolid",
};

// Maps the dashboard-level AllMode to what MapContainer3D's visMode prop expects.
// "journey" uses extraLayers with showInternalCruises=false so it has full
// control over which trip is rendered.
const ALL_MODE_TO_MAP_MODE: Record<AllMode, MapMode> = {
  overview: "routes",
  heatmap: "heatmap",
  journey: "routes",
  globe: "globe",
};

function isAllMode(mode: unknown): mode is AllMode {
  return typeof mode === "string" && (ALL_MODES as readonly string[]).includes(mode);
}

export function AllTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const { t } = useTranslation(["dashboard"]);
  // The SAME store the map layers + both control panels read. The legend
  // cannot drift from the map because it is not a copy of the state — it is
  // the state, run through the same colour resolver.
  const flightColorConfig = useFlightColorStore((s) => s.config);
  const cruiseColorConfig = useCruiseColorStore((s) => s.config);
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { lookup, lookupMany } = useFlightLookup();
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const navigate = useNavigate();
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);

  // Global dashboard filter — year populates `time.from/to`, domain
  // pill row toggles flight/cruise visibility on the Alle tab. The pill
  // filter is intersected with the user's enabledDomains: a disabled
  // domain must never surface here, regardless of the pill state (the
  // pill store defaults to AVAILABLE_DOMAINS, not the user's setting).
  const { isEnabled } = useEnabledDomains();
  const filterTime = useDashboardFilterStore((s) => s.time);
  const filterDomains = useDashboardFilterStore((s) => s.domains);
  const flightsVisible = filterDomains.includes("flight") && isEnabled("flight");
  const cruisesVisible = filterDomains.includes("cruise") && isEnabled("cruise");
  const lodgingsVisible = filterDomains.includes("lodging") && isEnabled("lodging");

  // Filter flights by departureTime within the year/time range.
  // Flights without a departureTime stay visible (treat NaN as
  // unbounded, mirroring intervalOverlapsRange's permissive policy).
  const visibleFlights = useMemo<GeoJSONFeature[]>(() => {
    if (!flightsVisible) return [];
    const from = filterTime.from;
    const to = filterTime.to;
    if (!from && !to) return flights;
    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    return flights.filter((f) => {
      const dep = f.properties.departureTime;
      if (!dep) return true;
      const t = Date.parse(dep);
      if (Number.isNaN(t)) return true;
      return t >= fromMs && t <= toMs;
    });
  }, [flights, flightsVisible, filterTime.from, filterTime.to]);

  // Cruises filtered by interval overlap (cruise has start + optional end);
  // hidden entirely when domain is off.
  const visibleCruises = useMemo<Cruise[]>(() => {
    if (!cruisesVisible) return [];
    if (!filterTime.from && !filterTime.to) return cruises;
    return cruises.filter((c) =>
      // Cruises with a null startDate stay visible — same permissive
      // policy intervalOverlapsRange uses for unparseable dates.
      intervalOverlapsRange(c.startDate ?? "", c.endDate, filterTime.from, filterTime.to)
    );
  }, [cruises, cruisesVisible, filterTime.from, filterTime.to]);

  // Lodgings filtered by stay overlap (mirrors LodgingTab's visibleLodgings):
  // a lodging stays visible if ANY of its stays overlaps the selected range.
  // Hidden entirely when the domain chip is off or the domain is disabled.
  const visibleLodgings = useMemo<Lodging[]>(() => {
    if (!lodgingsVisible) return [];
    if (!filterTime.from && !filterTime.to) return lodgings;
    return lodgings.filter((lodging) =>
      lodging.stays.some((stay) =>
        intervalOverlapsRange(stay.checkIn, stay.checkOut, filterTime.from, filterTime.to)
      )
    );
  }, [lodgings, lodgingsVisible, filterTime.from, filterTime.to]);

  // Map click → selection store. DeckGLMap handles dim/highlight + tooltip.
  const handleFlightClick = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setSelection([f]);
    },
    [lookup, setSelection]
  );
  const handleRouteClick = useCallback(
    (flightIds: string[]): void => {
      const fs = lookupMany(flightIds);
      if (fs.length > 0) setSelection(fs);
    },
    [lookupMany, setSelection]
  );

  // Aktivität-sidebar row wiring.
  const handlePanelFlightSelect = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setSelection([f]);
    },
    [lookup, setSelection]
  );
  const handlePanelFlightDetails = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setEditingFlight(f);
    },
    [lookup]
  );
  const handlePanelCruiseSelect = useCallback(
    (cruise: Cruise): void => {
      setCruiseSelection(cruise);
    },
    [setCruiseSelection]
  );
  const handlePanelCruiseDetails = useCallback(
    (cruise: Cruise): void => {
      navigate(`/cruises/${cruise.id}`);
    },
    [navigate]
  );

  // Lodging pin click → detail page, same route LodgingTab's map pins and
  // the lodging list rows already navigate to.
  const handleLodgingClick = useCallback(
    (lodgingId: string): void => {
      navigate(`/lodging/${lodgingId}`);
    },
    [navigate]
  );

  const handleFlightSave = useCallback(
    async (id: string, updates: Partial<FlightInput>): Promise<void> => {
      await flightsApi.update(id, updates);
      // Refresh GeoJSON so the map reflects the edit; full-flight lookup
      // will catch up on the next mount.
      const collection = await flightsApi.getAllGeoJSON();
      setFlights(collection.features);
      setEditingFlight(null);
    },
    []
  );

  // Domain-gating: a disabled domain's data is never fetched, not just
  // hidden at render time.
  useEffect(() => {
    if (!isEnabled("flight")) return;
    let cancelled = false;
    flightsApi
      .getAllGeoJSON()
      .then((collection) => {
        if (!cancelled) setFlights(collection.features);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load GeoJSON", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Cruises are fetched so journey mode can group them with flights by tripId.
  useEffect(() => {
    if (!isEnabled("cruise")) return;
    let cancelled = false;
    cruiseApi
      .list({})
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load cruises", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Lodgings — fetched only when the domain is enabled, same domain-gating
  // contract as flights/cruises above (never fetched, not just hidden).
  useEffect(() => {
    if (!isEnabled("lodging")) return;
    let cancelled = false;
    listLodgings({})
      .then((list) => {
        if (!cancelled) setLodgings(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load lodgings", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Trips power the journey-mode selector (label = trip name).
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((list) => {
        if (!cancelled) setTrips(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load trips", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Current dashboard mode narrowed to AllMode; fall back to "overview" if the
  // active mode is from a different tab (shouldn't happen in practice but keeps
  // types sound).
  const allMode: AllMode = isAllMode(mode) ? mode : "overview";
  const visMode = ALL_MODE_TO_MAP_MODE[allMode];

  // Trips that actually have cross-domain data to render, in trip order.
  // The selector below lets the user pick which one journey mode shows.
  const journeyTrips = useMemo<Trip[]>(() => {
    if (allMode !== "journey") return [];
    const groups = groupByTripId(visibleFlights, visibleCruises);
    return trips.filter((trip) => groups[trip.id] !== undefined);
  }, [allMode, visibleFlights, visibleCruises, trips]);

  // Resolve the effective trip: the explicit selection if it still has data,
  // otherwise fall back to the first available trip so the map is never blank
  // when trips exist.
  const effectiveTripId = useMemo<string | null>(() => {
    if (journeyTrips.length === 0) return null;
    if (selectedTripId && journeyTrips.some((tr) => tr.id === selectedTripId)) {
      return selectedTripId;
    }
    return journeyTrips[0].id;
  }, [journeyTrips, selectedTripId]);

  // Journey layers: built only when journey mode is active, for the selected
  // (or first-available) cross-domain trip.
  const journeyLayers = useMemo<Layer[]>(() => {
    if (allMode !== "journey") return [];
    return buildJourneyLayers(visibleFlights, visibleCruises, effectiveTripId, cruiseColorConfig);
  }, [allMode, visibleFlights, visibleCruises, effectiveTripId, cruiseColorConfig]);

  // The ☰ Aktivität toggle stays top-left (it opens the activity sidebar).
  // Shifts right when the sidebar is open so it clears the panel.
  const activityToggle = (
    <button
      type="button"
      onClick={() => setSidebarOpen((prev) => !prev)}
      style={{
        position: "absolute",
        top: 12,
        left: sidebarOpen ? 340 : 12,
        zIndex: 30,
        padding: "6px 12px",
        borderRadius: 10,
        background: "rgba(22,27,34,0.85)",
        color: "var(--text-primary)",
        border: "1px solid var(--color-border)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "left 0.2s ease",
      }}
    >
      ☰ {t("dashboard:sidebar.activity")}
    </button>
  );

  // One colour-key row: a short line swatch (or, for a frequency ramp, a
  // slightly taller/wider gradient bar) + its label. `background` takes any
  // CSS colour OR gradient, so both row kinds share one renderer.
  const legendRow = (background: string, label: string, key: string, ramp = false): JSX.Element => (
    <span key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: ramp ? 24 : 14,
          height: ramp ? 4 : 2,
          background,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--text-primary)" }}>{label}</span>
    </span>
  );

  // Flight rows are DERIVED from the active colour config — never hardcoded.
  const flightLegendRows = buildFlightLegend(flightColorConfig).map((row) => {
    const label = t(FLIGHT_LEGEND_LABEL_KEY[row.slot]);
    if (row.kind === "ramp") {
      // Frequency mode: one gradient bar from the rarest to the most-flown
      // tier, using the very stops the arcs are painted with.
      const gradient = `linear-gradient(90deg, ${row.stops.map(rgbCss).join(", ")})`;
      return legendRow(gradient, label, `flight-${row.slot}`, true);
    }
    return legendRow(rgbCss(row.color), label, `flight-${row.slot}`);
  });

  // Cruise rows, same contract: DERIVED from the active cruise colour config,
  // never hardcoded. "perCruise" has no single colour, so it renders one honest
  // multi-hue swatch (hard colour stops, not a blend) with a "one colour per
  // cruise" label — enumerating every cruise would be a second sidebar.
  const cruiseLegendRows = buildCruiseLegend(cruiseColorConfig).map((row) => {
    const label = t(CRUISE_LEGEND_LABEL_KEY[row.slot]);
    if (row.kind === "multi") {
      const step = 100 / row.stops.length;
      const segments = row.stops
        .map((c, i) => `${rgbCss(c)} ${i * step}% ${(i + 1) * step}%`)
        .join(", ");
      return legendRow(`linear-gradient(90deg, ${segments})`, label, `cruise-${row.slot}`, true);
    }
    return legendRow(rgbCss(row.color), label, `cruise-${row.slot}`);
  });

  // Lodging has exactly one row — no colour mode to switch — but it is
  // still DERIVED from `buildLodgingLegend()`, the same function
  // `layers/lodgingPinsLayer.ts` resolves its pin colour through, so the
  // dot on the map and the swatch in the legend can never disagree.
  const lodgingLegendRows = buildLodgingLegend().map((row) =>
    legendRow(rgbCss(row.color), t("dashboard:legend.lodging"), `lodging-${row.slot}`)
  );

  // Colour key as a compact table pinned bottom-right — out of the top band
  // so it never collides with the globe's time histogram or the top-left
  // controls. Renders only the visible domains' rows.
  const legendTable = (flightsVisible || cruisesVisible || lodgingsVisible) && (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(22,27,34,0.85)",
        color: "var(--text-muted)",
        border: "1px solid var(--color-border)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {flightsVisible && flightLegendRows}
      {cruisesVisible && cruiseLegendRows}
      {lodgingsVisible && lodgingLegendRows}
    </div>
  );

  const activityPanel = (
    <UnifiedActivityPanel
      flights={visibleFlights}
      cruises={visibleCruises}
      isOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      onFlightSelect={handlePanelFlightSelect}
      onFlightDetails={handlePanelFlightDetails}
      onCruiseSelect={handlePanelCruiseSelect}
      onCruiseDetails={handlePanelCruiseDetails}
    />
  );

  const editModal = editingFlight !== null && (
    <FlightEditModal
      flight={editingFlight}
      isOpen={true}
      onClose={() => setEditingFlight(null)}
      onSave={handleFlightSave}
    />
  );

  // Journey-mode trip picker, centered at the top. Shows the available
  // cross-domain trips, or a hint when none exist.
  const journeySelector = (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
      }}
    >
      {journeyTrips.length > 0 ? (
        <select
          aria-label={t("dashboard:trips.selectLabel")}
          value={effectiveTripId ?? ""}
          onChange={(e) => setSelectedTripId(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-primary)",
            border: "1px solid var(--color-border)",
            fontSize: 13,
          }}
        >
          {journeyTrips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name || t("dashboard:trips.unnamed")}
            </option>
          ))}
        </select>
      ) : (
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        >
          {t("dashboard:trips.noTrips")}
        </div>
      )}
    </div>
  );

  // Journey mode takes over the map entirely: it injects its own cross-domain
  // layers and suppresses the internal cruise arcs that MapContainer3D would
  // otherwise render, so only the selected trip is shown.
  if (allMode === "journey") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D
          flights={[]}
          visMode="routes"
          extraLayers={journeyLayers}
          showInternalCruises={false}
          appearanceDomains={["flight", "cruise", "lodging"]}
          onFlightClick={handleFlightClick}
          onRouteClick={handleRouteClick}
          onFlightOpen={handlePanelFlightDetails}
          onCruiseOpen={(cruiseId) => navigate(`/cruises/${cruiseId}`)}
          cruisesOverride={visibleCruises}
          lodgingsOverride={visibleLodgings}
          onLodgingClick={handleLodgingClick}
          hideInfoPill
        />
        {activityToggle}
        {legendTable}
        {journeySelector}
        {activityPanel}
        {editModal}
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={visibleFlights}
        visMode={visMode}
        appearanceDomains={["flight", "cruise", "lodging"]}
        onFlightClick={handleFlightClick}
        onRouteClick={handleRouteClick}
        onFlightOpen={handlePanelFlightDetails}
        onCruiseOpen={(cruiseId) => navigate(`/cruises/${cruiseId}`)}
        cruisesOverride={visibleCruises}
        lodgingsOverride={visibleLodgings}
        onLodgingClick={handleLodgingClick}
        hideInfoPill
      />
      {activityToggle}
      {legendTable}
      {activityPanel}
      {editModal}
    </div>
  );
}
