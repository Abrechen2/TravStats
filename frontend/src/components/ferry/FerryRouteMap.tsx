import { SharedMapOverlays } from "../map/SharedMapOverlays";
import { useBasemapStyle } from "../map/useBasemapStyle";
import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { buildTerminalRideMapLayers } from "../Dashboard/tabs/terminalRideMapOverlay";
import { busPaths } from "../Trips/tripBusLayer";
import { railBounds } from "../rail/RailRouteMap";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import type { FerryJourney } from "../../types/ferry";

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/** Which line the map draws, so the caption can say so. */
export type FerryLineKind = "seaRoute" | "drawn" | "straight";

/**
 * The line of one crossing, read by the rule the "Alle" map and the trip map
 * draw it by (`busPaths`): its stored line where there is one, else the chord
 * between the ports. Null only for a crossing whose ports have no coordinates.
 */
export function ferryMapLine(
  ride: FerryJourney
): { path: [number, number][]; kind: FerryLineKind } | null {
  // Drawn whatever its status: a cancelled crossing still has a route to show here.
  const [line] = busPaths([{ ...ride, status: "completed" }]);
  if (!line) return null;
  const kind: FerryLineKind = !line.routed
    ? "straight"
    : ride.geometrySource === "sea_route"
      ? "seaRoute"
      : "drawn";
  return { path: line.path, kind };
}

/**
 * The detail page's map of one crossing. The layers are the dashboard's own
 * (`buildTerminalRideMapLayers`), so the page cannot draw a crossing
 * differently from the map: the stored sea route where there is one, else the
 * faint chord between the ports. The caption says which — a reader must never
 * take a chord, or a schematic sea lane, for the track the ship sailed.
 */
export function FerryRouteMap({ ride }: { ride: FerryJourney }): JSX.Element | null {
  const mapStyle = useBasemapStyle();
  const { t } = useTranslation(["ferry"]);
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("ferry");
  const drawn = useMemo(() => ({ ...ride, status: "completed" }), [ride]);
  const layers = useMemo<Layer[]>(
    () => buildTerminalRideMapLayers([drawn], color, false, "ferry-detail", "important", "ferry"),
    [drawn, color]
  );
  const line = useMemo(() => ferryMapLine(ride), [ride]);
  if (!line) return null;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="ferry-route-map"
      >
        <MapGL
          reuseMaps
          initialViewState={{ bounds: railBounds(line.path), fitBoundsOptions: { padding: 24 } }}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: "0" }}
          onLoad={(): void => setMapLoaded(true)}
        >
          {mapLoaded && <DeckGLOverlay layers={layers} />}
          <SharedMapOverlays />
        </MapGL>
      </div>
      <p className="t-caption" data-testid="ferry-line-source">
        {t(`ferry:map.line.${line.kind}`)}
      </p>
    </div>
  );
}
