import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, MapViewState } from "@deck.gl/core";
import { buildLodgingPins } from "../layers/lodgingPinsLayer";
import { useTranslation } from "../../hooks/useTranslation";
import type { Lodging } from "../../types/lodging";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface DeckOverlayProps {
  layers: Layer[];
}

function DeckGLOverlay({ layers }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

interface LodgingMiniMapProps {
  lodging: Lodging;
  /**
   * Renders a "set location now" button inside the no-location placeholder
   * (UAT finding B7) — typically opens the edit modal, whose search box and
   * map can fill the missing coordinates. Without it the placeholder is a
   * statement with no way to act on it.
   */
  onSetLocation?: () => void;
}

/**
 * Small single-pin map for the lodging detail page. Reuses the same
 * `buildLodgingPins` deck.gl layer as the dashboard map (Task 15) so the pin
 * styling stays consistent across the app — only the viewport is different
 * (centered/zoomed on this one lodging instead of fit-to-bounds over many).
 *
 * Renders a "no location" placeholder instead of a map when the lodging has
 * no coordinates yet (geocoding is best-effort and can fail/be skipped —
 * see `services/geo/nominatim.ts`).
 */
export function LodgingMiniMap({ lodging, onSetLocation }: LodgingMiniMapProps): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  const [mapLoaded, setMapLoaded] = useState(false);

  // buildLodgingPins now returns the pin ScatterplotLayer AND its name-label
  // TextLayer (Task 9) rather than a single layer — flatten straight through.
  const layers: Layer[] = useMemo(() => {
    return buildLodgingPins([lodging]) ?? [];
  }, [lodging]);

  if (lodging.lat === null || lodging.lon === null) {
    return (
      <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">
        <span>{t("lodging:detail.noLocation")}</span>
        {onSetLocation && (
          <button
            type="button"
            onClick={onSetLocation}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated,rgba(255,255,255,0.05))]"
          >
            {t("lodging:detail.setLocationNow")}
          </button>
        )}
      </div>
    );
  }

  const initialView: MapViewState = {
    longitude: lodging.lon,
    latitude: lodging.lat,
    zoom: 11,
    pitch: 0,
    bearing: 0,
  };

  return (
    <div className="relative h-40 w-full overflow-hidden rounded-md border border-[var(--color-border)]">
      <MapGL
        reuseMaps
        initialViewState={initialView}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} />}
      </MapGL>
    </div>
  );
}
