import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useTranslation } from "../../../hooks/useTranslation";
import { listPlaces } from "../../../lib/api/places";
import { logger } from "../../../lib/logger";
import type { Place } from "../../../types/place";
import { buildPlacePins } from "../../layers/placePinsLayer";
import { buildPlaceLegend, PLACE_COLOR_MODES } from "../../../lib/placeColor";
import { usePlaceColorStore } from "../../../store/placeColorStore";
import { classifyPlace } from "../../../shared/placeCounting";
import MapContainer3D from "../../MapContainer3D";
import { DomainDisabledNotice } from "./DomainDisabledNotice";

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
  const { isEnabled } = useEnabledDomains();
  const poiEnabled = isEnabled("poi");
  const { t } = useTranslation(["dashboard"]);
  const colorConfig = usePlaceColorStore((s) => s.config);
  const setMode = usePlaceColorStore((s) => s.setMode);

  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      setPlaces(await listPlaces({}));
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

  const layers = useMemo<Layer[]>(() => {
    if (places.length === 0) return [];

    if (mode === "heatmap") {
      // Only places that actually count feed the heat map. A wishlist entry is
      // somewhere the user has NOT been, and letting it warm the map would
      // make the picture say the opposite of the truth
      // (shared/placeCounting.ts).
      const data: HeatDatum[] = places
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
      buildPlacePins(places, 1, 4, {
        onPinClick: handlePinClick,
        colors: colorConfig,
      }) ?? []
    );
  }, [places, mode, colorConfig, handlePinClick]);

  const legend = useMemo(() => buildPlaceLegend(colorConfig), [colorConfig]);

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
        // The appearance panel has no POI section yet, so offer none rather
        // than a section belonging to another domain.
        appearanceDomains={[]}
        hideInfoPill
      />

      {/* Colour-mode + legend. Both derive from the SAME store the pin layer
          resolves through, which is what makes a swatch and a pin unable to
          disagree (CLAUDE.md, map colour modes). */}
      {mode === "markers" && places.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 30,
            padding: "11px 13px",
            borderRadius: 10,
            background: "rgba(13,17,23,0.92)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", gap: 4, marginBottom: 9 }}>
            {PLACE_COLOR_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  padding: "4px 9px",
                  borderRadius: 6,
                  fontSize: 11,
                  border: "1px solid var(--color-border)",
                  background: colorConfig.mode === m ? "var(--bg-elevated)" : "transparent",
                  color: colorConfig.mode === m ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: colorConfig.mode === m ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {t(`dashboard:poi.colorMode.${m}`)}
              </button>
            ))}
          </div>
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
                {t(`dashboard:poi.legend.${row.slot}`)}
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
