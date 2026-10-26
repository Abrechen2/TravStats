import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Feature, Geometry } from "geojson";
import { useBasemapStyle } from "../../map/useBasemapStyle";
import type { TrackPoint } from "../../../lib/api/travtrack";
import { linesBounds, lonLat, type LonLat } from "../../../pages/Track/map/trackGeometry";
import { TRACK_RGB } from "../../../pages/Track/map/trackMapLayers";

/**
 * The section's small map (owner, 2026-10-26): the stretches as the server
 * cut them — one path per stretch, never one line through all — with a start
 * and an end marker, and, where the question has one, the stay's radius or
 * the country's outline. Nothing else: no privacy zone, no deleted span, no
 * other day. Not steerable; "Auf der Track-Karte öffnen" is for that.
 *
 * MapLibre with a deck.gl overlay through `useControl` (CLAUDE.md: never
 * `<DeckGL>`). Imported lazily by the panel, so the inbox loads no WebGL
 * until a card with a section is on screen.
 */

export interface SectionMapProps {
  stretches: readonly TrackPoint[][];
  label: string;
  ring?: { lat: number; lon: number; radiusM: number } | null;
  country?: Feature<Geometry> | null;
}

function Overlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/** The section's layers: country under the line, ring under the markers, one path per stretch. */
export function sectionLayers(props: Omit<SectionMapProps, "label">): Layer[] {
  const paths = props.stretches.map((s) => s.map(lonLat));
  const first = props.stretches[0]?.[0];
  const lastStretch = props.stretches[props.stretches.length - 1];
  const last = lastStretch?.[lastStretch.length - 1];
  const out: Layer[] = [];
  if (props.country) {
    out.push(
      new GeoJsonLayer({
        id: "section-country",
        data: { type: "FeatureCollection", features: [props.country] },
        filled: true,
        stroked: true,
        getFillColor: [...TRACK_RGB, 30],
        getLineColor: [231, 227, 220, 150],
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
      })
    );
  }
  if (props.ring) {
    out.push(
      new ScatterplotLayer<{ position: LonLat }>({
        id: "section-ring",
        data: [{ position: [props.ring.lon, props.ring.lat] }],
        getPosition: (d) => d.position,
        radiusUnits: "meters",
        getRadius: props.ring.radiusM,
        filled: true,
        stroked: true,
        getFillColor: [...TRACK_RGB, 30],
        getLineColor: [...TRACK_RGB, 220],
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
      })
    );
  }
  out.push(
    new PathLayer<LonLat[]>({
      id: "section-stretches",
      data: paths,
      getPath: (d) => d,
      getColor: [...TRACK_RGB, 255],
      widthUnits: "pixels",
      getWidth: 3,
      capRounded: true,
      jointRounded: true,
    })
  );
  const ends = [
    ...(first ? [{ position: lonLat(first), end: false }] : []),
    ...(last && last !== first ? [{ position: lonLat(last), end: true }] : []),
  ];
  out.push(
    new ScatterplotLayer<{ position: LonLat; end: boolean }>({
      id: "section-ends",
      data: ends,
      getPosition: (d) => d.position,
      radiusUnits: "pixels",
      getRadius: 6,
      filled: true,
      stroked: true,
      getFillColor: (d) => (d.end ? [...TRACK_RGB, 255] : [11, 13, 16, 255]),
      getLineColor: [...TRACK_RGB, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 3,
    })
  );
  return out;
}

export default function SectionMap(props: SectionMapProps): JSX.Element | null {
  const mapStyle = useBasemapStyle();
  const [loaded, setLoaded] = useState(false);
  const { stretches, ring, country } = props;
  const bounds = useMemo(() => {
    const lines = stretches.map((s) => s.map(lonLat));
    return linesBounds(ring ? [...lines, [[ring.lon, ring.lat]]] : lines);
  }, [stretches, ring]);
  const layers = useMemo(
    () => sectionLayers({ stretches, ring, country }),
    [stretches, ring, country]
  );
  if (!bounds) return null;
  return (
    <div
      className="relative h-56 w-full overflow-hidden rounded-xl border border-[var(--color-border)]"
      role="img"
      aria-label={props.label}
      data-testid="section-map"
    >
      <MapGL
        initialViewState={{ bounds, fitBoundsOptions: { padding: 28 } }}
        interactive={false}
        attributionControl={{ compact: true }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setLoaded(true)}
      >
        {loaded && <Overlay layers={layers} />}
      </MapGL>
    </div>
  );
}
