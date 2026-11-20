// The trip map's number chips and direction arrows on the globe.
//
// deck.gl's billboard text and icon layers draw nothing under MapLibre's globe
// projection (see `Globe/GlobeLabelsOverlay.tsx`, whose approach this follows):
// each mark is a DOM node, projected with `map.project()` inside the MapLibre
// `render` handler and hidden once its point passes the horizon. An arrow is
// turned by projecting the point a little ahead of it, so it points the way the
// line runs ON SCREEN, which on a sphere is not the compass bearing.

import { useEffect, useRef, type JSX } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { ArrowDatum } from "./tripMapArrows";
import { TRIP_MAP_CHROME } from "./tripMapColors";

export interface GlobeChip {
  key: string;
  lng: number;
  lat: number;
  text: string;
  dim: boolean;
}

const DEG = Math.PI / 180;
const FAINT = 0.35;
/** Where the number chip sits against its dot, in pixels (the flat map's offset). */
const CHIP_OFFSET = 11;

interface Props {
  mapRef: React.RefObject<MapRef | null>;
  mapReady: boolean;
  chips: readonly GlobeChip[];
  arrows: readonly ArrowDatum[];
}

export function TripGlobeAnnotations({
  mapRef,
  mapReady,
  chips,
  arrows,
}: Props): JSX.Element | null {
  const chipNodes = useRef<(HTMLDivElement | null)[]>([]);
  const arrowNodes = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || (chips.length === 0 && arrows.length === 0)) return;
    const update = (): void => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const camLng = center.lng * DEG;
      const camLat = center.lat * DEG;
      const camX = Math.cos(camLat) * Math.cos(camLng);
      const camY = Math.cos(camLat) * Math.sin(camLng);
      const camZ = Math.sin(camLat);
      // The same horizon threshold the globe's label overlay uses.
      const dist = 1 + 1.5 * Math.pow(2, -Math.max(0, zoom) * 0.7);
      const cosHorizon = 1.0 / Math.max(1.001, dist);
      const facing = (lng: number, lat: number): boolean => {
        const cosLat = Math.cos(lat * DEG);
        return (
          camX * (cosLat * Math.cos(lng * DEG)) +
            camY * (cosLat * Math.sin(lng * DEG)) +
            camZ * Math.sin(lat * DEG) >
          cosHorizon
        );
      };
      chips.forEach((chip, i) => {
        const node = chipNodes.current[i];
        if (!node) return;
        if (!facing(chip.lng, chip.lat)) {
          node.style.display = "none";
          return;
        }
        const p = map.project([chip.lng, chip.lat]);
        node.style.display = "";
        node.style.transform = `translate(-50%, -50%) translate(${p.x + CHIP_OFFSET}px, ${p.y + CHIP_OFFSET}px)`;
      });
      arrows.forEach((arrow, i) => {
        const node = arrowNodes.current[i];
        if (!node) return;
        if (!facing(arrow.position[0], arrow.position[1])) {
          node.style.display = "none";
          return;
        }
        const p = map.project(arrow.position);
        const q = map.project(arrow.ahead);
        const angle = Math.atan2(q.y - p.y, q.x - p.x) / DEG + 90; // the chevron points up
        node.style.display = "";
        node.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) rotate(${angle}deg)`;
      });
    };
    update();
    map.on("render", update);
    return () => {
      map.off("render", update);
    };
  }, [mapRef, mapReady, chips, arrows]);

  if (chips.length === 0 && arrows.length === 0) return null;
  return (
    <div
      data-testid="trip-globe-annotations"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      {arrows.map((arrow, i) => (
        <div
          key={`arrow-${i}-${arrow.position.join(",")}`}
          data-testid="trip-globe-arrow"
          ref={(el) => {
            arrowNodes.current[i] = el;
          }}
          className="absolute left-0 top-0"
          style={{ display: "none", opacity: arrow.dim ? FAINT : 1 }}
        >
          <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M32 6 L56 54 L32 42 L8 54 Z" fill={`rgb(${arrow.color.join(",")})`} />
          </svg>
        </div>
      ))}
      {chips.map((chip, i) => (
        <div
          key={chip.key}
          data-testid="trip-globe-chip"
          ref={(el) => {
            chipNodes.current[i] = el;
          }}
          className="absolute left-0 top-0 rounded-sm px-1 text-[11px] font-bold leading-4 tabular-nums"
          style={{
            display: "none",
            opacity: chip.dim ? FAINT : 1,
            background: `rgb(${TRIP_MAP_CHROME.labelText.slice(0, 3).join(",")})`,
            color: `rgb(${TRIP_MAP_CHROME.outline.slice(0, 3).join(",")})`,
          }}
        >
          {chip.text}
        </div>
      ))}
    </div>
  );
}
