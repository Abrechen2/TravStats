import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { SharedMapOverlays } from "../../components/map/SharedMapOverlays";
import { useBasemapStyle } from "../../components/map/useBasemapStyle";
import { RECORDING_RGB } from "../../components/Trips/recording/recordingLayers";
import { useTranslation } from "../../hooks/useTranslation";
import type { PrivacyZone, TrackPoint } from "../../lib/api/travtrack";
import type { DayAnchor } from "./trackContextLabel";

type Line = Array<[number, number]>;

/** Muted slate for the zone circles: a frame around nothing, not a place drawn. */
const ZONE_RGB: [number, number, number] = [148, 163, 184];

/** A label's words on hover; nothing for the lines and circles, which are not pickable. */
const tooltipOf = (info: PickingInfo): string | null =>
  (info.object as DayAnchor | undefined)?.text ?? null;

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers, getTooltip: tooltipOf }),
    { position: "top-left" }
  );
  overlay.setProps({ layers });
  return null;
}

/** A record of the logbook sits in the recording colour; a question or a bare stretch is hollow. */
const isOpen = (a: DayAnchor) => a.kind === "suggestion" || a.kind === "movement";

/** The day's stretches as map lines; a stretch of one fix draws nothing (no dots at world zoom). */
export function dayLines(segments: readonly TrackPoint[][]): Line[] {
  return segments
    .filter((s) => s.length > 1)
    .map((s) => s.map((p): [number, number] => [p[2], p[1]]));
}

/**
 * The frame around the day's lines. A day is a town walk as often as a
 * flight, so the margin follows the lines' own extent (a tenth of it, at
 * least ~500 m) instead of the flight map's fixed degrees, which framed a
 * walk through Berlin as half of Germany.
 */
export function dayBounds(lines: readonly Line[]): [[number, number], [number, number]] | null {
  const points = lines.flat();
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [west, east] = [Math.min(...lons), Math.max(...lons)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const pad = Math.max(0.005, (east - west) / 10, (north - south) / 10);
  return [
    [west - pad, Math.max(-90, south - pad)],
    [east + pad, Math.min(90, north + pad)],
  ];
}

/**
 * The day on the map (TravTrack plan T6): one line per stretch the server cut,
 * in the recording colour (`recordingLayers.ts` — a history is no domain), and
 * the account's own privacy zones as faint circles so the reader sees why a
 * line stops there. The day's labels (plan E10) sit at the anchors the server
 * chose — a record's own pin or a privacy-safe vertex, never inside a zone —
 * and name themselves on hover; a label without an anchor is in the timeline
 * only. MapLibre with a deck.gl overlay through `useControl`, never
 * `<DeckGL>` (CLAUDE.md).
 */
export default function TrackDayMap({
  segments,
  zones,
  anchors = [],
}: {
  segments: readonly TrackPoint[][];
  zones: readonly PrivacyZone[];
  anchors?: readonly DayAnchor[];
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const mapStyle = useBasemapStyle();
  const [mapLoaded, setMapLoaded] = useState(false);
  const lines = useMemo(() => dayLines(segments), [segments]);
  const bounds = useMemo(() => dayBounds(lines), [lines]);
  const layers = useMemo<Layer[]>(
    () => [
      new ScatterplotLayer<PrivacyZone>({
        id: "track-zones",
        data: [...zones],
        getPosition: (z) => [z.lon, z.lat],
        getRadius: (z) => z.radiusM,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [...ZONE_RGB, 40],
        getLineColor: [...ZONE_RGB, 180],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        pickable: false,
      }),
      new PathLayer<Line>({
        id: "track-day-lines",
        data: lines,
        getPath: (d) => d,
        getColor: [...RECORDING_RGB, 230],
        getWidth: 3,
        widthUnits: "pixels",
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
      new ScatterplotLayer<DayAnchor>({
        id: "track-day-labels",
        data: [...anchors],
        getPosition: (a) => [a.lon, a.lat],
        getRadius: 6,
        radiusUnits: "pixels",
        stroked: true,
        filled: true,
        getFillColor: (a) => (isOpen(a) ? [255, 255, 255, 230] : [...RECORDING_RGB, 255]),
        getLineColor: [...RECORDING_RGB, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        pickable: true,
      }),
    ],
    [lines, zones, anchors]
  );
  if (!bounds) return null;

  return (
    <div
      className="relative h-80 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
      data-testid="track-day-map"
      role="img"
      aria-label={t("track:day.map")}
    >
      <MapGL
        reuseMaps
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
