/** Collapsible MapLibre pin-picker map for `LocationInput` — extracted to
 * keep the parent under the project's file-size guideline. Plain
 * `react-map-gl/maplibre` `<Marker draggable>` + click-to-move, NOT deck.gl
 * (per the plan — the picker map stays a lightweight overlay-free widget). */
import { useEffect, useRef, type JSX } from "react";
import Map, { Marker, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { LocationCoordinates } from "./LocationInput";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface LocationMiniMapProps {
  value: LocationCoordinates | null;
  initialViewState: { longitude: number; latitude: number; zoom: number };
  /**
   * Bumped by the parent whenever a coordinate arrives from somewhere OTHER
   * than this map — a search hit, a pasted pair, a typed field. Only those
   * move the viewport; see the effect below for why the distinction matters.
   */
  focusNonce: number;
  compact: boolean;
  /** Overrides the compact/full height — the map-pick modal wants a tall map. */
  height?: number;
  ariaLabel: string;
  attributionLabel: string;
  onMapClick: (e: MapLayerMouseEvent) => void;
  onMarkerDragEnd: (e: { lngLat: { lng: number; lat: number } }) => void;
}

export function LocationMiniMap({
  value,
  initialViewState,
  focusNonce,
  compact,
  height,
  ariaLabel,
  attributionLabel,
  onMapClick,
  onMarkerDragEnd,
}: LocationMiniMapProps): JSX.Element {
  const mapRef = useRef<MapRef | null>(null);

  /**
   * Move the map to a coordinate that came from outside it.
   *
   * `initialViewState` is read ONCE, when the map mounts — react-map-gl treats
   * it as uncontrolled, so recomputing it in a useMemo changes nothing. Open
   * the picker first and search afterwards (the order the lodging form invites,
   * since the search field sits above the map) and the marker was placed
   * correctly on a map still showing the default world view: a pin that is
   * there and cannot be seen.
   *
   * Keyed on `focusNonce`, not on `value`, because the two sources of a new
   * coordinate deserve opposite treatment. A search result should be flown to.
   * A marker DRAG must not be — recentring under the cursor yanks the map away
   * mid-gesture, and the point is by definition already visible.
   */
  useEffect(() => {
    if (!value) return;
    mapRef.current
      ?.getMap()
      .easeTo({ center: [value.lon, value.lat], zoom: initialViewState.zoom, duration: 600 });
    // `value` is deliberately absent: a drag changes it and must NOT move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  return (
    <div
      className="relative rounded-md overflow-hidden border"
      style={{
        height: height ?? (compact ? 220 : 320),
        borderColor: "var(--color-border)",
        background: "var(--bg-elevated)",
      }}
      aria-label={ariaLabel}
    >
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: 0 }}
        onClick={onMapClick}
        attributionControl={false}
      >
        {value && (
          <Marker
            longitude={value.lon}
            latitude={value.lat}
            draggable
            onDragEnd={onMarkerDragEnd}
            anchor="bottom"
          >
            <div
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: "50% 50% 50% 0",
                background: "var(--accent, #ffc107)",
                border: "2px solid white",
                transform: "rotate(-45deg)",
                boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
              }}
            />
          </Marker>
        )}
      </Map>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-1 right-1 text-[10px]"
        style={{ color: "var(--text-muted)", textDecoration: "underline" }}
      >
        {attributionLabel}
      </a>
    </div>
  );
}

export default LocationMiniMap;
