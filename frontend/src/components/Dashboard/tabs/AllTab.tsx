import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useDashboardTours } from "../../../hooks/useDashboardTours";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useFlightLookup } from "../../../hooks/useFlightLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { cruiseApi } from "../../../lib/api/cruise";
import { flightsApi } from "../../../lib/api/flights";
import { listLodgings } from "../../../lib/api/lodging";
import { listPlaces } from "../../../lib/api/places";
import { listPlaceLists } from "../../../lib/api/placeLists";
import { resolvePlaceListColors } from "../../../lib/placeColor";
import type { PlaceList } from "../../../types/placeList";
import { tripsApi } from "../../../lib/api/trips";
import { buildTourPaths, type TourPathDatum } from "../../layers/tourPathsLayer";
import {
  buildTourDeckLayers,
  buildTourLegendRows,
  TourStatusOverlay,
  TOUR_PATH_GLOBE_ALTITUDE_M,
} from "./tourMapOverlay";
import {
  buildAirportPortLegendRows,
  buildCruiseLegendRows,
  buildFlightLegendRows,
  buildLodgingLegendRows,
  buildPoiLegendRows,
  legendRow,
} from "./allTabLegendRows";
import { MAP_LAYER_COLORS } from "../../../types/mapTheme";
import { logger } from "../../../lib/logger";
import { useCruiseColorStore } from "../../../store/cruiseColorStore";
import { useThemeStore } from "../../../store/themeStore";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import { useFlightColorStore } from "../../../store/flightColorStore";
import { useLodgingColorStore } from "../../../store/lodgingColorStore";
import { usePlaceColorStore } from "../../../store/placeColorStore";
import { usePlacesVisible } from "../../../hooks/usePlacesVisible";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import type { Flight, FlightInput, GeoJSONFeature, Trip } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import type { AllMode } from "../../../types/dashboard";
import { ALL_MODES } from "../../../types/dashboard";
import FlightEditModal from "../../FlightEditModal";
import MapContainer3D, { type MapMode } from "../../MapContainer3D";
import { classifyVisit } from "../../../shared/placeCounting";
import { buildJourneyLayers, groupByTripId } from "../modes/buildJourneyLayers";
import { UnifiedActivityPanel } from "../sidebars/UnifiedActivityPanel";
import type { ActivityItem } from "../sidebars/activityItems";
import { useLodgingSelectionStore } from "../../../store/lodgingSelectionStore";
import { usePlaceSelectionStore } from "../../../store/placeSelectionStore";
import type { Layer } from "@deck.gl/core";
import { ATTRIBUTION_CLEARANCE } from "../../map/attributionClearance";

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

/**
 * Bottom offset for map overlays in the attribution corner.
 *
 * MapLibre's attribution bar measured 44 px tall on the dashboard map; 52
 * leaves the same 8 px breathing room the rest of the overlay set uses. If the
 * bar ever grows (a second attribution line, a taller control), this is the one
 * number to change — verify by measuring, not by eye: compare the legend's
 * `getBoundingClientRect().bottom` against `.maplibregl-ctrl-bottom-right`.
 */
// Remembered per browser: a key someone shut should stay shut on the next
// visit, and it is a display preference rather than account state.
const LEGEND_OPEN_KEY = "dashboard.legendOpen";

export function AllTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const { t } = useTranslation(["dashboard"]);
  // The SAME store the map layers + both control panels read. The legend
  // cannot drift from the map because it is not a copy of the state — it is
  // the state, run through the same colour resolver.
  const flightColorConfig = useFlightColorStore((s) => s.config);
  const cruiseColorConfig = useCruiseColorStore((s) => s.config);
  const lodgingColorConfig = useLodgingColorStore((s) => s.config);
  // Same store `DeckGLMap` reads to colour the airport dot, so the key and the
  // map change together when the map theme changes.
  const themeColors = MAP_LAYER_COLORS[useThemeStore((s) => s.mapTheme)];
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { lookup, lookupMany } = useFlightLookup();
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const setLodgingSelection = useLodgingSelectionStore((s) => s.setSelection);
  const setPlaceSelection = usePlaceSelectionStore((s) => s.setSelection);
  const navigate = useNavigate();
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeLists, setPlaceLists] = useState<PlaceList[]>([]);
  // Remembered per browser, like the rest of the map's appearance. Someone who
  // closes the key on a crowded map means it, and having it reopen on every
  // navigation is the same annoyance one page later.
  const [legendOpen, setLegendOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(LEGEND_OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(LEGEND_OPEN_KEY, String(legendOpen));
    } catch {
      /* private mode or blocked site data — the choice just does not survive a reload */
    }
  }, [legendOpen]);
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
  const placeColorConfig = usePlaceColorStore((st) => st.config);
  // POI carries a second gate on top of the domain switch — the instance-level
  // beta flag. `usePlacesVisible` combines both, and hiding chrome fails closed
  // on "don't know yet" so a tab never flashes pins in and then loses them.
  const placesAllowed = usePlacesVisible();
  const placesVisible = filterDomains.includes("poi") && placesAllowed;

  // Tours have no domain pill — gated only by the beta flag;
  // `useDashboardTours` refuses to fetch while it is off.
  const { isFeatureVisible } = useBetaFeatures();
  const toursAllowed = isFeatureVisible("tourRoutes");
  const dashboardTours = useDashboardTours(toursAllowed);

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
      lodging.stays.some(
        (stay) =>
          // An undated stay overlaps no range: it is not known which days it
          // occupied. It reappears the moment the time filter is cleared,
          // rather than being shown under a range it may not belong to.
          stay.checkIn !== null &&
          stay.checkOut !== null &&
          intervalOverlapsRange(stay.checkIn, stay.checkOut, filterTime.from, filterTime.to)
      )
    );
  }, [lodgings, lodgingsVisible, filterTime.from, filterTime.to]);

  // Places filtered by VISIT date. Same policy as an undated lodging stay: a
  // place whose visits carry no date occupies no known day, so it steps aside
  // while a range is set and returns the moment it is cleared — rather than
  // being shown under a year it may not belong to.
  const visiblePlaces = useMemo<Place[]>(() => {
    if (!placesVisible) return [];
    if (!filterTime.from && !filterTime.to) return places;
    return places.filter((place) =>
      place.visits.some(
        (visit) =>
          visit.visitedAt !== null &&
          classifyVisit(visit) === "visited" &&
          intervalOverlapsRange(visit.visitedAt, visit.visitedAt, filterTime.from, filterTime.to)
      )
    );
  }, [places, placesVisible, filterTime.from, filterTime.to]);

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

  // Aktivität-sidebar row wiring. One click means the same thing in every
  // domain — focus and highlight on the map, never navigate. The arrow is what
  // leaves the dashboard. Lodgings used to break that rule: their rows were
  // plain links, so clicking a hotel threw the user off the map entirely.
  const handleActivitySelect = useCallback(
    (item: ActivityItem): void => {
      if ("flightId" in item.payload) {
        const f = lookup(item.payload.flightId);
        if (f) setSelection([f]);
      } else if ("cruise" in item.payload) {
        setCruiseSelection(item.payload.cruise);
      } else if ("lodging" in item.payload) {
        // A hotel whose location never resolved has no pin to focus. Selecting
        // it would silently do nothing, so the row says so instead (see the
        // `mappable` marker) and the click is a no-op rather than a lie.
        if (item.mappable) setLodgingSelection(item.payload.lodging);
      } else {
        setPlaceSelection(item.payload.place);
      }
    },
    [lookup, setSelection, setCruiseSelection, setLodgingSelection, setPlaceSelection]
  );

  /** The map speaks flight ids, the sidebar speaks activity rows — separate doors. */
  const handleFlightOpen = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setEditingFlight(f);
    },
    [lookup]
  );

  const handleActivityDetails = useCallback(
    (item: ActivityItem): void => {
      if ("flightId" in item.payload) {
        const f = lookup(item.payload.flightId);
        if (f) setEditingFlight(f);
      } else if ("cruise" in item.payload) {
        navigate(`/cruises/${item.payload.cruise.id}`);
      } else if ("lodging" in item.payload) {
        navigate(`/lodging/${item.payload.lodging.id}`);
      } else {
        navigate(`/places/${item.payload.place.id}`);
      }
    },
    [lookup, navigate]
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

  // Places — gated on `placesAllowed` rather than `isEnabled("poi")`, because
  // the instance beta flag can hide the domain from a user who has it on.
  // Never fetched while hidden, not merely not drawn.
  useEffect(() => {
    if (!placesAllowed) return;
    let cancelled = false;
    // Lists come WITH their entries, for the same reason the places tab asks
    // for them: a pin's colour and its symbol both come from the list it is in,
    // and membership is the only way to know which list that is.
    Promise.all([listPlaces({}), listPlaceLists(true)])
      .then(([list, lists]) => {
        if (cancelled) return;
        setPlaces(list);
        setPlaceLists(lists);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load places", err);
      });
    return () => {
      cancelled = true;
    };
  }, [placesAllowed]);

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

  // Tours on the main overview map only — journey mode already takes over
  // the map for ONE trip (`journeyLayers`); every tour on top would misdescribe it.
  const showTours = toursAllowed && allMode !== "journey";

  // `buildTourPaths` is the SAME builder `TripMap.tsx` uses; the deck.gl
  // layer itself comes from `buildTourDeckLayers` (`./tourMapOverlay.tsx`,
  // which also carries the width/alpha rationale).
  const tourPathData = useMemo<TourPathDatum[]>(
    () => (showTours ? buildTourPaths(dashboardTours.geometries) : []),
    [showTours, dashboardTours.geometries]
  );
  // Altitude-lifted on the globe only — see `TOUR_PATH_GLOBE_ALTITUDE_M`'s
  // doc comment (tourMapOverlay.tsx): an unlifted path z-fights with the
  // sphere mesh and draws zero pixels there (fix round 2, found in a real
  // browser). `visMode` already resolves "globe" vs "routes"/"heatmap"/
  // "journey" a few lines up.
  const tourLayers = useMemo<Layer[]>(
    () => buildTourDeckLayers(tourPathData, visMode === "globe" ? TOUR_PATH_GLOBE_ALTITUDE_M : 0),
    [tourPathData, visMode]
  );

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

  // `legendRow` (the swatch-JSX builder) now lives in `./allTabLegendRows.tsx`
  // itself, alongside the five builders below that take it as a parameter —
  // TourTab.tsx uses the exact same swatch shape and had its own inline
  // copy until the fix-round review (2026-08-30) pointed out the
  // duplication. Each builder is a pure function of its colour config, `t`,
  // and `legendRow` — split into that file to keep this one under its
  // 800-line ceiling (same reason as `tourMapOverlay.tsx`). Nothing about
  // WHAT they compute changed: same config in, same JSX out.
  // Colours and labels per place list. The POI legend names the lists the
  // map is actually painting, so both read the same resolution.
  const placeListContext = useMemo(() => resolvePlaceListColors(placeLists), [placeLists]);

  const flightLegendRows = buildFlightLegendRows(flightColorConfig, t, legendRow);
  const cruiseLegendRows = buildCruiseLegendRows(cruiseColorConfig, t, legendRow);
  const lodgingLegendRows = buildLodgingLegendRows(lodgingColorConfig, t, legendRow);
  // The lists are passed in: in "by list" mode the key has to NAME them, or the
  // only row is the negative one and every coloured pin stays unexplained.
  const poiLegendRows = buildPoiLegendRows(placeColorConfig, t, legendRow, placeListContext.used);
  const placeLegendRows = buildAirportPortLegendRows(
    flightsVisible,
    cruisesVisible,
    themeColors,
    t,
    legendRow
  );

  // See `buildTourLegendRows` (`./tourMapOverlay.tsx`) for why "empty"
  // shows no row here — `tourStatusOverlay` below carries loading/error.
  const tourLegend = buildTourLegendRows(showTours, dashboardTours, t, legendRow);
  const tourHasData = tourLegend.hasData;

  // Colour key as a compact table pinned bottom-right — out of the top band
  // so it never collides with the globe's time histogram or the top-left
  // controls. Renders only the visible domains' rows.
  //
  // The bottom offset clears MapLibre's attribution bar, which occupies the
  // same corner. At `bottom: 12` the key's lower rows sat ON the line reading
  // "MapLibre | © CARTO, © OpenStreetMap contributors" — measured at 32 px of
  // overlap (#273). That is not only untidy: CARTO and OpenStreetMap both
  // require the credit to stay visible, so covering it is a licence question,
  // not a cosmetic one. The other three map overlays in this app sit
  // bottom-LEFT and are unaffected.
  const legendRows = [
    ...(flightsVisible ? flightLegendRows : []),
    ...(cruisesVisible ? cruiseLegendRows : []),
    ...(lodgingsVisible ? lodgingLegendRows : []),
    ...(placesVisible ? poiLegendRows : []),
    ...placeLegendRows,
    // The tour rows join the same array rather than hanging outside it,
    // or they would sit below the collapsed panel and stay visible when
    // the key is shut — and be missing from the count on the button.
    ...(tourHasData ? tourLegend.rows : []),
  ];

  // Collapsible, like the map options beside it. The key grew a row per LIST
  // when "by list" colouring started naming them, and on a map with a dozen
  // lists it began covering the thing it explains (Alex, 2026-08-29).
  //
  // The count stays visible when collapsed. A bare chevron hides how much is
  // behind it, and a key is the one overlay where "there is more here" is the
  // whole point.
  const legendTable = legendRows.length > 0 && (
    <div
      style={{
        position: "absolute",
        bottom: ATTRIBUTION_CLEARANCE,
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
        maxHeight: legendOpen ? "min(60vh, 420px)" : undefined,
        overflowY: legendOpen ? "auto" : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setLegendOpen((open) => !open)}
        aria-expanded={legendOpen}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        <span>{t("dashboard:legend.title")}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!legendOpen && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{legendRows.length}</span>
          )}
          <span aria-hidden>{legendOpen ? "▾" : "▸"}</span>
        </span>
      </button>
      {legendOpen && legendRows}
    </div>
  );

  // Top-center, the same slot `journeySelector` uses in journey mode
  // (mutually exclusive with this: `showTours` is false there). See
  // `TourStatusOverlay` for why "empty" gets no banner of its own.
  const tourStatusOverlay = showTours && (
    <TourStatusOverlay
      loading={dashboardTours.toursLoading}
      error={dashboardTours.toursLoadError}
      onRetry={dashboardTours.reload}
      t={t}
    />
  );

  // The panel takes the same `visible*` collections the map does, so the domain
  // pills keep applying to both — that intersection is the "Alle" tab's own
  // contract and is deliberately NOT what a single-domain tab does.
  const activityPanel = (
    <UnifiedActivityPanel
      flights={visibleFlights}
      cruises={visibleCruises}
      lodgings={visibleLodgings}
      places={visiblePlaces}
      isOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      onSelect={handleActivitySelect}
      onDetails={handleActivityDetails}
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
          appearanceDomains={["flight", "cruise", "lodging", "poi"]}
          placesOverride={visiblePlaces}
          placeListColors={placeListContext.byPlaceId}
          placeListLabels={placeListContext.labelsByPlaceId}
          onPlaceClick={(placeId) => navigate(`/places/${placeId}`)}
          onFlightClick={handleFlightClick}
          onRouteClick={handleRouteClick}
          onFlightOpen={handleFlightOpen}
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
        extraLayers={tourLayers}
        appearanceDomains={["flight", "cruise", "lodging", "poi"]}
        placesOverride={visiblePlaces}
        placeListColors={placeListContext.byPlaceId}
        placeListLabels={placeListContext.labelsByPlaceId}
        onPlaceClick={(placeId) => navigate(`/places/${placeId}`)}
        onFlightClick={handleFlightClick}
        onRouteClick={handleRouteClick}
        onFlightOpen={handleFlightOpen}
        onCruiseOpen={(cruiseId) => navigate(`/cruises/${cruiseId}`)}
        cruisesOverride={visibleCruises}
        lodgingsOverride={visibleLodgings}
        onLodgingClick={handleLodgingClick}
        hideInfoPill
      />
      {activityToggle}
      {legendTable}
      {tourStatusOverlay}
      {activityPanel}
      {editModal}
    </div>
  );
}
