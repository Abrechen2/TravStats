import { useEffect, useState } from "react";
import type { FlightRouteShape } from "../../lib/flightRouteShape";
import type { PlaceLabelSource } from "../../lib/placeLabel";
import type { FlatStyleId } from "./basemapStyles";
import { loadFlightRouteShape, loadMapAppearance, saveMapAppearance } from "./mapAppearance";

/**
 * The flat map's persisted appearance: basemap style, route shape and width,
 * marker colours and sizes, terrain and place labels. State and the save-on-
 * change effect lived inline in `DeckGLMap.tsx`; lifted out unchanged
 * (forgejo#386, REF-16).
 */
export function useFlatMapAppearance() {
  // persisted so the look survives reloads. `markerColor === null` keeps the theme dot colour.
  const [styleId, setStyleId] = useState<FlatStyleId>(() => loadMapAppearance().styleId ?? "dark");
  // Flight-domain appearance. The route COLOUR lives in the flight-colour
  // store above (mode + colours); only shape / width / marker settings are local.
  //
  // The SHAPE (#183) is flat-map-only, which is why it lives here as plain
  // component state next to the width slider rather than in a shared store like
  // the colour config: the globe never reads it, and the flat map is the only
  // renderer that has to know.
  const [flightRouteShape, setFlightRouteShape] = useState<FlightRouteShape>(() =>
    loadFlightRouteShape()
  );
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
  const [markerColor, setMarkerColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().airportColor ?? null
  );
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
  // Cruise appearance: colour is in the store; the settings flag hides route lines (forgejo#389).
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
  const [portColor, setPortColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().portColor ?? null
  );
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
  const [cruiseArrowScale, setCruiseArrowScale] = useState<number>(
    () => loadMapAppearance().cruiseArrowScale ?? 1
  );
  const [showTerrain, setShowTerrain] = useState<boolean>(
    () => loadMapAppearance().showTerrain ?? false
  );
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(
    () => loadMapAppearance().showPlaceLabels ?? true
  );
  // Absent means "as each list says" — see the field's note in mapAppearance.
  const [placeLabelSource, setPlaceLabelSource] = useState<PlaceLabelSource>(
    () => loadMapAppearance().placeLabelSource ?? "list"
  );
  useEffect(() => {
    saveMapAppearance({
      styleId,
      flightRouteShape,
      flightRouteWidth,
      airportColor: markerColor,
      flightMarkerSize,
      cruiseRouteWidth,
      portColor,
      cruiseMarkerSize,
      cruiseArrowScale,
      showTerrain,
      showPlaceLabels,
      placeLabelSource,
    });
  }, [
    styleId,
    flightRouteShape,
    flightRouteWidth,
    markerColor,
    flightMarkerSize,
    cruiseRouteWidth,
    portColor,
    cruiseMarkerSize,
    cruiseArrowScale,
    showTerrain,
    showPlaceLabels,
    placeLabelSource,
  ]);
  return {
    styleId,
    setStyleId,
    flightRouteShape,
    setFlightRouteShape,
    flightRouteWidth,
    setFlightRouteWidth,
    markerColor,
    setMarkerColor,
    flightMarkerSize,
    setFlightMarkerSize,
    cruiseRouteWidth,
    setCruiseRouteWidth,
    portColor,
    setPortColor,
    cruiseMarkerSize,
    setCruiseMarkerSize,
    cruiseArrowScale,
    setCruiseArrowScale,
    showTerrain,
    setShowTerrain,
    showPlaceLabels,
    setShowPlaceLabels,
    placeLabelSource,
    setPlaceLabelSource,
  };
}
