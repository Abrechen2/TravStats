// What a pointer landing on a native globe feature means (forgejo#331).
//
// deck.gl used to hand every handler a `PickingInfo` carrying the datum; a
// native feature carries only its key `k`, so the datum is looked up in the
// data the layer was built from. By key, not position: MapLibre swaps a
// source's data asynchronously, so a feature from the old data can still be
// under the pointer after the new data is the one we hold. Pure, so the mapping from "feature N of layer
// X" to "the card this opens" is testable without a map.

import type { PickingInfo } from "@deck.gl/core";
import type { GlobePinned, PointDatum, CruisePathDatum } from "../globeLayerTypes";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import type { NativeHitKind, NativeHitTarget } from "./nativeGlobeLayers";

export interface NativeHit {
  kind: NativeHitKind;
  /** The layer id deck.gl would have reported — the tooltip renderer keys on it. */
  deckId: string;
  object: unknown;
  target: NativeHitTarget;
}

export function resolveNativeHit(
  targets: ReadonlyMap<string, NativeHitTarget>,
  mapLayerId: string,
  key: unknown
): NativeHit | null {
  const target = targets.get(mapLayerId);
  if (!target || typeof key !== "string") return null;
  const object = target.byKey.get(key);
  if (object === undefined) return null;
  return { kind: target.kind, deckId: target.deckId, object, target };
}

/**
 * The pinned card a click opens, or null where there is none (a caller's own
 * layer — it has a hover tooltip and, optionally, its own click handler, but no
 * card on the globe). A line anchors at the clicked point; a dot at itself.
 */
export function pinnedFromHit(hit: NativeHit, clicked: [number, number]): GlobePinned | null {
  switch (hit.kind) {
    case "airport": {
      const d = hit.object as PointDatum;
      return { kind: "airport", data: d, anchorLngLat: [d.position[0], d.position[1]] };
    }
    case "port": {
      const d = hit.object as PointDatum;
      return { kind: "port", data: d, anchorLngLat: [d.position[0], d.position[1]] };
    }
    case "cruise":
      return { kind: "cruise", data: hit.object as CruisePathDatum, anchorLngLat: clicked };
    case "lodging": {
      const d = hit.object as Lodging;
      if (d.lat === null || d.lon === null) return null;
      return { kind: "lodging", data: d, anchorLngLat: [d.lon, d.lat] };
    }
    case "place": {
      const d = hit.object as Place;
      return { kind: "place", data: d, anchorLngLat: [d.lon, d.lat] };
    }
    case "extra":
      return null;
  }
}

export interface NativeHoverHandlers {
  airport: (info: PickingInfo<PointDatum>) => void;
  port: (info: PickingInfo<PointDatum>) => void;
  cruise: (info: PickingInfo<CruisePathDatum>) => void;
  /** Lodging and place pins and every caller-built layer: the flat map's tooltip renderer. */
  pin: (info: PickingInfo) => void;
}

/** A `PickingInfo` carrying what the tooltip handlers read. */
export function syntheticInfo(
  hit: NativeHit,
  x: number,
  y: number,
  coordinate?: [number, number]
): PickingInfo {
  return {
    object: hit.object,
    x,
    y,
    coordinate,
    layer: { id: hit.deckId },
  } as unknown as PickingInfo;
}

/** Route a hover to the handler that renders its tooltip. */
export function dispatchNativeHover(
  hit: NativeHit,
  x: number,
  y: number,
  handlers: NativeHoverHandlers
): void {
  const info = syntheticInfo(hit, x, y);
  switch (hit.kind) {
    case "airport":
      return handlers.airport(info as PickingInfo<PointDatum>);
    case "port":
      return handlers.port(info as PickingInfo<PointDatum>);
    case "cruise":
      return handlers.cruise(info as PickingInfo<CruisePathDatum>);
    case "extra": {
      // A layer that brought its own hover keeps it, as under deck.gl.
      const own = hit.target.extra?.layer.props.onHover as ((i: PickingInfo) => void) | undefined;
      return (own ?? handlers.pin)(info);
    }
    default:
      return handlers.pin(info);
  }
}
