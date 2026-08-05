// HTML overlay for airport / port IATA labels on the globe.
//
// Why not a deck.gl TextLayer? deck.gl 9's billboard TextLayer/IconLayer
// does not render under MapLibre's globe projection in interleaved mode
// (the same layer renders fine on the flat mercator map). Rather than
// fight the GPU path, we project each label to screen space in JS —
// exactly the `map.project()` + dot-product front-face cull the pinned
// detail card already uses — and position a plain DOM pill there.
//
// Performance: the positions are written straight to `node.style` inside
// the MapLibre `render` handler, bypassing React re-renders. MapLibre
// only emits `render` while the camera is actually moving, so a static
// globe costs nothing; a rotating one costs ~80 cheap style writes per
// frame.

import { useEffect, useMemo, useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { PointDatum } from "./globeLayerTypes";
import type { LabelsMode } from "../map/labelPriority";

const DEG = Math.PI / 180;

interface LabelPoint {
  /** Text drawn in the pill — IATA for airports, readable name for ports. */
  text: string;
  lng: number;
  lat: number;
  kind: "airport" | "port";
  /** Visit weight — higher wins when two labels would overlap. */
  weight: number;
}

interface PlacedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlobeLabelsOverlayProps {
  mapRef: React.RefObject<MapRef | null>;
  /** Attaches the render listener only once MapLibre is confirmed ready. */
  mapReady: boolean;
  airports: PointDatum[];
  ports: PointDatum[];
  /** off = no labels · important = greedy collision (busiest win) · all =
   *  every front-facing label, overlap allowed. */
  mode: LabelsMode;
}

// Sky-blue for ports, near-white for airports — ties each label to its
// marker colour (PORT_DOT_COLOR / AIRPORT_DOT_COLOR) without shouting.
const AIRPORT_TEXT = "rgba(255,255,255,0.94)";
const PORT_TEXT = "rgba(125,211,252,0.96)";

export function GlobeLabelsOverlay({
  mapRef,
  mapReady,
  airports,
  ports,
  mode,
}: GlobeLabelsOverlayProps): JSX.Element | null {
  const points = useMemo<LabelPoint[]>(() => {
    if (mode === "off") return [];
    const toPts = (arr: PointDatum[], kind: "airport" | "port"): LabelPoint[] =>
      arr
        .map((p) => ({
          // Ports carry a readable `label`; airports fall back to IATA.
          text: p.label ?? p.iata,
          lng: p.position[0],
          lat: p.position[1],
          kind,
          weight: p.size ?? 0,
        }))
        .filter((p) => p.text.length > 0);
    // Sort by weight desc so the busiest markers claim screen space first
    // during collision culling; ties keep airports ahead of ports.
    return [...toPts(airports, "airport"), ...toPts(ports, "port")].sort(
      (a, b) => b.weight - a.weight
    );
  }, [airports, ports, mode]);

  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || points.length === 0) return;

    const update = (): void => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const camLng = center.lng * DEG;
      const camLat = center.lat * DEG;
      // Camera surface-normal direction (unit vector from Earth centre).
      const camX = Math.cos(camLat) * Math.cos(camLng);
      const camY = Math.cos(camLat) * Math.sin(camLng);
      const camZ = Math.sin(camLat);
      // Same horizon threshold heuristic the pinned-card cull uses.
      const dist = 1 + 1.5 * Math.pow(2, -Math.max(0, zoom) * 0.7);
      const cosHorizon = 1.0 / Math.max(1.001, dist);

      // Greedy screen-space collision cull: points are pre-sorted by
      // weight, so the busiest markers place first and crowd out the
      // rest. Keeps the overview clean (no label soup) without a hard
      // zoom gate — labels reveal naturally as zooming spreads them out.
      const placed: PlacedBox[] = [];
      const LABEL_H = 16;
      // Breathing room around each pill so labels don't sit edge-to-edge
      // in dense clusters (e.g. the Mediterranean). The collision box is
      // inflated by this padding; the pill itself is still anchored on the
      // raw projected point below.
      const PAD_X = 4;
      const PAD_Y = 3;
      const overlaps = (b: PlacedBox): boolean => {
        for (let j = 0; j < placed.length; j++) {
          const q = placed[j];
          if (
            b.x < q.x + q.w &&
            b.x + b.w > q.x &&
            b.y < q.y + q.h &&
            b.y + b.h > q.y
          ) {
            return true;
          }
        }
        return false;
      };

      for (let i = 0; i < points.length; i++) {
        const node = nodeRefs.current[i];
        if (!node) continue;
        const pt = points[i];
        const aLng = pt.lng * DEG;
        const aLat = pt.lat * DEG;
        const cosLat = Math.cos(aLat);
        const dot =
          camX * (cosLat * Math.cos(aLng)) +
          camY * (cosLat * Math.sin(aLng)) +
          camZ * Math.sin(aLat);
        if (dot <= cosHorizon) {
          if (node.style.display !== "none") node.style.display = "none";
          continue;
        }
        const p = map.project([pt.lng, pt.lat]);
        // Estimate the pill box (centred on x, sitting above the dot),
        // inflated by the padding so neighbours keep a visible gap.
        const w = pt.text.length * 7 + 12;
        const box: PlacedBox = {
          x: p.x - w / 2 - PAD_X,
          y: p.y - 13 - LABEL_H - PAD_Y,
          w: w + PAD_X * 2,
          h: LABEL_H + PAD_Y * 2,
        };
        // "all" mode shows every front-facing label; "important" culls
        // overlaps so the busiest (pre-sorted) markers keep their labels.
        if (mode !== "all" && overlaps(box)) {
          if (node.style.display !== "none") node.style.display = "none";
          continue;
        }
        placed.push(box);
        if (node.style.display === "none") node.style.display = "";
        // Anchor the pill centred just above the marker dot.
        node.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y - 13}px)`;
      }
    };

    update();
    map.on("render", update);
    return () => {
      map.off("render", update);
    };
  }, [mapRef, mapReady, points, mode]);

  if (mode === "off" || points.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {points.map((pt, i) => (
        <div
          key={`${pt.kind}-${pt.text}-${i}`}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          className="absolute left-0 top-0 whitespace-nowrap rounded-sm font-semibold tabular-nums"
          style={{
            display: "none",
            fontSize: "11px",
            lineHeight: "14px",
            letterSpacing: "0.02em",
            padding: "1px 5px",
            color: pt.kind === "port" ? PORT_TEXT : AIRPORT_TEXT,
            background: "rgba(13,17,23,0.72)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.45)",
            backdropFilter: "blur(2px)",
          }}
        >
          {pt.text}
        </div>
      ))}
    </div>
  );
}
