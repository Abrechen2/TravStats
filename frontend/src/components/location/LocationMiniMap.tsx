/** Collapsible MapLibre pin-picker map for `LocationInput` — extracted to
 * keep the parent under the project's file-size guideline. Plain
 * `react-map-gl/maplibre` `<Marker draggable>` + click-to-move, NOT deck.gl
 * (per the plan — the picker map stays a lightweight overlay-free widget). */
import type { JSX } from "react";
import Map, { Marker, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import type { LocationCoordinates } from "./LocationInput";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface LocationMiniMapProps {
  value: LocationCoordinates | null;
  initialViewState: { longitude: number; latitude: number; zoom: number };
  compact: boolean;
  ariaLabel: string;
  attributionLabel: string;
  onMapClick: (e: MapLayerMouseEvent) => void;
  onMarkerDragEnd: (e: { lngLat: { lng: number; lat: number } }) => void;
}

export function LocationMiniMap({
  value,
  initialViewState,
  compact,
  ariaLabel,
  attributionLabel,
  onMapClick,
  onMarkerDragEnd,
}: LocationMiniMapProps): JSX.Element {
  return (
    <div
      className="relative rounded-md overflow-hidden border"
      style={{
        height: compact ? 220 : 320,
        borderColor: "var(--color-border)",
        background: "var(--bg-elevated)",
      }}
      aria-label={ariaLabel}
    >
      <Map
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
