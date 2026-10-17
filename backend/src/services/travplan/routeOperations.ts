import { AppError } from "../../middleware/errorHandler";
import { collectionSchemas } from "./schema";
import type { PlanOperation, PlanState, PlanStation } from "./types";

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
function assertNightsHold(state: PlanState): void {
  for (const station of state.stations) {
    const night = station.night;
    if (night.kind === "booked") {
      const booking = state.bookings.find((b) => b.id === night.bookingId);
      if (!booking || booking.kind !== "hotel")
        invalidNight("A booked night needs a lodging booking");
    } else if (night.kind === "onboard") {
      const arriving = state.stages.filter((g) => g.toStationId === station.id);
      if (!arriving.some((g) => g.overnight && g.mode === "ferry"))
        invalidNight("An onboard night needs an overnight ferry arriving at the station");
    }
  }
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
 * Applies the station / stage / night operations on a clone-safe copy of the
 * state. Returns `null` when `op` is not a route operation so the caller can
 * carry on with the other kinds. The caller re-parses the result.
 */
export function applyRouteOperation(state: PlanState, op: PlanOperation): PlanState | null {
  let next: PlanState;
  if (op.type === "route_settings") next = routeSettings(state, op);
  else if (op.type === "move_station") next = moveStation(state, op.id, op.toIndex);
  else if (op.type === "station_night") next = setNight(state, op);
  else if (op.type === "upsert" && ROUTE_COLLECTIONS.has(op.collection))
    next = upsertRouteEntry(state, op.collection as "stations" | "stages", op.value);
  else if (op.type === "remove" && op.collection === "stations") next = removeStation(state, op.id);
  else if (op.type === "remove" && op.collection === "stages") {
    if (!state.stages.some((g) => g.id === op.id)) notFound();
    next = { ...state, stages: state.stages.filter((g) => g.id !== op.id) };
  } else return null;
  assertNightsHold(next);
  return next;
}
