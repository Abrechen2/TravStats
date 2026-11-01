import { useMemo } from "react";
import MapGL, { Layer, Marker, Source } from "react-map-gl/maplibre";
import { token } from "../../../components/ui";
import { SharedMapOverlays } from "../../../components/map/SharedMapOverlays";
import { useBasemapStyle } from "../../../components/map/useBasemapStyle";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanStation } from "../../../lib/api/travplan";

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

/** The route as the plan holds it: stations in order, joined by the chords the stages describe. */
export default function RouteMap({
  stations,
  handedOver,
}: {
  stations: PlanStation[];
  /** Stations already in the logbook are drawn in the "good" colour. */
  handedOver: ReadonlySet<string>;
}) {
  const { t } = useTranslation("travplan"),
    mapStyle = useBasemapStyle();
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
        reuseMaps
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
        {stations.map((s, i) => (
          <Marker key={s.id} longitude={s.place.lon} latitude={s.place.lat} anchor="center">
            <div
              title={s.title}
              style={{
                width: "1.75rem",
                height: "1.75rem",
                display: "grid",
                placeItems: "center",
                borderRadius: token("radius-pill"),
                background: handedOver.has(s.id) ? good : accent,
                color: ink,
                fontWeight: 700,
                fontSize: "0.8rem",
                border: `thick solid ${token("surface")}`,
              }}
            >
              {i + 1}
            </div>
          </Marker>
        ))}
        <SharedMapOverlays />
      </MapGL>
    </div>
  );
}
