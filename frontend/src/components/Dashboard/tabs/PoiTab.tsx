import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { UnifiedActivityPanel } from "../sidebars/UnifiedActivityPanel";
import type { ActivityItem } from "../sidebars/activityItems";
import { usePlaceSelectionStore } from "../../../store/placeSelectionStore";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useTranslation } from "../../../hooks/useTranslation";
import { listPlaces } from "../../../lib/api/places";
import { listPlaceLists } from "../../../lib/api/placeLists";
import { logger } from "../../../lib/logger";
import type { Place } from "../../../types/place";
import type { PlaceList } from "../../../types/placeList";
import { buildPlacePins } from "../../layers/placePinsLayer";
import { buildPlaceLegend, resolvePlaceListColors } from "../../../lib/placeColor";
import { usePlaceColorStore } from "../../../store/placeColorStore";
import { classifyPlace } from "../../../shared/placeCounting";
import MapContainer3D from "../../MapContainer3D";
import { DomainDisabledNotice } from "./DomainDisabledNotice";

/**
 * Bottom offset for overlays in MapLibre's attribution corner — the same
 * measurement the All tab documents: a 44 px bar plus the 8 px breathing room
 * the rest of the overlay set uses.
 */
const ATTRIBUTION_CLEARANCE = 52;

interface HeatDatum {
  position: [number, number];
  weight: number;
}

/**
 * The Places tab: pins or a heat map over everything the user has been to.
 *
 * The two modes were already registered in `types/dashboard.ts` while this
 * file was still a placeholder panel, so nothing there needed changing —
 * `markers` and `heatmap` are exactly what the stub reserved.
 */
export function PoiTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const navigate = useNavigate();
  // POI was the ONE tab with no entries list at all — there was nothing to
  // pick from, so "select it on the map" had no starting point here.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const setPlaceSelection = usePlaceSelectionStore((st) => st.setSelection);
  const { isEnabled } = useEnabledDomains();
  const poiEnabled = isEnabled("poi");
  const { t } = useTranslation(["dashboard"]);
  const colorConfig = usePlaceColorStore((s) => s.config);

  const [places, setPlaces] = useState<Place[]>([]);
  const [lists, setLists] = useState<PlaceList[]>([]);
  /** `null` = every place. A filter, not a mode: it changes WHICH pins are
   *  drawn, never what one means. */
  const [listFilter, setListFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      // Lists come WITH their entries: both the filter and `list` colour mode
      // need membership, and asking for it twice would be two round trips for
      // one answer.
      const [rows, listRows] = await Promise.all([listPlaces({}), listPlaceLists(true)]);
      setPlaces(rows);
      setLists(listRows);
    } catch (err: unknown) {
      logger.error({ err }, "PoiTab: failed to load places");
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Domain-gating: never fetch while the domain is off — the tab renders the
  // DomainDisabledNotice stub instead.
  useEffect(() => {
    if (!poiEnabled) {
      setLoading(false);
      return;
    }
    void load();
  }, [poiEnabled, load]);

  const handlePinClick = useCallback(
    (placeId: string) => {
      navigate(`/places/${placeId}`);
    },
    [navigate]
  );

  const listColors = useMemo(() => resolvePlaceListColors(lists), [lists]);

  const visiblePlaces = useMemo(() => {
    if (listFilter === null) return places;
    const members = new Set(
      (lists.find((l) => l.id === listFilter)?.entries ?? []).map((e) => e.placeId)
    );
    return places.filter((p) => members.has(p.id));
  }, [places, lists, listFilter]);

  const layers = useMemo<Layer[]>(() => {
    if (visiblePlaces.length === 0) return [];

    if (mode === "heatmap") {
      // Only places that actually count feed the heat map. A wishlist entry is
      // somewhere the user has NOT been, and letting it warm the map would
      // make the picture say the opposite of the truth
      // (shared/placeCounting.ts).
      const data: HeatDatum[] = visiblePlaces
        .filter((p) => classifyPlace(p) === "visited")
        .map((p) => ({
          position: [p.lon, p.lat],
          // A place visited five times weighs more than one visited once, but
          // never zero — a counted place with no dated visit must still show.
          weight: Math.max(1, p.visitCount),
        }));
      if (data.length === 0) return [];
      return [
        new HeatmapLayer<HeatDatum>({
          id: "place-heat",
          data,
          getPosition: (d) => d.position,
          getWeight: (d) => d.weight,
          radiusPixels: 45,
          intensity: 1,
          threshold: 0.05,
        }),
      ];
    }

    return (
      buildPlacePins(visiblePlaces, 1, 4, {
        onPinClick: handlePinClick,
        colors: colorConfig,
        listColors: listColors.byPlaceId,
      }) ?? []
    );
  }, [visiblePlaces, mode, colorConfig, listColors, handlePinClick]);

  const legend = useMemo(
    () => buildPlaceLegend(colorConfig, listColors.used),
    [colorConfig, listColors]
  );

  if (!poiEnabled) {
    return <DomainDisabledNotice domain="poi" />;
  }

  const isEmpty = !loading && !loadError && places.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={[]}
        visMode="routes"
        extraLayers={layers}
        // No flight or cruise geometry belongs on this tab; without this the
        // map fetches and draws every cruise route under the place pins.
        showInternalCruises={false}
        // The appearance panel now carries a POI section (colour mode +
        // colours), so this tab offers it rather than nothing. The overlay
        // below deliberately no longer duplicates the mode picker: two
        // controls for one setting is the drift the colour-mode contract
        // exists to prevent, even when both go through the same store.
        appearanceDomains={["poi"]}
        hideInfoPill
      />

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
          border: "1px solid var(--color-border)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ☰ {t("dashboard:sidebar.places")}
      </button>
      <UnifiedActivityPanel
        places={visiblePlaces}
        lockedKind="poi"
        title={t("dashboard:sidebar.places")}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={(item: ActivityItem) => {
          if ("place" in item.payload) setPlaceSelection(item.payload.place);
        }}
        onDetails={(item: ActivityItem) => {
          if ("place" in item.payload) navigate(`/places/${item.payload.place.id}`);
        }}
      />

      {/* Colour-mode + legend. Both derive from the SAME store the pin layer
          resolves through, which is what makes a swatch and a pin unable to
          disagree (CLAUDE.md, map colour modes). */}
      {mode === "markers" && places.length > 0 && (
        <div
          style={{
            position: "absolute",
            // BOTTOM-RIGHT, not bottom-left. The appearance panel is anchored
            // `bottom-4 left-4`, and this overlay sat straight on top of it the
            // moment the tab started offering a POI section — found by looking
            // at the map, not by any test. The offset clears MapLibre's
            // attribution bar, whose credit must stay legible for licence
            // reasons (same 52 px the All tab's legend uses).
            right: 12,
            bottom: ATTRIBUTION_CLEARANCE,
            zIndex: 30,
            padding: "11px 13px",
            borderRadius: 10,
            background: "rgba(13,17,23,0.92)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        >
          {lists.length > 0 && (
            <select
              value={listFilter ?? ""}
              onChange={(e) => setListFilter(e.target.value === "" ? null : e.target.value)}
              aria-label={t("dashboard:poi.listFilter")}
              style={{
                marginBottom: 9,
                width: "100%",
                padding: "4px 6px",
                borderRadius: 6,
                fontSize: 11,
                background: "var(--bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="">{t("dashboard:poi.allLists")}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 5 }}>
            {legend.map((row) => (
              <li
                key={row.slot}
                style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flex: "none",
                    // Hollow for the wishlist slot — the same shape encoding
                    // the pin layer uses, because teal against grey is below
                    // the colour-separation floor and shape is what actually
                    // carries this distinction.
                    background:
                      row.slot === "wishlist" ? "transparent" : `rgb(${row.color.join(",")})`,
                    border:
                      row.slot === "wishlist"
                        ? `1.5px dashed rgb(${row.color.join(",")})`
                        : "none",
                  }}
                />
                {row.label ?? t(`dashboard:poi.legend.${row.slot}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && (
        <div style={overlayStyle}>{t("dashboard:poi.loading")}</div>
      )}
      {loadError && (
        <div style={{ ...overlayStyle, color: "var(--danger)" }}>
          {t("dashboard:poi.loadError")}{" "}
          <button
            type="button"
            onClick={() => void load()}
            style={{
              marginLeft: 8,
              background: "transparent",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {t("dashboard:poi.retry")}
          </button>
        </div>
      )}
      {isEmpty && <div style={overlayStyle}>{t("dashboard:poi.empty")}</div>}
    </div>
  );
}

const overlayStyle = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 30,
  padding: "6px 14px",
  borderRadius: 10,
  background: "rgba(22,27,34,0.85)",
  color: "var(--text-muted)",
  border: "1px solid var(--color-border)",
  fontSize: 13,
} as const;
