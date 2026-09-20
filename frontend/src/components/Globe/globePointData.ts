// Pure builders for the globe's single-point marker data: one airport dot per
// IATA code touched by a flight, one port dot per port a cruise called at.
//
// Extracted from GlobeView's inline `useMemo` bodies on 2026-09-20. Both were
// already pure functions of their dependency list — nothing in either closed
// over render scope — and the component is frozen at 1666 lines by the
// file-size ratchet, so the lodging/place work that follows had to buy its
// space somewhere. It bought it here, where the code reads better on its own
// anyway: the shell keeps state + UI, the aggregation keeps its own file and
// becomes testable without mounting MapLibre.
//
// The counting rules live WITH the aggregation, not beside it: a scheduled
// flight must never bump "last visit" into the future, and only a countable
// cruise's port calls are a visit (shared/cruiseCounting.ts).

import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { PointDatum } from "./globeLayerTypes";
import { isCountableCruise } from "../../shared/cruiseCounting";
import { toPortLabel } from "../map/portLabel";
import type { CruiseLegDates } from "./timeSliderUtils";
import type { TimeSliderMode } from "../../store/timeSliderStore";

/** Time-slider state the port aggregation has to honour, in one argument. */
export interface PortPointWindow {
  mode: TimeSliderMode;
  current: Date | null;
  filterStart: Date | null;
  filterEnd: Date | null;
}

/**
 * Airport dots: one per IATA code, `size` counting every flight that touched
 * it (all statuses — its label is neutral), `lastVisit` counting only flights
 * that have actually happened.
 */
export function buildAirportPoints(flights: readonly GeoJSONFeature[]): PointDatum[] {
  const seen = new Map<string, PointDatum>();
  const bumpLastVisit = (cur: PointDatum, candidate: string | undefined): string | undefined => {
    if (!candidate) return cur.lastVisit;
    if (!cur.lastVisit || candidate > cur.lastVisit) return candidate;
    return cur.lastVisit;
  };
  for (const flight of flights) {
    const coords = flight.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const dep = flight.properties?.departureAirport;
    const arr = flight.properties?.arrivalAirport;
    const start = coords[0];
    const end = coords[coords.length - 1];
    // A scheduled flight is a future flight — it must never bump "last visit"
    // into the future. `size` stays all-status; only the visit timestamp is
    // status-gated (mirrors routesLayer.ts's buildAirportPoints).
    const departureTime =
      flight.properties?.status !== "scheduled"
        ? (flight.properties?.departureTime ?? undefined)
        : undefined;
    if (dep?.iata && Number.isFinite(start[0]) && Number.isFinite(start[1])) {
      const cur = seen.get(dep.iata);
      if (cur) {
        seen.set(dep.iata, {
          ...cur,
          size: cur.size + 1,
          lastVisit: bumpLastVisit(cur, departureTime),
        });
      } else {
        seen.set(dep.iata, {
          position: [start[0], start[1]],
          size: 1,
          iata: dep.iata,
          name: dep.name ?? dep.iata,
          icao: dep.icao,
          city: dep.city ?? undefined,
          country: dep.country ?? undefined,
          lastVisit: departureTime,
        });
      }
    }
    if (arr?.iata && Number.isFinite(end[0]) && Number.isFinite(end[1])) {
      const cur = seen.get(arr.iata);
      if (cur) {
        seen.set(arr.iata, {
          ...cur,
          size: cur.size + 1,
          lastVisit: bumpLastVisit(cur, departureTime),
        });
      } else {
        seen.set(arr.iata, {
          position: [end[0], end[1]],
          size: 1,
          iata: arr.iata,
          name: arr.name ?? arr.iata,
          icao: arr.icao,
          city: arr.city ?? undefined,
          country: arr.country ?? undefined,
          lastVisit: departureTime,
        });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Port dots: one per port id across every countable cruise, filtered by the
 * time-slider window. A port is "visited" at the ARRIVAL date of the leg
 * ending there (or at the cruise's start date for its first port).
 */
export function buildPortPoints(
  cruises: readonly Cruise[],
  legDatesByCruise: ReadonlyMap<string, CruiseLegDates[]>,
  window: PortPointWindow
): PointDatum[] {
  const seen = new Map<number, PointDatum>();
  for (const c of cruises) {
    // Only a sailed cruise's port calls count as a visit — the rule lives in
    // shared/cruiseCounting.ts, so it no longer drifts from the layer's copy.
    if (!isCountableCruise(c)) continue;
    const legs = legDatesByCruise.get(c.id) ?? [];
    const portVisitDate = new Map<number, Date>();
    const startDate = c.startDate ? new Date(c.startDate) : null;
    const firstPortStop = c.stops.find((s) => !s.isAtSea && s.port);
    if (firstPortStop?.port && startDate) {
      portVisitDate.set(firstPortStop.port.id, startDate);
    }
    for (const ld of legs) portVisitDate.set(ld.toPortId, ld.endDate);

    for (const stop of c.stops) {
      if (stop.isAtSea || !stop.port) continue;
      const port = stop.port;
      const visit = portVisitDate.get(port.id);

      if (window.mode === "live" && window.current) {
        if (!visit || visit.getTime() > window.current.getTime()) continue;
      } else if (window.mode === "filter" && window.filterStart && window.filterEnd) {
        if (
          !visit ||
          visit.getTime() < window.filterStart.getTime() ||
          visit.getTime() > window.filterEnd.getTime()
        ) {
          continue;
        }
      }

      const visitIso = visit ? visit.toISOString() : undefined;
      const cur = seen.get(port.id);
      if (cur) {
        const nextLast =
          visitIso && (!cur.lastVisit || visitIso > cur.lastVisit) ? visitIso : cur.lastVisit;
        seen.set(port.id, { ...cur, size: cur.size + 1, lastVisit: nextLast });
      } else {
        seen.set(port.id, {
          position: [port.lon, port.lat],
          size: 1,
          iata: port.unlocode ?? port.name,
          name: port.name,
          city: port.city ?? undefined,
          // On-map pill shows the readable port name, not the raw UN/LOCODE
          // (the tooltip still surfaces the code via `iata`).
          label: toPortLabel(port.name),
          // Flag from the LOCODE country prefix (only when it's a real code).
          country: port.unlocode ? port.unlocode.slice(0, 2) : undefined,
          lastVisit: visitIso,
        });
      }
    }
  }
  return Array.from(seen.values());
}
