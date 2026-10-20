import { AppError } from "../../middleware/errorHandler";
import { collectionSchemas } from "./schema";
import { applyVariantOperation, isVariantOperation } from "./variants";
import type { PlanOperation, PlanStage, PlanState, PlanStation } from "./types";

const ROUTE_COLLECTIONS = new Set(["stations", "stages"]);

function invalidNight(message: string): never {
  throw new AppError(message, 409, "PLAN_INVALID_NIGHT");
}

function notFound(): never {
  throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
}

/**
 * A night is only as valid as the rest of the route: "onboard" needs the
 * stage arriving at the station to be an overnight ferry, and "booked" needs
 * a hotel booking. Checked on the whole state after every route edit, because
 * changing a stage can invalidate a night nobody touched.
 */
export function assertNightsHold(state: PlanState): void {
  for (const station of state.stations) {
    const night = station.night;
    if (night.kind === "booked") {
      const booking = state.bookings.find((b) => b.id === night.bookingId);
      if (!booking || booking.kind !== "hotel")
        invalidNight(`Station "${station.title}": a booked night needs a lodging booking`);
    } else if (night.kind === "onboard") {
      if (!hasOvernightFerryArriving(state, station.id))
        invalidNight(
          `Station "${station.title}": an onboard night needs an overnight ferry arriving`
        );
    }
  }
}

const hasOvernightFerryArriving = (state: PlanState, stationId: string) =>
  state.stages.some((g) => g.toStationId === stationId && g.overnight && g.mode === "ferry");

/**
 * Removing or changing the overnight ferry an "onboard" night depends on turns
 * that night into "spontaneous" in the same operation, the way removing an item
 * clears its ideas' link. Refusing would make the stage or station undeletable.
 */
function cascadeOnboard(state: PlanState): PlanState {
  if (
    !state.stations.some(
      (s) => s.night.kind === "onboard" && !hasOvernightFerryArriving(state, s.id)
    )
  )
    return state;
  return {
    ...state,
    stations: state.stations.map((s): PlanStation =>
      s.night.kind === "onboard" && !hasOvernightFerryArriving(state, s.id)
        ? { ...s, night: { kind: "spontaneous" } }
        : s
    ),
  };
}

function removeStation(state: PlanState, id: string): PlanState {
  if (!state.stations.some((s) => s.id === id)) notFound();
  return {
    ...state,
    stations: state.stations.filter((s) => s.id !== id),
    stages: state.stages.filter((g) => g.fromStationId !== id && g.toStationId !== id),
    // The day trips stay as ideas-tray entries; only the anchor goes.
    items: state.items.map((i) => (i.stationId === id ? { ...i, stationId: null } : i)),
    stationLinks: state.stationLinks.filter((l) => l.stationId !== id),
    stationWeather: state.stationWeather.filter((w) => w.stationId !== id),
  };
}

/**
 * Drops the figures a router or a chord derived for a stage; typed and booked
 * ones stay. A straight chord only ever derived the distance.
 */
function dropDerivedMetrics(g: PlanStage): PlanStage {
  if (g.metricsSource !== "routed" && g.metricsSource !== "straight") return g;
  return {
    ...g,
    distanceKm: null,
    durationMinutes: g.metricsSource === "routed" ? null : g.durationMinutes,
    metricsSource: null,
    fallbackReason: null,
  };
}

/**
 * A routed distance is only true for the endpoints and mode it was asked for:
 * once a station moves, a stage is rewired or changes mode, its derived
 * figures go, so neither the view nor a later failed re-route keeps another
 * route's kilometres.
 */
function invalidateMetrics(before: PlanState, after: PlanState): PlanState {
  const moved = new Set(
    after.stations
      .filter((s) => {
        const old = before.stations.find((o) => o.id === s.id);
        return old && (old.place.lat !== s.place.lat || old.place.lon !== s.place.lon);
      })
      .map((s) => s.id)
  );
  const changed = (g: PlanStage) => {
    const old = before.stages.find((o) => o.id === g.id);
    if (moved.has(g.fromStationId) || moved.has(g.toStationId)) return true;
    return (
      !!old &&
      (old.fromStationId !== g.fromStationId ||
        old.toStationId !== g.toStationId ||
        old.mode !== g.mode)
    );
  };
  if (!after.stages.some(changed)) return after;
  return { ...after, stages: after.stages.map((g) => (changed(g) ? dropDerivedMetrics(g) : g)) };
}

function upsertRouteEntry(
  state: PlanState,
  collection: "stations" | "stages",
  raw: Record<string, unknown>
): PlanState {
  const value = collectionSchemas[collection].parse(raw);
  const list = state[collection] as { id: string }[];
  const at = list.findIndex((x) => x.id === value.id);
  // An edit keeps the entry's place in the route; a new one goes last.
  const next = at === -1 ? [...list, value] : list.map((x, i) => (i === at ? value : x));
  return { ...state, [collection]: next };
}

function setNight(
  state: PlanState,
  op: Extract<PlanOperation, { type: "station_night" }>
): PlanState {
  if (!state.stations.some((s) => s.id === op.stationId)) notFound();
  return {
    ...state,
    stations: state.stations.map((s): PlanStation =>
      s.id === op.stationId ? { ...s, night: op.night, place: op.place ?? s.place } : s
    ),
  };
}

function moveStation(state: PlanState, id: string, toIndex: number): PlanState {
  const from = state.stations.findIndex((s) => s.id === id);
  if (from === -1) notFound();
  const rest = state.stations.filter((s) => s.id !== id);
  const at = Math.min(toIndex, rest.length);
  return {
    ...state,
    stations: [...rest.slice(0, at), state.stations[from], ...rest.slice(at)],
  };
}

function routeSettings(
  state: PlanState,
  op: Extract<PlanOperation, { type: "route_settings" }>
): PlanState {
  const shape = op.shape ?? state.shape;
  if (shape === "stay" && state.stations.length > 0)
    throw new AppError("The plan still has stations", 409, "PLAN_SHAPE_IN_USE");
  return { ...state, shape, vehicle: op.vehicle === undefined ? state.vehicle : op.vehicle };
}

/**
 * Stores routed metrics only if both endpoints are where they were when the
 * router was asked; a stage moved meanwhile would otherwise get another
 * route's kilometres.
 */
function stageMetrics(
  state: PlanState,
  op: Extract<PlanOperation, { type: "stage_metrics" }>
): PlanState {
  const stage = state.stages.find((g) => g.id === op.stageId);
  if (!stage) notFound();
  const from = state.stations.find((s) => s.id === stage!.fromStationId);
  const to = state.stations.find((s) => s.id === stage!.toStationId);
  const same = (a: { lat: number; lon: number } | undefined, b: { lat: number; lon: number }) =>
    !!a && a.lat === b.lat && a.lon === b.lon;
  if (stage.mode !== op.mode || !same(from?.place, op.fromCoord) || !same(to?.place, op.toCoord))
    throw new AppError("The stage changed while it was being routed", 409, "PLAN_STAGE_CHANGED");
  return {
    ...state,
    stages: state.stages.map((g) =>
      g.id === op.stageId
        ? {
            ...g,
            distanceKm: op.distanceKm,
            durationMinutes: op.durationMinutes,
            metricsSource: op.metricsSource,
            fallbackReason: op.fallbackReason,
          }
        : g
    ),
  };
}

/**
 * Applies the station / stage / night operations on a clone-safe copy of the
 * state. Returns `null` when `op` is not a route operation so the caller can
 * carry on with the other kinds. The caller re-parses the result.
 */
export function applyRouteOperation(state: PlanState, op: PlanOperation): PlanState | null {
  let next: PlanState;
  if (op.type === "route_settings") next = routeSettings(state, op);
  else if (isVariantOperation(op)) next = applyVariantOperation(state, op);
  else if (op.type === "stage_metrics") next = stageMetrics(state, op);
  else if (op.type === "move_station") next = moveStation(state, op.id, op.toIndex);
  else if (op.type === "station_night") next = invalidateMetrics(state, setNight(state, op));
  else if (op.type === "upsert" && ROUTE_COLLECTIONS.has(op.collection)) {
    next = invalidateMetrics(
      state,
      upsertRouteEntry(state, op.collection as "stations" | "stages", op.value)
    );
    if (op.collection === "stages") next = cascadeOnboard(next);
  } else if (op.type === "remove" && op.collection === "stations")
    next = cascadeOnboard(removeStation(state, op.id));
  else if (op.type === "remove" && op.collection === "stages") {
    if (!state.stages.some((g) => g.id === op.id)) notFound();
    next = cascadeOnboard({ ...state, stages: state.stages.filter((g) => g.id !== op.id) });
  } else return null;
  assertNightsHold(next);
  return next;
}
