import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { SharedMapOverlays } from "../../../components/map/SharedMapOverlays";
import { useBasemapStyle } from "../../../components/map/useBasemapStyle";
import { useTranslation } from "../../../hooks/useTranslation";
import { buildTrackLayers, tooltipOf, type TrackLayerInput } from "./trackMapLayers";
import { linesBounds, type LonLat } from "./trackGeometry";
import TrackFogLayer, { type FogStatus } from "./TrackFogLayer";

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers, getTooltip: tooltipOf }),
    { position: "top-left" }
  );
  overlay.setProps({ layers });
  return null;
}

export interface TrackRangeMapProps extends Omit<TrackLayerInput, "lines"> {
  /** All stretches of the range, for the frame; the drawn ones may be the replay's trail. */
  frameLines: readonly LonLat[][];
  lines: readonly LonLat[][];
  /** Where live follow wants the camera; null leaves the reader steering. */
  follow: LonLat | null;
  onFogStatus: (status: FogStatus) => void;
}

/**
 * The Track map (TravTrack plan T5.2): MapLibre with a deck.gl overlay through
 * `useControl`, never `<DeckGL>` (CLAUDE.md). Framed once on the range's
 * lines — the page remounts it per range — then the reader steers, except
 * while live follow moves the camera to the newest fix.
 */
export default function TrackRangeMap(props: TrackRangeMapProps): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const mapStyle = useBasemapStyle();
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const bounds = useMemo(() => linesBounds(props.frameLines), [props.frameLines]);
  const { layers, color, opacity, lines, segments, points, anchors, replay, onPoint } = props;
  const { photos, onPhoto, countries, highlight } = props;
  const deckLayers = useMemo(
    () =>
      buildTrackLayers({
        layers,
        color,
        opacity,
        lines,
        segments,
        points,
        anchors,
        replay,
        onPoint,
        photos,
        onPhoto,
        countries,
        highlight,
      }),
    [
      layers,
      color,
      opacity,
      lines,
      segments,
      points,
      anchors,
      replay,
      onPoint,
      photos,
      onPhoto,
      countries,
      highlight,
    ]
  );
  const follow = props.follow;

  // The camera moves only when the newest fix moved: a poll with the same answer leaves the reader's view.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!follow || !mapLoaded) return;
    const key = follow.join(",");
    if (key === followed.current) return;
    followed.current = key;
    mapRef.current?.easeTo({ center: follow, duration: 600 });
  }, [follow, mapLoaded]);

  if (!bounds) return null;
  return (
    <div
      className="relative h-[34rem] w-full overflow-hidden rounded-xl border border-[var(--color-border)]"
      data-testid="track-range-map"
      role="region"
      aria-label={t("track:day.map")}
    >
      <MapGL
        ref={mapRef}
        reuseMaps
        initialViewState={{
          bounds,
          fitBoundsOptions: { padding: { top: 40, right: 24, bottom: 40, left: 24 } },
        }}
        attributionControl={{ compact: true }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && layers.fog && <TrackFogLayer onStatus={props.onFogStatus} />}
        {mapLoaded && <DeckGLOverlay layers={deckLayers} />}
        <SharedMapOverlays />
      </MapGL>
      <span
        className="t-caption"
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          padding: "4px 8px",
          borderRadius: 6,
          background: "color-mix(in srgb, var(--ts-bg) 80%, transparent)",
          pointerEvents: "none",
        }}
      >
        {t("track:map.zonesNeverDrawn")}
      </span>
    </div>
  );
}
