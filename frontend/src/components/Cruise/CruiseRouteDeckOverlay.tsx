import { useEffect } from "react";
import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { createMarkerTooltip } from "../map/markerTooltip";

interface DeckOverlayProps {
  layers: Layer[];
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  /**
   * Deck-level fallback click handler. deck.gl calls a picked layer's OWN
   * `onClick` first; only a pick that no layer's onClick handled (or that
   * returned falsy) reaches this root handler. The route editor's guide
   * line returns `true` on a successful insert, so it consumes its own
   * clicks — this handler only ever sees the ones nothing else claimed,
   * which is exactly the "click a leg to enter the editor" case.
   */
  onClick?: (info: PickingInfo) => void;
  /** Handed the overlay so a right-click can ask deck WHAT is under the
   *  cursor. A context menu arrives as a DOM event, not a deck pick, so
   *  without this there is no way to name the leg the user aimed at. */
  onReady?: (overlay: MapboxOverlay) => void;
}

export function DeckGLOverlay({ layers, getTooltip, onClick, onReady }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 5,
        getTooltip,
        onClick,
      }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, pickingRadius: 5, getTooltip, onClick });
  useEffect(() => {
    onReady?.(overlay);
  }, [overlay, onReady]);
  return null;
}
