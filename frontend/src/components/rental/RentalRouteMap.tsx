import { useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { buildRentalDeckLayers, buildRentalLinks, buildRentalPoints } from "../layers/rentalLayer";
import { railBounds } from "../rail/RailRouteMap";
import { hexToRgb } from "../../lib/domainColor";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import type { RentalBooking } from "../../types/rental";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

/**
 * The detail page's map of one rental (rental spec §6, D1 a): one ringed
 * point when the car went back where it came from; two points and a dashed
 * link for a one-way rental — and a caption that says the link is NOT the
 * route driven. The colour is the domain colour store's.
 */
export function RentalRouteMap({ rental }: { rental: RentalBooking }): JSX.Element {
  const { t } = useTranslation(["rental"]);
  const { colorOf } = useDomainColors();
  const [mapLoaded, setMapLoaded] = useState(false);
  const color = colorOf("rental");
  const drawn = useMemo(() => ({ ...rental, status: "completed" as const }), [rental]);
  const layers = useMemo<Layer[]>(
    () =>
      buildRentalDeckLayers(buildRentalPoints([drawn]), buildRentalLinks([drawn]), {
        color: hexToRgb(color),
        idPrefix: "rental-detail",
      }),
    [drawn, color]
  );
  const bounds = useMemo(
    () =>
      railBounds([
        [rental.pickupLon, rental.pickupLat],
        [rental.returnLon, rental.returnLat],
      ]),
    [rental]
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-56 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="rental-route-map"
      >
        <MapGL
          reuseMaps
          initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
          mapStyle={DARK_MAP_STYLE}
          style={{ position: "absolute", inset: "0" }}
          onLoad={(): void => setMapLoaded(true)}
        >
          {mapLoaded && <DeckGLOverlay layers={layers} />}
        </MapGL>
      </div>
      <p className="t-caption" data-testid="rental-map-caption">
        {rental.oneWay
          ? rental.routeId
            ? t("rental:detail.mapRoadtrip")
            : t("rental:detail.mapOneWay")
          : t("rental:detail.mapSame")}
      </p>
    </div>
  );
}
