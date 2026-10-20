import { useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import { useDomainVisible } from "../../../hooks/useDomainVisible";
import { useRailOverlay } from "./railMapOverlay";
import { useRentalOverlay } from "./rentalMapOverlay";
import { useBusOverlay } from "./busMapOverlay";
import { useFerryOverlay } from "./ferryMapOverlay";
import { buildStationLabelLayers } from "../../layers/stationLabelsLayer";
import { useMapLabelsModeStore } from "../../../store/mapLabelsModeStore";

type Translate = (key: string) => string;

export interface TransportOverlays {
  /** Rail, bus, ferry and rental lines, in drawing order. */
  layers: Layer[];
  legendRows: JSX.Element[];
}

/**
 * The transport domains on the "Alle" map — rail, bus, ferry and rentals,
 * beside the tours — each behind its own domain gate and its own row of the
 * domain filter. One hook, so the tab gains one line per domain here rather
 * than a block in a file at the size limit; every domain asks the same two
 * conditions, so ferry cannot be the one left out again.
 */
export function useTransportOverlays(
  showTours: boolean,
  isFilterVisible: (key: "rail" | "rental" | "bus" | "ferry") => boolean,
  onGlobe: boolean,
  t: Translate
): TransportOverlays {
  const railOn = useDomainVisible("rail") && showTours && isFilterVisible("rail");
  const rail = useRailOverlay(railOn, onGlobe, t);
  const rentalOn = useDomainVisible("rental") && showTours && isFilterVisible("rental");
  const rental = useRentalOverlay(rentalOn, onGlobe, t);
  // Bus and ferry add their domain gate inside their hook.
  const bus = useBusOverlay(showTours && isFilterVisible("bus"), onGlobe, t);
  const ferry = useFerryOverlay(showTours && isFilterVisible("ferry"), onGlobe, t);
  // The station names of all three ground domains as ONE layer (forgejo#320):
  // one collision pass, so a train station and a bus terminal at the same
  // interchange are decided between, not printed over each other.
  const labelsMode = useMapLabelsModeStore((s) => s.mode);
  const stationLabels = useMemo(
    () =>
      buildStationLabelLayers([rail.stations, bus.stations, ferry.stations], {
        labelsMode,
        idPrefix: "all-transport",
        onGlobe,
      }),
    [rail.stations, bus.stations, ferry.stations, labelsMode, onGlobe]
  );
  // Memoised on the layer lists, so the map's own memo sees a new list only
  // when one of them changed. Names last, above every line.
  const layers = useMemo(
    () => [...rail.layers, ...bus.layers, ...ferry.layers, ...rental.layers, ...stationLabels],
    [rail.layers, bus.layers, ferry.layers, rental.layers, stationLabels]
  );
  return {
    layers,
    legendRows: [...rail.legendRows, ...bus.legendRows, ...ferry.legendRows, ...rental.legendRows],
  };
}
