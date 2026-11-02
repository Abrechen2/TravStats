import { useEffect, useState } from "react";
import { useFlightColorStore } from "../../store/flightColorStore";
import { useCruiseColorStore } from "../../store/cruiseColorStore";
import { useLodgingColorStore } from "../../store/lodgingColorStore";
import { usePlaceColorStore } from "../../store/placeColorStore";
import { loadMapAppearance, saveMapAppearance } from "../map/mapAppearance";
import type { PlaceLabelSource } from "../../lib/placeLabel";
import type { StyleId } from "./GlobeControlPanel";
import { STYLE_OPTIONS } from "./globeStyles";

/**
 * Every persisted look-and-feel choice of the globe (basemap, route widths,
 * marker colours/sizes, overlays) plus the shared colour-store selections.
 * Persisted as one blob through `mapAppearance`.
 */
export function useGlobeAppearance() {
  const [styleId, setStyleId] = useState<StyleId>(() => {
    const stored = loadMapAppearance().styleId;
    return stored && STYLE_OPTIONS.some((s) => s.id === stored) ? (stored as StyleId) : "dark";
  });
  // Flight-domain route COLOUR is NOT local state: it lives in the shared
  // flight-colour store (mode + colours), which the flat map, both control
  // panels and the dashboard legend read too — so the globe can never show a
  // different colour than the 2D map for the same route.
  const flightColorConfig = useFlightColorStore((s) => s.config);
  const setFlightColorMode = useFlightColorStore((s) => s.setMode);
  const setFlightColor = useFlightColorStore((s) => s.setColor);
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
  // Marker colours are nullable: null = brand default (the "Auto" pill).
  const [airportColor, setAirportColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().airportColor ?? null
  );
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
  // Cruise-domain appearance. Route COLOUR is NOT local state either: it lives
  // in the shared cruise-colour store (mode + colours), so the globe, the flat
  // map, both panels and the dashboard legend cannot disagree about what a
  // cruise route looks like.
  const cruiseColorConfig = useCruiseColorStore((s) => s.config);
  const setCruiseColorMode = useCruiseColorStore((s) => s.setMode);
  const setCruiseColor = useCruiseColorStore((s) => s.setColor);
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
  const [portColor, setPortColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().portColor ?? null
  );
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
  // Lodging + place appearance. Colour is store state for the same reason the
  // flight and cruise colours are: the flat map, both panels, the legend and
  // this renderer all read one config, so a pin and its swatch cannot drift.
  const lodgingColorConfig = useLodgingColorStore((s) => s.config);
  const setLodgingColorMode = useLodgingColorStore((s) => s.setMode);
  const setLodgingColor = useLodgingColorStore((s) => s.setColor);
  const placeColorConfig = usePlaceColorStore((s) => s.config);
  const setPlaceColorMode = usePlaceColorStore((s) => s.setMode);
  const setPlaceColor = usePlaceColorStore((s) => s.setColor);
  // Whether a place pill says its name or its list's symbol. The flat map owns
  // the same setting (DeckGLMap), persisted in the shared mapAppearance blob,
  // so flipping it on one map is already flipped on the other.
  const [placeLabelSource, setPlaceLabelSource] = useState<PlaceLabelSource>(
    () => loadMapAppearance().placeLabelSource ?? "list"
  );
  // Style-level overlays (relief hillshade + basemap place names).
  const [showTerrain, setShowTerrain] = useState<boolean>(
    () => loadMapAppearance().showTerrain ?? false
  );
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(
    () => loadMapAppearance().showPlaceLabels ?? true
  );

  // Persist every appearance / overlay choice as one blob.
  useEffect(() => {
    saveMapAppearance({
      styleId,
      flightRouteWidth,
      airportColor,
      flightMarkerSize,
      cruiseRouteWidth,
      portColor,
      cruiseMarkerSize,
      showTerrain,
      showPlaceLabels,
      placeLabelSource,
    });
  }, [
    styleId,
    flightRouteWidth,
    airportColor,
    flightMarkerSize,
    cruiseRouteWidth,
    portColor,
    cruiseMarkerSize,
    showTerrain,
    showPlaceLabels,
    placeLabelSource,
  ]);

  return {
    styleId,
    setStyleId,
    flightColorConfig,
    setFlightColorMode,
    setFlightColor,
    flightRouteWidth,
    setFlightRouteWidth,
    airportColor,
    setAirportColor,
    flightMarkerSize,
    setFlightMarkerSize,
    cruiseColorConfig,
    setCruiseColorMode,
    setCruiseColor,
    cruiseRouteWidth,
    setCruiseRouteWidth,
    portColor,
    setPortColor,
    cruiseMarkerSize,
    setCruiseMarkerSize,
    lodgingColorConfig,
    setLodgingColorMode,
    setLodgingColor,
    placeColorConfig,
    setPlaceColorMode,
    setPlaceColor,
    placeLabelSource,
    setPlaceLabelSource,
    showTerrain,
    setShowTerrain,
    showPlaceLabels,
    setShowPlaceLabels,
  };
}
