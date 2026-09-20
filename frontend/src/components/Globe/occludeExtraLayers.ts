// The caller's own layers, made to respect the earth.
//
// `extraLayers` — the dashboard's tour paths, the Reise view's one trip —
// were appended to the globe's layer list raw. Every layer the globe builds
// itself carries `EarthOcclusionExtension`, which discards fragments past the
// horizon; the caller's did not, so a tour on the FAR side of the sphere drew
// straight through it, over the ocean the reader was actually looking at.
//
// Applied to whatever the caller passed rather than to a list of blessed
// types: the extension hooks `DECKGL_FILTER_GL_POSITION` and
// `DECKGL_FILTER_COLOR`, which every core layer supports, and its own header
// names PathLayer, ColumnLayer and IconLayer.

import type { Layer } from "@deck.gl/core";
import type {
  EarthOcclusionExtension,
  EarthOcclusionExtensionProps,
} from "./EarthOcclusionExtension";

export function occludeExtraLayers(
  layers: readonly Layer[],
  ext: EarthOcclusionExtension,
  props: EarthOcclusionExtensionProps
): readonly Layer[] {
  if (layers.length === 0) return layers;
  return layers.map((layer) => {
    // Anything that is not a real deck.gl layer goes through untouched rather
    // than taking the globe down with it — the overlay is the only thing that
    // can say what a caller actually handed us.
    if (typeof layer?.clone !== "function" || !layer.props) return layer;
    const existing = (layer.props.extensions ?? []) as unknown[];
    // Already occluding: cloning it in anyway would compile the same
    // injection twice for no change on screen.
    if (existing.includes(ext)) return layer;
    return layer.clone({
      ...props,
      extensions: [...existing, ext],
    } as Parameters<Layer["clone"]>[0]);
  });
}
