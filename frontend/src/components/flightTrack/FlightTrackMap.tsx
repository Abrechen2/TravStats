import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { hexToRgb } from "../../lib/domainColor";
import { useDomainColors } from "../../hooks/useDomainColors";
import { flightTrackBounds, flightTrackPaths } from "./flightTrackPaths";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/**
 * The phone's recording of one flight, drawn as the stretches it recorded —
 * the `RailRouteMap` shape (MapLibre + a deck.gl overlay through
 * `useControl`, never `<DeckGL>`), in the flight domain colour.
 */
export function FlightTrackMap({
  geometry,
  segmentStarts,
}: {
  geometry: Array<[number, number]>;
  segmentStarts: number[];
}): JSX.Element | null {
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("flight");
  const paths = useMemo(() => flightTrackPaths(geometry, segmentStarts), [geometry, segmentStarts]);
  const bounds = useMemo(() => flightTrackBounds(paths), [paths]);
  const layers = useMemo<Layer[]>(
    () => [
      new PathLayer<[number, number][]>({
        id: "flight-detail-track",
        data: paths,
        getPath: (d) => d,
        getColor: [...hexToRgb(color), 255] as [number, number, number, number],
        getWidth: 3,
        widthUnits: "pixels",
        widthMinPixels: 2,
        updateTriggers: { getColor: color },
      }),
    ],
    [paths, color]
  );
  if (!bounds) return null;

  return (
    <div
      className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
      data-testid="flight-track-map"
    >
      <MapGL
        reuseMaps
        initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} />}
      </MapGL>
    </div>
  );
}
