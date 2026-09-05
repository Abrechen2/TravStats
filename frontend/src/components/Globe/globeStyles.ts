// Globe basemap catalogue — six tokenless styles, modelled after geojson.io.
// CARTO + OpenFreeMap + ESRI World Imagery + OSM Standard. None of them
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

const buildRasterStyle = (
  tiles: string[],
  attribution: string,
  maxzoom = 19
): StyleSpecification => ({
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom,
      attribution,
    },
  },
  layers: [
    {
      id: "base",
      type: "raster",
      source: "base",
    },
  ],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
});

export const STYLE_OPTIONS: StyleOption[] = [
  {
    id: "standard",
    label: "Standard",
    url: "https://tiles.openfreemap.org/styles/liberty",
    sky: SKY_LIGHT,
  },
  {
    id: "light",
    label: "Light",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    sky: SKY_LIGHT,
  },
  {
    id: "dark",
    label: "Dark",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    sky: SKY_DARK,
  },
  {
    id: "voyager",
    label: "Voyager",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    sky: SKY_VOYAGER,
  },
  {
    id: "satellite",
    label: "Satellite",
    url: buildRasterStyle(
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      "Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
    ),
    sky: SKY_SATELLITE,
  },
  {
    id: "osm",
    label: "OSM",
    url: buildRasterStyle(
      [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
    ),
    sky: SKY_LIGHT,
  },
];
