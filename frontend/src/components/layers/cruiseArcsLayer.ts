import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";
import { buildCruiseArc } from "./cruiseArc";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
}

/**
 * Build a PathLayer of curved cruise legs — one arc per consecutive stop
 * pair within each cruise. At-sea days and stops without a resolved port
 * are skipped; cruises with fewer than two qualifying stops contribute
 * no arcs.
 *
 * Returns `null` when the data would produce an empty layer so callers
 * can omit it entirely rather than mounting a no-op.
 */
export function createCruiseArcsLayer(cruises: Cruise[]): Layer | null {
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    const stops = cruise.stops
      .filter((s) => !s.isAtSea && s.port !== null)
      .sort((a, b) => a.dayNumber - b.dayNumber);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i].port;
      const b = stops[i + 1].port;
      if (!a || !b) continue;
      arcs.push({
        path: buildCruiseArc({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }),
        cruiseId: cruise.id,
        cruiseLine: cruise.cruiseLine,
      });
    }
  }
  if (arcs.length === 0) return null;

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: [56, 189, 248, 220],
    getWidth: 2,
    widthUnits: "pixels",
    pickable: true,
  });
}
