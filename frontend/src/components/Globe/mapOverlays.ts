// MapLibre style-level overlays toggled from the control panel.
//
// These manipulate the MapLibre style directly (sources / layers /
// layout visibility) rather than deck.gl, so they must be re-applied
// after every basemap style swap — MapLibre wipes custom sources and
// resets layout properties when the style is replaced. GlobeView calls
// `applyMapOverlays` on load, on `style.load`, and whenever a toggle
// changes.

import type { Map as MapLibreMap } from "maplibre-gl";
import { logger } from "../../lib/logger";

const HILLSHADE_SOURCE = "ts-hillshade";
const HILLSHADE_LAYER = "ts-hillshade";
// Esri World Hillshade — free, no API key, global coverage. Semi-opaque
// grey relief that reads on any basemap.
const HILLSHADE_TILES = [
  "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
];

/** Add or remove the hillshade relief overlay, kept below basemap labels. */
export function applyHillshade(map: MapLibreMap, show: boolean): void {
  try {
    if (show) {
      if (!map.getSource(HILLSHADE_SOURCE)) {
        map.addSource(HILLSHADE_SOURCE, {
          type: "raster",
          tiles: HILLSHADE_TILES,
          tileSize: 256,
          attribution: "Hillshade © Esri",
        });
      }
      if (!map.getLayer(HILLSHADE_LAYER)) {
        // Insert just below the first symbol layer so place names stay
        // legible on top of the relief (falls back to top of stack for
        // label-less raster styles).
        const firstSymbol = map
          .getStyle()
          .layers?.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: HILLSHADE_LAYER,
            type: "raster",
            source: HILLSHADE_SOURCE,
            paint: { "raster-opacity": 0.38 },
          },
          firstSymbol
        );
      }
    } else {
      if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER);
      if (map.getSource(HILLSHADE_SOURCE)) map.removeSource(HILLSHADE_SOURCE);
    }
  } catch (err) {
    logger.warn("GlobeView: applyHillshade failed", err);
  }
}

/** Toggle visibility of every basemap label (symbol) layer for a clean look. */
export function applyPlaceLabels(map: MapLibreMap, show: boolean): void {
  try {
    const layers = map.getStyle().layers;
    if (!layers) return;
    for (const layer of layers) {
      if (layer.type !== "symbol") continue;
      if (layer.id === HILLSHADE_LAYER) continue;
      map.setLayoutProperty(layer.id, "visibility", show ? "visible" : "none");
    }
  } catch (err) {
    logger.warn("GlobeView: applyPlaceLabels failed", err);
  }
}

export interface MapOverlayState {
  showTerrain: boolean;
  showPlaceLabels: boolean;
}

/** Apply both style-level overlays in one call. */
export function applyMapOverlays(map: MapLibreMap, state: MapOverlayState): void {
  applyHillshade(map, state.showTerrain);
  applyPlaceLabels(map, state.showPlaceLabels);
}
