import { SharedMapOverlays } from "../map/SharedMapOverlays";
import { useBasemapStyle } from "../map/useBasemapStyle";
import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";
import { hexToRgb } from "../../lib/domainColor";
import { useDomainColors } from "../../hooks/useDomainColors";
import { allTrackLines, flightTrackBounds, flightTrackPieces } from "./flightTrackPaths";
import { flightTrackGreatCircle } from "./flightTrackGreatCircle";
import type { AirportPosition } from "./flownVsGreatCircle";

type Line = Array<[number, number]>;

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/** A dashed line in `color` — the connectors across holes and the great circle. */
function dashedLayer(
  id: string,
  data: Line[],
  color: [number, number, number, number],
  width: number,
  dash: [number, number]
): Layer {
  return new PathLayer<Line, PathStyleExtensionProps<Line>>({
    id,
    data,
    getPath: (d) => d,
    getColor: color,
    getWidth: width,
    widthUnits: "pixels",
    widthMinPixels: 1,
    getDashArray: dash,
    dashJustified: true,
    extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
    updateTriggers: { getColor: color },
  });
}

/**
 * The phone's recording of one flight — the `RailRouteMap` shape (MapLibre +
 * a deck.gl overlay through `useControl`, never `<DeckGL>`), in the flight
 * domain colour. Measured stretches are solid; the connectors across the
 * holes between them are dashed and fainter (`flightTrackPieces`). Beneath,
 * dashed and muted, the great circle between the two airports, so the eye
 * can tell where the flight went from where the straight line would have.
 */
export function FlightTrackMap({
  geometry,
  segmentStarts,
  departure,
  arrival,
}: {
  geometry: Array<[number, number]>;
  segmentStarts: number[];
  departure?: AirportPosition | null;
  arrival?: AirportPosition | null;
}): JSX.Element | null {
  const mapStyle = useBasemapStyle();
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("flight");
  const pieces = useMemo(
    () => flightTrackPieces(geometry, segmentStarts),
    [geometry, segmentStarts]
  );
  const greatCircle = useMemo(
    () => flightTrackGreatCircle(departure, arrival, geometry[0]),
    [departure, arrival, geometry]
  );
  const bounds = useMemo(() => flightTrackBounds(allTrackLines(pieces)), [pieces]);
  const layers = useMemo<Layer[]>(() => {
    const rgb = hexToRgb(color);
    return [
      dashedLayer(
        "flight-detail-great-circle",
        greatCircle ? [greatCircle] : [],
        [148, 163, 184, 150],
        1.5,
        [6, 4]
      ),
      dashedLayer("flight-detail-track-gaps", pieces.gaps, [...rgb, 140], 2, [4, 3]),
      new PathLayer<Line>({
        id: "flight-detail-track",
        data: pieces.solid,
        getPath: (d) => d,
        getColor: [...rgb, 255] as [number, number, number, number],
        getWidth: 3,
        widthUnits: "pixels",
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getColor: color },
      }),
    ];
  }, [pieces, greatCircle, color]);
  if (!bounds) return null;

  return (
    <div
      className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
      data-testid="flight-track-map"
    >
      <MapGL
        reuseMaps
        // The attribution sits over the bottom edge of this small map; framed
        // with the plain 24 px, a north-bound flight began under it (CJU→GMP
        // started at Jeju, hidden). The bottom inset clears it.
        initialViewState={{
          bounds,
          fitBoundsOptions: { padding: { top: 24, right: 24, bottom: 48, left: 24 } },
        }}
        attributionControl={{ compact: true }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} />}
        <SharedMapOverlays />
      </MapGL>
    </div>
  );
}
