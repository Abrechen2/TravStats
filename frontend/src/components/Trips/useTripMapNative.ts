import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { HoverTooltipApi } from "../map/cards/HoverTooltip";
import type { createMarkerTooltip } from "../map/markerTooltip";
import { useNativeGlobe } from "../Globe/native/useNativeGlobe";
import type { NativeGlobeInput } from "../Globe/native/nativeGlobeLayers";
import { ALL_ROUTES_VISIBLE } from "../../lib/mapRoutes";
import { DEFAULT_AIRPORT_COLOR, DEFAULT_PORT_COLOR } from "../Globe/buildGlobeLayers";
import { applyHoverCursor } from "../map/mapCursor";

/** The trip map has none of the dashboard globe's own sources; only the layers it hands over. */
const NONE: readonly never[] = [];
const NO_LODGING_COLORS = {} as NativeGlobeInput["lodgingColors"];
const NO_PLACE_COLORS = {} as NativeGlobeInput["placeColors"];

function noop(): void {
  /* the trip map's native layers are all caller layers: only `pin` is ever called */
}

/**
 * The trip map's ground data (dots, cruise legs, tour sections) as native
 * MapLibre layers on the globe (forgejo#331) — deck.gl lifted them 5-8 km off
 * the surface, which floats visibly at close zoom. Hover answers through the
 * same tooltip renderer the flat map uses; a click runs the layer's own card
 * handler and then the camera move, as deck.gl's picking used to.
 */
export function useTripMapNative(opts: {
  mapRef: RefObject<MapRef | null>;
  mapReady: boolean;
  /** Empty on the flat map, where deck.gl draws everything. */
  layers: readonly Layer[];
  markerTooltip: ReturnType<typeof createMarkerTooltip>;
  onClick: (info: PickingInfo) => void;
}): {
  isOverNative: (x: number, y: number) => boolean;
  tooltipRef: RefObject<HoverTooltipApi | null>;
} {
  const { mapRef, mapReady, layers, markerTooltip, onClick } = opts;
  const tooltipRef = useRef<HoverTooltipApi | null>(null);

  const clickable = useMemo(
    () =>
      layers.map((layer) => {
        const own = layer.props.onClick as ((i: PickingInfo) => void) | undefined;
        return layer.clone({
          onClick: (info: PickingInfo) => {
            own?.(info);
            onClick(info);
          },
        } as Parameters<Layer["clone"]>[0]);
      }),
    [layers, onClick]
  );

  const input = useMemo<NativeGlobeInput>(
    () => ({
      nightCells: NONE,
      showNight: false,
      cruisePaths: NONE,
      cruiseWidthScale: 1,
      airportPoints: NONE,
      airportColor: DEFAULT_AIRPORT_COLOR,
      airportRadius: 0,
      portPoints: NONE,
      portColor: DEFAULT_PORT_COLOR,
      portRadius: 0,
      lodgings: NONE,
      lodgingColors: NO_LODGING_COLORS,
      lodgingRadius: 0,
      places: NONE,
      placeColors: NO_PLACE_COLORS,
      placeRadius: 0,
      extraLayers: clickable,
      routesVisible: ALL_ROUTES_VISIBLE,
      lite: false,
    }),
    [clickable]
  );

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
  const hideTooltip = useCallback((): void => tooltipRef.current?.hide(), [tooltipRef]);
  const hover = useMemo(
    () => ({ airport: noop, port: noop, cruise: noop, pin: onPinHover }),
    [onPinHover]
  );
  const onOverChange = useCallback(
    (now: boolean): void => {
      applyHoverCursor(mapRef.current?.getMap(), now);
    },
    [mapRef]
  );

  const native = useNativeGlobe({
    mapRef,
    mapReady,
    input,
    hover,
    hideTooltip,
    setPinned: noop,
    onOverChange,
  });
  return { isOverNative: native.isOverNative, tooltipRef };
}
