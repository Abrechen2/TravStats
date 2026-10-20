import { AppError } from "../../middleware/errorHandler";
import { haversineKm } from "../../shared/geo/haversine";
import { daysBetween } from "../../shared/time/localDate";
import type { PlaceholderMatch, PlanBooking, PlanStage, PlanState, PlanStation } from "./types";

/** Spec §5.2: two ports closer than this are the same endpoint. */
export const MATCH_ENDPOINT_KM = 30;
const MATCH_DAY_TOLERANCE = 1;
const LODGING_KINDS = new Set(["hotel"]);

type Point = { lat: number; lon: number };

export function refuse(message: string): never {
  throw new AppError(message, 409, "PLAN_PROTECTED");
}

/**
 * Turns a placeholder into a real booking in place. The placeholder's `id` and
 * `stageId` stay, so the stage, the night and the plan item that point at it
 * keep pointing at it; the estimate is kept in `details.replaced` so the swap
 * is traceable and the budget moves from "estimate" to "booked".
 */
export function replacePlaceholder(
  state: PlanState,
  placeholderId: string,
  value: PlanBooking,
  actorLabel: string | null
): PlanState {
  const placeholder = state.bookings.find((b) => b.id === placeholderId);
  if (!placeholder) throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
  if (!placeholder.placeholder) refuse("This booking is not a placeholder");
  if (value.kind !== placeholder.kind) refuse("A booking cannot change its kind");
  const replaced = {
    estimate: placeholder.estimate,
    replacedAt: new Date().toISOString(),
    ...(actorLabel ? { by: actorLabel } : {}),
  };
  const merged: PlanBooking = {
    ...placeholder,
    ...value,
    id: placeholder.id,
    stageId: placeholder.stageId,
    placeholder: false,
    estimate: null,
    details: { ...value.details, replaced },
  };
  return {
    ...state,
    bookings: state.bookings.map((b) => (b.id === placeholderId ? merged : b)),
    items: state.items.map((i) =>
      i.bookingId === placeholderId
        ? {
            ...i,
            title: merged.title,
            kind: merged.kind,
            day: merged.day,
            time: merged.time,
            timezone: merged.timezone,
            place: merged.place,
          }
        : i
    ),
  };
}

const normalise = (name: string | undefined | null): string =>
  (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/porto di|hafen|port of/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const asPoint = (value: unknown): Point | null => {
  if (!value || typeof value !== "object") return null;
  const { lat, lon } = value as Record<string, unknown>;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;
};

interface Endpoint {
  name: string;
  point: Point | null;
}
interface Located {
  from: Endpoint;
  to: Endpoint;
}

/** Coordinates a candidate carries in `details.origin` / `details.destination`. */
function candidateEndpoints(b: PlanBooking): Located {
  return {
    from: { name: normalise(b.originPlace), point: asPoint(b.details.origin) },
    to: { name: normalise(b.place), point: asPoint(b.details.destination) },
  };
}

interface Allocation {
  stage: PlanStage | undefined;
  stations: PlanStation[];
  active: boolean;
}

function allocate(state: PlanState, stageId: string | null): Allocation {
  if (!stageId) return { stage: undefined, stations: state.stations, active: true };
  const active = state.stages.find((g) => g.id === stageId);
  if (active) return { stage: active, stations: state.stations, active: true };
  const variant = state.variants.find((v) => v.stages.some((g) => g.id === stageId));
  if (variant)
    return {
      stage: variant.stages.find((g) => g.id === stageId),
      stations: variant.stations,
      active: false,
    };
  return { stage: undefined, stations: state.stations, active: true };
}

/** The plan side's endpoints: station coordinates when the stage names them. */
function placeholderEndpoints(b: PlanBooking, alloc: Allocation): Located {
  const at = (id: string | undefined) => alloc.stations.find((s) => s.id === id);
  const from = at(alloc.stage?.fromStationId),
    to = at(alloc.stage?.toStationId);
  const point = (s: PlanStation | undefined, detail: unknown): Point | null =>
    s ? { lat: s.place.lat, lon: s.place.lon } : asPoint(detail);
  return {
    from: { name: normalise(b.originPlace || from?.title), point: point(from, b.details.origin) },
    to: { name: normalise(b.place || to?.title), point: point(to, b.details.destination) },
  };
}

function sameEndpoint(plan: Endpoint, other: Endpoint): boolean {
  if (plan.point && other.point) return haversineKm(plan.point, other.point) <= MATCH_ENDPOINT_KM;
  return plan.name !== "" && plan.name === other.name;
}

const dayOffset = (a: string | null, b: string | null): number | null =>
  a && b ? Math.abs(daysBetween(a, b)) : null;

/** Lodging has no departure day: its stay must overlap the station's nights. */
function nightsOverlap(candidate: PlanBooking, placeholder: PlanBooking, alloc: Allocation) {
  const station = alloc.stations.find((s) => s.id === alloc.stage?.toStationId);
  const windowStart = station?.pinnedDay ?? placeholder.day;
  const windowNights = station?.pinnedDay
    ? station.nights
    : placeholder.day && placeholder.endDay
      ? daysBetween(placeholder.day, placeholder.endDay)
      : null;
  if (!windowStart || windowNights === null || !candidate.day) return false;
  const candidateEnd = candidate.endDay ?? null;
  const startsBeforeWindowEnds = daysBetween(windowStart, candidate.day) < windowNights;
  const endsAfterWindowStarts = candidateEnd === null || daysBetween(windowStart, candidateEnd) > 0;
  return startsBeforeWindowEnds && endsAfterWindowStarts;
}

const text = (value: string | null | undefined) => (value ? value : null);

function differences(
  candidate: PlanBooking,
  placeholder: PlanBooking
): PlaceholderMatch["differences"] {
  const pairs: [string, string | null, string | null][] = [
    ["provider", text(placeholder.provider), text(candidate.provider)],
    ["reference", text(placeholder.reference), text(candidate.reference)],
    ["day", placeholder.day, candidate.day],
    ["time", placeholder.time, candidate.time],
    [
      "amount",
      placeholder.estimate
        ? `${placeholder.estimate.amount} ${placeholder.estimate.currency}`
        : null,
      candidate.amount === null ? null : `${candidate.amount} ${candidate.currency}`,
    ],
  ];
  return pairs
    .filter(([, plan, booking]) => booking !== null && booking !== plan)
    .map(([field, plan, booking]) => ({
      field,
      plan,
      booking,
      change: plan === null ? "new" : "changed",
    }));
}

/**
 * Which open placeholders could this imported booking be the real thing for?
 * Same kind, matching endpoints (within 30 km when both sides have
 * coordinates, otherwise the same normalised name), a departure day within
 * one day — and for lodging an overlap with the station's nights.
 */
export function matchPlaceholders(candidate: PlanBooking, state: PlanState): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  for (const placeholder of state.bookings) {
    if (!placeholder.placeholder || placeholder.kind !== candidate.kind) continue;
    const alloc = allocate(state, placeholder.stageId);
    const plan = placeholderEndpoints(placeholder, alloc),
      other = candidateEndpoints(candidate);
    const lodging = LODGING_KINDS.has(candidate.kind);
    const endpoints = lodging
      ? sameEndpoint(plan.to, other.to)
      : sameEndpoint(plan.from, other.from) && sameEndpoint(plan.to, other.to);
    if (!endpoints) continue;
    const reasons: PlaceholderMatch["reasons"] = ["kind", "endpoints"];
    let score = 50;
    if (lodging) {
      if (!nightsOverlap(candidate, placeholder, alloc)) continue;
      reasons.push("nights");
      score += 30;
    } else {
      const offset = dayOffset(placeholder.day ?? alloc.stage?.departDay ?? null, candidate.day);
      if (offset === null || offset > MATCH_DAY_TOLERANCE) continue;
      reasons.push("day");
      score += offset === 0 ? 40 : 25;
    }
    matches.push({
      bookingId: placeholder.id,
      score,
      variant: alloc.active ? "active" : "inactive",
      reasons,
      differences: differences(candidate, placeholder),
    });
  }
  return matches.sort((a, b) => b.score - a.score);
}
