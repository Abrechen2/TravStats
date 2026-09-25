import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import {
  buildRailDeckLayers,
  buildRailPaths,
  buildRailStations,
  isTracedRailLine,
  railPathOf,
} from "../layers/railPathsLayer";
import { hexToRgb } from "../../lib/domainColor";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import type { RailJourney } from "../../types/rail";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
/** Degrees of margin around the line, so the stations never sit on the frame. */
const BOUNDS_PAD_DEG = 0.3;

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/** [[west, south], [east, north]] around every point of the line. */
export function railBounds(
  path: ReadonlyArray<[number, number]>
): [[number, number], [number, number]] {
  const lons = path.map((p) => p[0]);
  const lats = path.map((p) => p[1]);
  return [
    [Math.min(...lons) - BOUNDS_PAD_DEG, Math.min(...lats) - BOUNDS_PAD_DEG],
    [Math.max(...lons) + BOUNDS_PAD_DEG, Math.max(...lats) + BOUNDS_PAD_DEG],
  ];
}

/**
 * The detail page's map of one train ride, with a caption that says which
 * line it is: the one Transitous traced for this train, or the straight line
 * between the stations. A reader must never take a chord for the route.
 */
export function RailRouteMap({ journey }: { journey: RailJourney }): JSX.Element {
  const { t } = useTranslation(["rail"]);
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("rail");

  const layers = useMemo<Layer[]>(
    () =>
      buildRailDeckLayers(
        buildRailPaths([{ ...journey, status: "completed" }]),
        buildRailStations([{ ...journey, status: "completed" }]),
        {
          color: hexToRgb(color),
          idPrefix: "rail-detail",
          pickable: false,
        }
      ),
    [journey, color]
  );
  const bounds = useMemo(() => railBounds(railPathOf(journey)), [journey]);
  const traced = isTracedRailLine(journey);

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="rail-route-map"
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
      <p className="t-caption" data-testid="rail-line-source">
        {traced ? t("rail:detail.lineTraced") : t("rail:detail.lineStraight")}
      </p>
    </div>
  );
}
