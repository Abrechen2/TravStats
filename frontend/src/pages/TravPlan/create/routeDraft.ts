/** Pure builder of the route a new plan starts with. No React, no network. */
import { newPlanId } from "../../../lib/travplanId";
import type { PlanBooking, PlanPlace, PlanStage, PlanStation } from "../../../lib/api/travplan";
import { newStage, newStation } from "../route/routeModel";

export type LegMode = PlanStage["mode"];
export const LEG_MODES: LegMode[] = ["drive", "ferry", "rail", "flight", "other"];
/** Modes somebody books: the plan holds a placeholder for each until the real booking arrives. */
const BOOKED_MODES = new Set<LegMode>(["ferry", "rail", "flight"]);

/** A place on the way and the mode of the leg that ARRIVES there. */
export interface DraftStop {
  place: PlanPlace;
  mode: LegMode;
}
export interface RouteDraft {
  start: PlanPlace;
  /** Via points and the goal, in order; the last one is the goal. */
  stops: DraftStop[];
  back: boolean;
}
export interface DraftLeg {
  from: PlanPlace;
  to: PlanPlace;
  mode: LegMode;
}

/**
 * Every leg of the draft. The way back retraces the way out in reverse, mode for mode, so a
 * ferry crossed on the way out is a ferry on the way home too - not a drive across the sea.
 */
export function draftLegs(draft: RouteDraft): DraftLeg[] {
  const places = [draft.start, ...draft.stops.map((s) => s.place)];
  const out = draft.stops.map((s, i) => ({ from: places[i], to: s.place, mode: s.mode }));
  if (!draft.back) return out;
  const home = [...out].reverse().map((l) => ({ from: l.to, to: l.from, mode: l.mode }));
  return [...out, ...home];
}

export const needsBooking = (mode: LegMode) => BOOKED_MODES.has(mode);
export const legTitle = (leg: DraftLeg) => `${leg.from.name} → ${leg.to.name}`;

export interface BuiltRoute {
  stations: PlanStation[];
  /** Placeholders, each tied to its stage; they must exist before the stages that name them. */
  bookings: PlanBooking[];
  stages: PlanStage[];
}

/**
 * Stations, stages and the placeholders of booked legs. The goal holds the nights of the trip
 * until the traveller spreads them, so the schedule starts from the real dates instead of
 * putting every station on day one.
 */
export function buildRoute(
  draft: RouteDraft,
  opts: { nights: number; currency: string; estimates: Record<number, number | null> }
): BuiltRoute {
  const legs = draftLegs(draft);
  const goalIndex = draft.stops.length;
  const stations = [newStation(draft.start, 0), ...legs.map((l) => newStation(l.to, 0))].map(
    (s, i) => (i === goalIndex ? { ...s, nights: Math.max(0, opts.nights) } : s)
  );
  const bookings: PlanBooking[] = [];
  const stages = legs.map((leg, i) => {
    const stage = { ...newStage(stations[i].id, stations[i + 1].id), mode: leg.mode };
    if (!needsBooking(leg.mode)) return stage;
    const estimate = opts.estimates[i] ?? null;
    const booking: PlanBooking = {
      id: newPlanId(),
      kind: leg.mode as "ferry" | "rail" | "flight",
      title: legTitle(leg),
      reference: null,
      provider: "",
      day: null,
      endDay: null,
      time: null,
      timezone: leg.from.zone,
      originPlace: leg.from.name,
      amount: null,
      paid: 0,
      currency: opts.currency,
      place: leg.to.name,
      documentIds: [],
      source: "manual",
      details: {},
      placeholder: true,
      estimate: estimate === null ? null : { amount: estimate, currency: opts.currency },
      stageId: stage.id,
    };
    bookings.push(booking);
    return { ...stage, bookingId: booking.id };
  });
  return { stations, bookings, stages };
}
