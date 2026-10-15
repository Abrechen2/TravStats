import { FLAT_BASEMAPS } from "../map/basemapStyles";
// Globe basemap catalogue — six tokenless styles, modelled after geojson.io.
// OpenFreeMap + ESRI World Imagery + OSM Standard. None of them
// require an API key.
//
// Each entry pairs the MapLibre style with a globe-only `sky` config, which
// is why this list is separate from the flat map's `map/basemapStyles.ts`:
// the flat map has no horizon to paint. `StyleId` is defined in and imported
// from GlobeControlPanel so the panel and the globe share one source of truth.

import type { StyleSpecification } from "maplibre-gl";
import type { StyleId } from "./GlobeControlPanel";

export interface SkyConfig {
  "sky-color": string;
  "horizon-color": string;
  "fog-color": string;
  "fog-ground-blend": number;
  "horizon-fog-blend": number;
  "sky-horizon-blend": number;
  "atmosphere-blend": number;
}

export interface StyleOption {
  id: StyleId;
  label: string;
  url: string | StyleSpecification;
  sky: SkyConfig;
}

const SKY_LIGHT: SkyConfig = {
  "sky-color": "#1e293b",
  "horizon-color": "#a8c0d6",
  "fog-color": "#e2e8f0",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_DARK: SkyConfig = {
  "sky-color": "#0a0e1a",
  "horizon-color": "#3b3f5e",
  "fog-color": "#1f2937",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_VOYAGER: SkyConfig = {
  "sky-color": "#1c2540",
  "horizon-color": "#7aa3c8",
  "fog-color": "#cfe0ee",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_SATELLITE: SkyConfig = {
  "sky-color": "#000814",
  "horizon-color": "#3a4a6e",
  "fog-color": "#0b1a2a",
  "fog-ground-blend": 0.4,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

export const STYLE_OPTIONS: StyleOption[] = FLAT_BASEMAPS.map(({ id, label, style }) => ({
  id,
  label,
  url: style,
  sky:
    id === "dark"
      ? SKY_DARK
      : id === "satellite"
        ? SKY_SATELLITE
        : id === "voyager"
          ? SKY_VOYAGER
          : SKY_LIGHT,
}));
