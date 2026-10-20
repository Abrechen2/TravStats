// The trip map's click card — the dashboard's `PinnedCard`, anchored on the
// clicked [lng, lat] and re-projected as the camera moves, exactly as the flat
// dashboard map does it (forgejo#323). Its own component so `TripMap.tsx`,
// close to the 800-line limit, gains one line rather than a block.

import { useCallback, useEffect, useState, type JSX, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { PinnedCard } from "../map/cards/PinnedCard";
import { PinnedCardBoundary } from "../map/cards/PinnedCardBoundary";
import type { MapPinned } from "../map/cards/pinnedTypes";
import { useMapCardSelectionStore } from "../../store/mapCardSelectionStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useToursVisible } from "../../hooks/useToursVisible";
import { layerCardAllowed } from "../map/cards/useMapSelectionCards";

const NO_FLIGHTS: never[] = [];

export function TripMapCardHost({
  mapRef,
  mapLoaded,
}: {
  mapRef: RefObject<MapRef | null>;
  mapLoaded: boolean;
}): JSX.Element | null {
  const selected = useMapCardSelectionStore((s) => s.pinned);
  const seq = useMapCardSelectionStore((s) => s.seq);
  const clear = useMapCardSelectionStore((s) => s.clear);
  // Only what was clicked on THIS map: a selection older than the mount
  // belongs to some other map (see `mapCardSelectionStore`).
  const [mountSeq] = useState(() => useMapCardSelectionStore.getState().seq);
  const { isEnabled } = useEnabledDomains();
  const toursVisible = useToursVisible();
  // A domain the user switched off shows no card here either, open or new.
  const pinned: MapPinned | null =
    selected && seq > mountSeq && layerCardAllowed(selected, isEnabled, toursVisible)
      ? selected
      : null;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const project = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map || !pinned) {
      setPos(null);
      return;
    }
    const pt = map.project(pinned.anchorLngLat);
    setPos({ x: pt.x, y: pt.y });
  }, [mapRef, pinned]);

  useEffect(() => {
    project();
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;
    map.on("move", project);
    return () => {
      map.off("move", project);
    };
  }, [project, mapRef, mapLoaded]);

  if (!pinned || !pos) return null;
  return (
    <div
      className="absolute z-30 pointer-events-auto"
      data-testid="trip-map-card"
      style={{ left: pos.x, top: pos.y, transform: "translate(-50%, calc(-100% - 14px))" }}
    >
      <PinnedCardBoundary>
        <PinnedCard pinned={pinned} flights={NO_FLIGHTS} cruises={NO_FLIGHTS} onClose={clear} />
      </PinnedCardBoundary>
    </div>
  );
}
