import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import MapGL, { Layer, Source } from "react-map-gl/maplibre";
import type { MapLibreEvent, Map as MapLibreMap } from "maplibre-gl";
import { SharedMapOverlays } from "../../components/map/SharedMapOverlays";
import { useBasemapStyle } from "../../components/map/useBasemapStyle";
import { token } from "../../components/ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import {
  trackErrorKey,
  travTrackApi,
  type ExploredBox,
  type ExploredCell,
} from "../../lib/api/travtrack";

/** The server's one resolution (plan L1): every cell is a zoom-14 tile. */
const ZOOM = 14;
const TILES = 2 ** ZOOM;
const MAX_LAT = 85;
/** The recording colour (`recordingLayers.ts`): explored ground is the history's own. */
const CELL_COLOR = "rgb(219, 39, 119)";
const FOG_COLOR = "rgb(15, 23, 42)";
const SETTLE_MS = 250;

const lonOf = (x: number) => (x / TILES) * 360 - 180;
const latOf = (y: number) => {
  const n = Math.PI - (2 * Math.PI * y) / TILES;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

/** One square polygon per tile — the map draws ground, never a point. */
export function cellsGeoJson(cells: readonly ExploredCell[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map(([x, y]) => {
      const [w, e, n, s] = [lonOf(x), lonOf(x + 1), latOf(y), latOf(y + 1)];
      return {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, n],
              [w, s],
              [e, s],
              [e, n],
              [w, n],
            ],
          ],
        },
      };
    }),
  };
}

/** The whole world under a veil; the explored tiles are drawn over it. */
const FOG: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, -MAX_LAT],
            [180, -MAX_LAT],
            [180, MAX_LAT],
            [-180, MAX_LAT],
            [-180, -MAX_LAT],
          ],
        ],
      },
    },
  ],
};

const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat: number) => Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));

/**
 * The map's bounds as the box the server reads: a view wider than the world
 * is the world; otherwise both edges are wrapped into one world, so a view
 * across the antimeridian becomes west > east.
 */
export function viewBox(b: ExploredBox): ExploredBox {
  const [south, north] = [clampLat(b.south), clampLat(b.north)];
  if (b.east - b.west >= 360) return { west: -180, south, east: 180, north };
  const west = b.west === 180 ? 180 : wrap(b.west);
  const east = b.east === 180 ? 180 : wrap(b.east);
  return { west, south, east, north };
}

/** The tiles' extent, for the first view. */
function cellsExtent(cells: readonly ExploredCell[]): [[number, number], [number, number]] {
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  return [
    [lonOf(Math.min(...xs)), latOf(Math.max(...ys) + 1)],
    [lonOf(Math.max(...xs) + 1), latOf(Math.min(...ys))],
  ];
}

type Status =
  { kind: "idle" } | { kind: "zoomIn" } | { kind: "preparing" } | { kind: "failed"; key: string };

const boundsOf = (map: MapLibreMap): ExploredBox => {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
};

/**
 * „Erkundet" (TravTrack plan L1): where the account has been, as zoom-14
 * tiles over a fog — no dots at any zoom, no time. The server draws privacy
 * zones as explored ground when explored tiles border them; the legend says
 * so. The tiles of the visible box are asked for after every move; a box with
 * more than one answer carries asks the reader to zoom in.
 */
export default function TrackExploredMap(): JSX.Element {
  const { t } = useTranslation(["track"]);
  const mapStyle = useBasemapStyle();
  const [cells, setCells] = useState<ExploredCell[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const request = useRef(0);
  const framed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const data = useMemo(() => cellsGeoJson(cells), [cells]);

  const load = useCallback((map: MapLibreMap) => {
    const id = ++request.current;
    travTrackApi
      .explored(viewBox(boundsOf(map)))
      .then((answer) => {
        if (id !== request.current) return;
        setStatus({ kind: "idle" });
        setCells(answer);
        // The first answer frames the explored ground once; after that the reader steers.
        if (!framed.current && answer.length > 0) {
          framed.current = true;
          map.fitBounds(cellsExtent(answer), { padding: 32, maxZoom: 12, duration: 0 });
        }
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        const key = trackErrorKey(err);
        if (key === "track:explored.zoomIn") setStatus({ kind: "zoomIn" });
        else if (key === "track:explored.preparing") {
          // Nothing is drawn until the server can answer the whole map.
          setCells([]);
          setStatus({ kind: "preparing" });
        } else if (key === "track:explored.unavailable") {
          // Refused whole: nothing of the map stays drawn.
          setCells([]);
          setStatus({ kind: "failed", key });
        } else {
          logger.warn("TravTrack explored map could not be loaded", err);
          setStatus({ kind: "failed", key });
        }
      });
  }, []);

  const settle = useCallback(
    (e: MapLibreEvent) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => load(e.target), SETTLE_MS);
    },
    [load]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-[28rem] w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="track-explored-map"
        role="img"
        aria-label={t("track:explored.map")}
      >
        <MapGL
          reuseMaps
          initialViewState={{ longitude: 10, latitude: 30, zoom: 1 }}
          attributionControl={{ compact: true }}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: "0" }}
          onLoad={(e): void => load(e.target)}
          onMoveEnd={settle}
        >
          <Source id="track-explored-fog-source" type="geojson" data={FOG}>
            <Layer
              id="track-explored-fog"
              type="fill"
              paint={{ "fill-color": FOG_COLOR, "fill-opacity": 0.45 }}
            />
          </Source>
          <Source id="track-explored-cells-source" type="geojson" data={data}>
            <Layer
              id="track-explored-cells"
              type="fill"
              paint={{ "fill-color": CELL_COLOR, "fill-opacity": 0.55 }}
            />
          </Source>
          <SharedMapOverlays />
        </MapGL>
      </div>
      {status.kind === "zoomIn" && (
        <p className="t-caption" role="status" style={{ color: token("warn") }}>
          {t("track:explored.zoomIn")}
        </p>
      )}
      {status.kind === "preparing" && (
        <p className="t-caption" role="status">
          {t("track:explored.preparing")}
        </p>
      )}
      {status.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(status.key)}
        </p>
      )}
      <p className="t-caption">{t("track:explored.legend")}</p>
      <p className="t-caption">{t("track:explored.zones")}</p>
    </div>
  );
}
