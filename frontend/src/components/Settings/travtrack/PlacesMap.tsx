import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL from "react-map-gl/maplibre";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { DeckGLOverlay } from "../../map/DeckGLOverlay";
import { useBasemapStyle } from "../../map/useBasemapStyle";
import type { FixedPlace } from "../../../lib/api/travtrackPlaces";
import type { PrivacyZone } from "../../../lib/api/travtrack";
import { linesBounds, type LonLat } from "../../../pages/Track/map/trackGeometry";
import { PLACE_RGB, ZONE_RGB } from "./placeColors";

/**
 * The small map beside the fixed places (spec 2026-11-05-travtrack-web-redesign
 * §Settings, mock-up Settings.dc.html): each place as a circle of its radius in
 * its kind's colour, privacy zones dashed red and unfilled. A click on a circle
 * hands the place to the list's editor. MapLibre with a deck.gl overlay through
 * `useControl` (CLAUDE.md: never `<DeckGL>`); imported lazily by the section.
 */

export interface MappedPlace extends FixedPlace {
  lat: number;
  lon: number;
}

export const hasPosition = (p: FixedPlace): p is MappedPlace => p.lat !== null && p.lon !== null;

const METRES_PER_DEG_LAT = 111_195;
const RING_STEPS = 64;

/** A closed ring of `RING_STEPS` vertices, for the dashed zone outline. */
export function circlePath(lon: number, lat: number, radiusM: number): LonLat[] {
  const dLat = radiusM / METRES_PER_DEG_LAT;
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: RING_STEPS + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / RING_STEPS;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
}

export function placeLayers(
  places: readonly MappedPlace[],
  zones: readonly PrivacyZone[],
  pickable: boolean
): Layer[] {
  return [
    new ScatterplotLayer<MappedPlace>({
      id: "place-circles",
      data: [...places],
      getPosition: (p) => [p.lon, p.lat],
      radiusUnits: "meters",
      getRadius: (p) => p.radiusM,
      radiusMinPixels: 6,
      filled: true,
      stroked: true,
      getFillColor: (p) => [...PLACE_RGB[p.kind], 40],
      getLineColor: (p) => [...PLACE_RGB[p.kind], 255],
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      pickable,
    }),
    new PathLayer<PrivacyZone, PathStyleExtensionProps<PrivacyZone>>({
      id: "zone-outlines",
      data: [...zones],
      getPath: (z) => circlePath(z.lon, z.lat, z.radiusM),
      getColor: [...ZONE_RGB, 255],
      widthUnits: "pixels",
      getWidth: 1.5,
      getDashArray: [4, 4],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
    }),
  ];
}

export interface PlacesMapProps {
  places: readonly MappedPlace[];
  zones: readonly PrivacyZone[];
  label: string;
  /** Present when the viewer may edit: a circle then opens that place's editor. */
  onPick?: (placeId: string) => void;
}

export default function PlacesMap({
  places,
  zones,
  label,
  onPick,
}: PlacesMapProps): JSX.Element | null {
  const mapStyle = useBasemapStyle();
  const [loaded, setLoaded] = useState(false);
  const bounds = useMemo(
    () =>
      linesBounds([
        ...places.map((p) => circlePath(p.lon, p.lat, p.radiusM)),
        ...zones.map((z) => circlePath(z.lon, z.lat, z.radiusM)),
      ]),
    [places, zones]
  );
  const layers = useMemo(
    () => placeLayers(places, zones, onPick !== undefined),
    [places, zones, onPick]
  );
  if (!bounds) return null;
  const pick = (info: PickingInfo): void => {
    const hit = info.object as MappedPlace | undefined;
    if (onPick && hit && info.layer?.id === "place-circles") onPick(hit.id);
  };
  return (
    <div
      className="relative h-64 w-full overflow-hidden rounded-xl border border-[var(--color-border)]"
      role="img"
      aria-label={label}
      data-testid="places-map"
    >
      <MapGL
        initialViewState={{ bounds, fitBoundsOptions: { padding: 32, maxZoom: 16 } }}
        scrollZoom={false}
        attributionControl={{ compact: true }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setLoaded(true)}
      >
        {loaded && <DeckGLOverlay layers={layers} onClick={pick} />}
      </MapGL>
    </div>
  );
}
