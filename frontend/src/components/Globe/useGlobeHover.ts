import { useCallback, useMemo, type RefObject } from "react";
import type { PickingInfo } from "@deck.gl/core";
import type { TFn } from "../map/cards/cardChrome";
import type { HoverTooltipApi } from "../map/cards/HoverTooltip";
import { airportHoverHtml, arcHoverHtml, portHoverHtml } from "../map/cards/hoverCardHtml";
import * as cruiseLegs from "../map/cards/journeys/cruiseLegJourneys";
import { createMarkerTooltip } from "../map/markerTooltip";
import type { ArcDatum, CruisePathDatum, PointDatum } from "./globeLayerTypes";

/**
 * The globe's five hover handlers. Hover content lives in
 * `map/cards/hoverCardHtml.ts` — the flat map draws the same tooltips, and it
 * had its own near-twin of each until the owner's 2026-09-20 ruling made the
 * globe the reference for map chrome. The tooltip itself is imperative
 * (HoverTooltip), so none of these touch React state.
 */
export function useGlobeHover(
  tooltipRef: RefObject<HoverTooltipApi | null>,
  t: TFn,
  locale: string
) {
  const onArcHover = useCallback(
    (info: PickingInfo<ArcDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        tooltipRef.current?.show({
          html: arcHoverHtml(info.object, { t }),
          x: info.x,
          y: info.y,
        });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, tooltipRef]
  );

  const onAirportHover = useCallback(
    (info: PickingInfo<PointDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        tooltipRef.current?.show({
          html: airportHoverHtml(
            {
              iata: d.iata,
              icao: d.icao,
              name: d.name,
              city: d.city,
              country: d.country,
              count: d.size,
              lastVisit: d.lastVisit,
            },
            { t, locale }
          ),
          x: info.x,
          y: info.y,
        });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, locale, tooltipRef]
  );

  const onPortHover = useCallback(
    (info: PickingInfo<PointDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        // No visit count on the globe's port tooltip: the pinned card answers
        // that, and the marker datum's `size` is a radius here, not a tally.
        tooltipRef.current?.show({
          html: portHoverHtml(
            {
              name: d.name,
              code: d.iata,
              city: d.city,
              country: d.country,
              lastVisit: d.lastVisit,
            },
            { t, locale }
          ),
          x: info.x,
          y: info.y,
        });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, locale, tooltipRef]
  );

  const onCruisePathHover = useCallback(
    (info: PickingInfo<CruisePathDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        tooltipRef.current?.show({
          html: cruiseLegs.cruiseLegHoverHtml(info.object, info.object.cruiseLabel, t),
          x: info.x,
          y: info.y,
        });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, tooltipRef]
  );

  // Hover on a lodging or place pin goes through the flat map's own tooltip
  // renderer, which already keys on the layer id (markerTooltip.ts) — a second
  // renderer for the same datum is a second thing that can disagree.
  const markerTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const onPinHover = useCallback(
    (info: PickingInfo): void => {
      const rendered = info.object ? markerTooltip(info) : null;
      if (rendered && info.x != null && info.y != null) {
        tooltipRef.current?.show({ html: rendered.html, x: info.x, y: info.y });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [markerTooltip, tooltipRef]
  );

  return { onArcHover, onAirportHover, onPortHover, onCruisePathHover, onPinHover };
}
