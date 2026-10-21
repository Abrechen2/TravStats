import { randomUUID } from "crypto";
import { AppError } from "../../middleware/errorHandler";
import { routeLegs } from "./routeSchedule";
import type {
  PlanBooking,
  PlanOperation,
  PlanStage,
  PlanState,
  PlanVariant,
  PlanVehicle,
  VariantComparison,
} from "./types";

/** The active route plus its alternatives: "up to three variants" in the spec. */
const MAX_ROUTES = 3;
const PRICED_KINDS = new Set<PlanStage["mode"]>(["ferry", "rail", "flight"]);

type Money = { amount: number; currency: string };

function variantNotFound(): never {
  throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
}

function indexOfVariant(state: PlanState, variantId: string): number {
  const at = state.variants.findIndex((v) => v.id === variantId);
  if (at === -1) variantNotFound();
  return at;
}

/**
 * Swaps the active route with a variant. The old active route takes the
 * variant's slot under the active name. Items, bookings and placeholders are
 * shared (spec C2) and stay: an item whose station is not on the new route
 * keeps its day and loses only its anchor, so switching back loses nothing
 * the user did not already see. Station links and weather belong to a station,
 * not to the active view: they stay while any route holds the station, so a
 * round trip through another variant gives them back.
 */
export function activateVariant(state: PlanState, variantId: string): PlanState {
  const at = indexOfVariant(state, variantId);
  const target = state.variants[at];
  const stationIds = new Set(target.stations.map((s) => s.id));
  const parked: PlanVariant = {
    id: target.id,
    name: state.activeVariantName,
    stations: state.stations,
    stages: state.stages,
  };
  return {
    ...state,
    stations: target.stations,
    stages: target.stages,
    variants: state.variants.map((v, i) => (i === at ? parked : v)),
    activeVariantName: target.name,
    items: state.items.map((i) =>
      i.stationId && !stationIds.has(i.stationId) ? { ...i, stationId: null } : i
    ),
  };
}

/** Drops station links and weather whose station is on no route any more. */
export function pruneStationScoped(state: PlanState): PlanState {
  const held = new Set(
    [state.stations, ...state.variants.map((v) => v.stations)].flat().map((s) => s.id)
  );
  return {
    ...state,
    stationLinks: state.stationLinks.filter((l) => held.has(l.stationId)),
    stationWeather: state.stationWeather.filter((w) => held.has(w.stationId)),
  };
}

/**
 * Litres burned on the drive stages, priced. `null` unless consumption, price
 * and currency are known AND every drive stage has a distance: a partial sum
 * would read as the cost of the whole route.
 */
export function fuelEstimate(stages: PlanStage[], vehicle: PlanVehicle | null): Money | null {
  if (
    !vehicle ||
    vehicle.consumptionPer100 === null ||
    vehicle.fuelPrice === null ||
    vehicle.fuelCurrency === null
  )
    return null;
  const drives = stages.filter((g) => g.mode === "drive");
  if (drives.length === 0) return null;
  let km = 0;
  for (const g of drives) {
    if (g.distanceKm === null) return null;
    km += g.distanceKm;
  }
  // km * l/100km * price/l = km * (l/100km) * price / 100 euros = that many cents.
  return {
    amount: Math.round(km * vehicle.consumptionPer100 * vehicle.fuelPrice) / 100,
    currency: vehicle.fuelCurrency,
  };
}

function driveKm(stages: PlanStage[]): number | null {
  let km = 0;
  for (const g of stages) {
    if (g.mode !== "drive") continue;
    if (g.distanceKm === null) return null;
    km += g.distanceKm;
  }
  return km;
}

/** Bookings tied to a route's stages, one per price group (as the budget counts them). */
function stageBookings(state: PlanState, stages: PlanStage[]): PlanBooking[] {
  const stageIds = new Set(stages.map((g) => g.id));
  const linked = new Set(stages.flatMap((g) => (g.bookingId ? [g.bookingId] : [])));
  const groups = new Set<string>();
  return state.bookings.filter((b) => {
    if (!(b.stageId && stageIds.has(b.stageId)) && !linked.has(b.id)) return false;
    const key = b.priceGroupId || b.actualBookingId;
    if (!key) return true;
    if (groups.has(key)) return false;
    groups.add(key);
    return true;
  });
}

function stageCosts(
  state: PlanState,
  stages: PlanStage[]
): { stageCosts: Money | null; unknownCosts: number } {
  const bookings = stageBookings(state, stages);
  let cents = 0;
  let counted = false;
  let skipped = 0;
  const priced = new Set<string>();
  for (const b of bookings) {
    const money = b.placeholder ? b.estimate : b.amount === null ? null : b;
    if (!money) continue;
    if (b.stageId) priced.add(b.stageId);
    for (const g of stages) if (g.bookingId === b.id) priced.add(g.id);
    if (money.currency !== state.currency) {
      skipped++;
      continue;
    }
    cents += Math.round(money.amount! * 100);
    counted = true;
  }
  const unpriced = stages.filter((g) => PRICED_KINDS.has(g.mode) && !priced.has(g.id)).length;
  return {
    stageCosts: counted ? { amount: cents / 100, currency: state.currency } : null,
    unknownCosts: unpriced + skipped,
  };
}

function compareRoute(
  state: PlanState,
  id: string | null,
  name: string,
  stations: PlanState["stations"],
  stages: PlanStage[]
): VariantComparison {
  // Only stages joining consecutive stations of the current order are the
  // route. Others are left over from a reorder: reported, never summed. A leg
  // no stage covers makes the drive total a partial sum, so it is unknown.
  const legs = routeLegs(stations, stages);
  const complete = legs.every((g) => g !== null);
  const legStages = legs.filter((g): g is PlanStage => g !== null);
  const onRoute = new Set(legStages.map((g) => g.id));
  return {
    id,
    name,
    active: id === null,
    driveKm: complete ? driveKm(legStages) : null,
    driveDays: legStages.filter((g) => g.mode === "drive").length,
    destinationNights: stations
      .filter((s) => s.night.kind !== "onboard")
      .reduce((sum, s) => sum + s.nights, 0),
    ...stageCosts(state, legStages),
    fuel: complete ? fuelEstimate(legStages, state.vehicle) : null,
    obsoleteStageIds: stages.filter((g) => !onRoute.has(g.id)).map((g) => g.id),
  };
}

/** The active route first, then the alternatives in their stored order. */
export function compareVariants(state: PlanState): VariantComparison[] {
  return [
    compareRoute(state, null, state.activeVariantName, state.stations, state.stages),
    ...state.variants.map((v) => compareRoute(state, v.id, v.name, v.stations, v.stages)),
  ];
}

type VariantOperation = Extract<
  PlanOperation,
  { type: "create_variant" | "activate_variant" | "remove_variant" | "rename_variant" }
>;

export const isVariantOperation = (op: PlanOperation): op is VariantOperation =>
  op.type === "create_variant" ||
  op.type === "activate_variant" ||
  op.type === "remove_variant" ||
  op.type === "rename_variant";

export function applyVariantOperation(state: PlanState, op: VariantOperation): PlanState {
  if (op.type === "activate_variant") return activateVariant(state, op.variantId);
  if (op.type === "create_variant") {
    if (state.variants.length + 1 >= MAX_ROUTES)
      throw new AppError("A plan holds at most three variants", 409, "PLAN_VARIANT_LIMIT");
    // C2: a copy keeps the ids, so the same place stays the same place.
    const copy: PlanVariant = {
      id: randomUUID(),
      name: op.name,
      stations: op.copyActive ? structuredClone(state.stations) : [],
      stages: op.copyActive ? structuredClone(state.stages) : [],
    };
    return { ...state, variants: [...state.variants, copy] };
  }
  const at = indexOfVariant(state, op.variantId);
  if (op.type === "rename_variant")
    return {
      ...state,
      variants: state.variants.map((v, i) => (i === at ? { ...v, name: op.name } : v)),
    };
  return pruneStationScoped({ ...state, variants: state.variants.filter((_, i) => i !== at) });
}
