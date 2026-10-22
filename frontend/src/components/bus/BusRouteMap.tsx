import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { SharedMapOverlays } from "../map/SharedMapOverlays";
import { useBasemapStyle } from "../map/useBasemapStyle";
import { buildTerminalRideLines } from "../Dashboard/tabs/terminalRideMapOverlay";
import { busPaths } from "../Trips/tripBusLayer";
import { railBounds } from "../rail/RailRouteMap";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import type { BusJourney } from "../../types/bus";

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

type RideLine = Pick<BusJourney, "geometry" | "geometrySource">;

/**
 * What the caption says, read off what the map DRAWS: the stored line where
 * there is one (as `busPaths` decides), else the chord. A source of `road`
 * with no stored line is drawn — and so named — as the chord.
 */
export function busLineCaptionKey(ride: RideLine): string {
  const drawn = Array.isArray(ride.geometry) && ride.geometry.length >= 2;
  if (!drawn) return "bus:detail.lineStraight";
  return ride.geometrySource === "manual" ? "bus:detail.lineManual" : "bus:detail.lineRoad";
}

/**
 * The detail page's map of one bus ride: the line the dashboard draws for it
 * (`buildTerminalRideLines` — the stored road, else the fainter chord between
 * the terminals), with a caption that says which. A reader must never take a
 * chord for the road the coach took.
 */
export function BusRouteMap({ ride }: { ride: BusJourney }): JSX.Element | null {
  const mapStyle = useBasemapStyle();
  const { t } = useTranslation(["bus"]);
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("bus");

  // Drawn as a travelled ride whatever its status: `busPaths` leaves a
  // cancelled ride off the dashboard, but its own page still shows where it went.
  const drawnRide = useMemo(() => ({ ...ride, status: "completed" }), [ride]);
  const layers = useMemo<Layer[]>(
    () => buildTerminalRideLines([drawnRide], color, false, "bus-detail", false),
    [drawnRide, color]
  );
  const path = useMemo(() => busPaths([drawnRide])[0]?.path ?? null, [drawnRide]);
  const bounds = useMemo(() => (path ? railBounds(path) : null), [path]);
  // A terminal without coordinates leaves nothing to frame; no map, not a world view.
  if (!bounds) return null;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="bus-route-map"
      >
        <MapGL
          reuseMaps
          initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: "0" }}
          onLoad={(): void => setMapLoaded(true)}
        >
          {mapLoaded && <DeckGLOverlay layers={layers} />}
          <SharedMapOverlays />
        </MapGL>
      </div>
      <p className="t-caption" data-testid="bus-line-source">
        {t(busLineCaptionKey(ride))}
      </p>
    </div>
  );
}
