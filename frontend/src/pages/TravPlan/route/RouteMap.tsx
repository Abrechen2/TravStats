import { useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, Marker, Source, type MapRef } from "react-map-gl/maplibre";
import { Button, token } from "../../../components/ui";
import { SharedMapOverlays } from "../../../components/map/SharedMapOverlays";
import { useBasemapStyle } from "../../../components/map/useBasemapStyle";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanStation } from "../../../lib/api/travplan";
import { reuseMapsEnabled } from "../../../lib/mapReuse";

/**
 * MapLibre cannot read CSS custom properties, so the token is resolved to the colour the page is
 * drawn with right now. The fallback is a neutral grey, never a brand colour guessed here.
 */
function tokenColor(name: string): string {
  if (typeof document === "undefined") return "rgb(128, 128, 128)";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--ts-" + name)
    .trim();
  return value || "rgb(128, 128, 128)";
}

const FIT_PADDING = 56;
const MAX_ZOOM = 9;
/** Places closer than this (about 100 m) share one marker: Palermo arrived and Palermo left. */
const SAME_PLACE_DEG = 0.001;

export interface MarkerGroup {
  /** The first station at this place; tapping the marker opens it. */
  station: PlanStation;
  /** 1-based positions of every station at this place, in route order. */
  numbers: number[];
}

/** One marker per place, so a port the route leaves from again is not drawn twice on itself. */
export function markerGroups(stations: PlanStation[]): MarkerGroup[] {
  return stations.reduce<MarkerGroup[]>((groups, s, i) => {
    const same = groups.find(
      (g) =>
        Math.abs(g.station.place.lat - s.place.lat) < SAME_PLACE_DEG &&
        Math.abs(g.station.place.lon - s.place.lon) < SAME_PLACE_DEG
    );
    return same
      ? groups.map((g) => (g === same ? { ...g, numbers: [...g.numbers, i + 1] } : g))
      : [...groups, { station: s, numbers: [i + 1] }];
  }, []);
}

/** The route as the plan holds it: stations in order, joined by the chords the stages describe. */
export default function RouteMap({
  stations,
  handedOver,
  selectedId = null,
  onSelect,
}: {
  stations: PlanStation[];
  /** Stations already in the logbook are drawn in the "good" colour. */
  handedOver: ReadonlySet<string>;
  /** The station being looked at; its marker is ringed. */
  selectedId?: string | null;
  /** Tapping a marker opens its station. */
  onSelect?: (stationId: string) => void;
}) {
  const { t } = useTranslation("travplan"),
    mapStyle = useBasemapStyle(),
    mapRef = useRef<MapRef | null>(null);
  const line = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(
    () => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: stations.map((s) => [s.place.lon, s.place.lat]),
      },
    }),
    [stations]
  );
  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!stations.length) return null;
    const lons = stations.map((s) => s.place.lon),
      lats = stations.map((s) => s.place.lat);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  }, [stations]);
  // A route that grows or shrinks is shown whole again; the first frame uses initialViewState.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map && bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_ZOOM });
  }, [bounds]);
  const accent = tokenColor("accent"),
    good = tokenColor("good"),
    ink = tokenColor("accent-text");
  return (
    <div
      role="img"
      aria-label={t("route.map.label", { count: stations.length })}
      style={{
        position: "relative",
        height: "32rem",
        overflow: "hidden",
        borderRadius: token("radius-card"),
        border: `thin solid ${token("border")}`,
      }}
    >
      <MapGL
        ref={mapRef}
        reuseMaps={reuseMapsEnabled()}
        initialViewState={
          bounds
            ? { bounds, fitBoundsOptions: { padding: FIT_PADDING, maxZoom: MAX_ZOOM } }
            : { longitude: 10, latitude: 50, zoom: 3 }
        }
        attributionControl={{ compact: true }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: "0" }}
      >
        {stations.length > 1 && (
          <Source id="travplan-route" type="geojson" data={line}>
            <Layer
              id="travplan-route-line"
              type="line"
              paint={{ "line-color": accent, "line-width": 3, "line-opacity": 0.85 }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </Source>
        )}
        {markerGroups(stations).map(({ station: s, numbers }) => {
          const selected =
            selectedId !== null &&
            stations.some((x, i) => x.id === selectedId && numbers.includes(i + 1));
          return (
            <Marker key={s.id} longitude={s.place.lon} latitude={s.place.lat} anchor="center">
              <Button
                aria-label={t("route.map.marker", { n: numbers.join(", "), place: s.title })}
                onClick={() => onSelect?.(s.id)}
                style={{
                  minWidth: "2.25rem",
                  height: "2.25rem",
                  padding: "0 0.4rem",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: token("radius-pill"),
                  background: handedOver.has(s.id) ? good : accent,
                  color: ink,
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  border: `thick solid ${selected ? ink : token("surface")}`,
                  cursor: onSelect ? "pointer" : "default",
                }}
              >
                {numbers.join(" · ")}
              </Button>
            </Marker>
          );
        })}
        <SharedMapOverlays />
      </MapGL>
    </div>
  );
}
