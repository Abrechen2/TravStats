// Shared basemap catalogue for the flat 2D map's basemap switcher.
//
// The globe keeps its own STYLE_OPTIONS in `Globe/globeStyles.ts` because it pairs each
// style with a globe-only `sky` config; this list is the same six styles
// without the sky, usable as a react-map-gl `mapStyle` (a URL string or a
// full StyleSpecification for the raster ones). All sources are key-free.

import type { StyleSpecification } from "maplibre-gl";

export type FlatStyleId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";

const buildRasterStyle = (
  tiles: string[],
  attribution: string,
  maxzoom = 19
): StyleSpecification => ({
  version: 8,
  sources: {
    base: { type: "raster", tiles, tileSize: 256, maxzoom, attribution },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
});

export interface FlatBasemap {
  id: FlatStyleId;
  label: string;
  style: string | StyleSpecification;
}

export const FLAT_BASEMAPS: readonly FlatBasemap[] = [
  { id: "standard", label: "Standard", style: "https://tiles.openfreemap.org/styles/liberty" },
  {
    id: "light",
    label: "Light",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  },
  {
    id: "dark",
    label: "Dark",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  },
  {
    id: "voyager",
    label: "Voyager",
    style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  },
  {
    id: "satellite",
    label: "Satellite",
    style: buildRasterStyle(
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      "Tiles &copy; Esri"
    ),
  },
  {
    id: "osm",
    label: "OSM",
    style: buildRasterStyle(
      [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      "&copy; OpenStreetMap contributors"
    ),
  },
];

export function resolveFlatStyle(id: FlatStyleId): string | StyleSpecification {
  return (FLAT_BASEMAPS.find((s) => s.id === id) ?? FLAT_BASEMAPS[2]).style;
}
