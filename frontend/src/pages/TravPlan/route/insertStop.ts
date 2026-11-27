/** Pure planning of "put a stop between two stations". No React, no network. */
import type { PlanOperation, PlanPlace, PlanStage, PlanState } from "../../../lib/api/travplan";
import { entryRecord } from "../planContext";
import { newStage, newStation } from "./routeModel";

/** Legs that leave from a fixed place: a ferry, a train or a plane does not stop on the way. */
const FIXED_MODES = new Set<PlanStage["mode"]>(["ferry", "rail", "flight"]);

const unmeasured = (stage: PlanStage): PlanStage => ({
  ...stage,
  durationMinutes: null,
  distanceKm: null,
  metricsSource: null,
  fallbackReason: null,
});

/**
 * The writes that put `place` after the station at `index`.
 *
 * A drive is split: the old stage now arrives at the new stop and a new drive continues to the
 * next station. A ferry, train or flight cannot be split, so the stop becomes a round trip from
 * its port: port → stop → back to the port, and the crossing still leaves from there. That is
 * the Sicily case: arrive in Palermo, tour the island, take the ferry home from Palermo.
 */
export function insertStop(state: PlanState, index: number, place: PlanPlace): PlanOperation[] {
  const at = state.stations[index],
    next = state.stations[index + 1],
    leaving =
      next && state.stages.find((g) => g.fromStationId === at.id && g.toStationId === next.id),
    stop = newStation(place, 1),
    station = (value: object): PlanOperation => ({
      type: "upsert",
      collection: "stations",
      value: entryRecord(value),
    }),
    stage = (value: PlanStage): PlanOperation => ({
      type: "upsert",
      collection: "stages",
      value: entryRecord(value),
    }),
    move = (id: string, toIndex: number): PlanOperation => ({ type: "move_station", id, toIndex });

  if (leaving && FIXED_MODES.has(leaving.mode)) {
    const port = { ...newStation(at.place, 0), title: at.title },
      out = newStage(at.id, stop.id),
      back = newStage(stop.id, port.id);
    return [
      station(stop),
      move(stop.id, index + 1),
      station(port),
      move(port.id, index + 2),
      stage(out),
      stage(back),
      // The crossing keeps its mode and booking; the server drops its derived figures because a
      // stage was rewired, and "Neu berechnen" measures it again.
      stage({ ...leaving, fromStationId: port.id }),
    ];
  }
  const arrive = newStage(at.id, stop.id);
  const operations: PlanOperation[] = [station(stop), move(stop.id, index + 1)];
  if (leaving) {
    // The old leg keeps its mode and note and now arrives at the new stop; its figures were
    // for the old endpoints, so they are cleared to be measured again.
    const first = { ...unmeasured(leaving), toStationId: stop.id },
      onward = { ...newStage(stop.id, next.id), mode: leaving.mode };
    return [...operations, stage(first), stage(onward)];
  }
  // No stage joined the two yet: the stop gets both its legs, so nothing is left unconnected.
  return next
    ? [...operations, stage(arrive), stage(newStage(stop.id, next.id))]
    : [...operations, stage(arrive)];
}
