import { useEffect, useRef, type JSX } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import { SharedMapOverlays } from "../../map/SharedMapOverlays";
import { useBasemapStyle } from "../../map/useBasemapStyle";
import type { MaintenanceProposal } from "../../../lib/api/suggestionPlugins";
import { Icon } from "../../ui/Icon";

/** Proposal pins: numbered like the list, stop and geocoder in their own colour. */
const COLOUR = { stop: "var(--ts-accent)", geocoder: "var(--ts-good)" };

/**
 * One archive row on a small map: where the archive puts it today (grey, if
 * anywhere) and each proposal as a numbered pin. With `onPick` a click picks a
 * position; it is still written only through "Übernehmen" and its confirmation.
 */
export default function MaintenanceMap({
  current,
  proposals,
  ariaLabel,
  attributionLabel,
  picked,
  onPick,
}: {
  current: { lat: number; lon: number } | null;
  proposals: MaintenanceProposal[];
  ariaLabel: string;
  attributionLabel: string;
  /** The position chosen so far (inbox editor); drawn as a pin. */
  picked?: { lat: number; lon: number } | null;
  /** With it, a click on the map picks a position — still written only after the confirmation. */
  onPick?: (at: { lat: number; lon: number }) => void;
}): JSX.Element {
  const mapStyle = useBasemapStyle();
  const mapRef = useRef<MapRef | null>(null);
  const points = [...(current ? [current] : []), ...proposals];
  const first = points[0] ?? { lat: 51, lon: 10 };

  // Fit the pins whenever the row (and so its points) changes.
  const key = points.map((p) => `${p.lat},${p.lon}`).join("|");
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.easeTo({ center: [first.lon, first.lat], zoom: 14, duration: 400 });
      return;
    }
    const lons = points.map((p) => p.lon);
    const lats = points.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 16, duration: 400 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the points
  }, [key]);

  return (
    <div
      className="relative rounded-md overflow-hidden border"
      style={{ height: 260, borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
      aria-label={ariaLabel}
      data-testid="maintenance-map"
    >
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: first.lon,
          latitude: first.lat,
          zoom: points.length ? 13 : 5,
        }}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: 0 }}
        attributionControl={false}
        onClick={onPick ? (e) => onPick({ lat: e.lngLat.lat, lon: e.lngLat.lng }) : undefined}
        cursor={onPick ? "crosshair" : undefined}
      >
        {picked && (
          <Marker longitude={picked.lon} latitude={picked.lat} anchor="bottom">
            <div aria-hidden style={{ lineHeight: 1, color: "var(--ts-accent)" }}>
              <Icon name="map-pin" size={24} />
            </div>
          </Marker>
        )}
        {current && (
          <Marker longitude={current.lon} latitude={current.lat} anchor="center">
            <div
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "var(--text-muted, #888)",
                border: "2px solid white",
              }}
            />
          </Marker>
        )}
        {proposals.map((p, i) => (
          <Marker key={`${p.source}-${i}`} longitude={p.lon} latitude={p.lat} anchor="center">
            <div
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: COLOUR[p.source],
                color: "white",
                border: "2px solid white",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i + 1}
            </div>
          </Marker>
        ))}
        <SharedMapOverlays />
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
