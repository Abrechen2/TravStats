import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { logger } from "../../../lib/logger";
import { trackErrorKey, travTrackApi, type ExploredCell } from "../../../lib/api/travtrack";
import { cellsGeoJson, viewBox } from "../TrackExploredMap";
import { TRACK_RGB_CSS } from "./trackMapLayers";

/**
 * „Erkundet-Nebel" on the Track map (TravTrack plan T5.2): the world under a
 * veil with the explored zoom-14 tiles cut out of it, read from the existing
 * explored endpoint for the visible box. A refusal is reported as itself
 * (`onStatus`), never drawn as "nothing explored".
 */

export type FogStatus =
  { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "failed"; key: string };

const MAX_LAT = 85;
const WORLD: GeoJSON.Position[] = [
  [-180, -MAX_LAT],
  [180, -MAX_LAT],
  [180, MAX_LAT],
  [-180, MAX_LAT],
  [-180, -MAX_LAT],
];
const SETTLE_MS = 250;

/** One polygon: the world as the outer ring, each explored tile a hole in it. */
export function fogGeoJson(cells: readonly ExploredCell[]): GeoJSON.Feature {
  const holes = cellsGeoJson(cells).features.map(
    (f) => [...(f.geometry as GeoJSON.Polygon).coordinates[0]].reverse() as GeoJSON.Position[]
  );
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [WORLD, ...holes] },
  };
}

export default function TrackFogLayer({
  onStatus,
}: {
  onStatus: (status: FogStatus) => void;
}): JSX.Element | null {
  const { current } = useMap();
  const [cells, setCells] = useState<ExploredCell[] | null>(null);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const data = useMemo(() => (cells ? fogGeoJson(cells) : null), [cells]);
  // On a dark basemap a darker veil alone barely reads; the explored ground gets a light tint.
  const ground = useMemo(() => (cells ? cellsGeoJson(cells) : null), [cells]);

  const load = useCallback(() => {
    const map = current?.getMap();
    if (!map) return;
    const b = map.getBounds();
    const id = ++request.current;
    onStatus({ kind: "loading" });
    travTrackApi
      .explored(
        viewBox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })
      )
      .then((answer) => {
        if (id !== request.current) return;
        setCells(answer);
        onStatus({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        logger.warn("TravTrack fog could not be loaded", err);
        // A fog drawn from a stale or refused answer would claim ground as unexplored.
        setCells(null);
        onStatus({ kind: "failed", key: trackErrorKey(err) });
      });
  }, [current, onStatus]);

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const settle = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, SETTLE_MS);
    };
    load();
    map.on("moveend", settle);
    return () => {
      map.off("moveend", settle);
      if (timer.current) clearTimeout(timer.current);
      request.current++;
    };
  }, [current, load]);

  if (!data || !ground) return null;
  return (
    <>
      <Source id="track-fog-source" type="geojson" data={data}>
        <Layer
          id="track-fog"
          type="fill"
          paint={{ "fill-color": "rgb(11, 13, 16)", "fill-opacity": 0.7 }}
        />
      </Source>
      <Source id="track-fog-ground-source" type="geojson" data={ground}>
        <Layer
          id="track-fog-ground"
          type="fill"
          paint={{ "fill-color": TRACK_RGB_CSS, "fill-opacity": 0.18 }}
        />
      </Source>
    </>
  );
}
