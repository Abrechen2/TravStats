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
  /** Nights spent at a stop on the way; the goal takes what is left. */
  nights?: number;
  /** The leg arriving here runs through a night (night ferry, sleeper train). */
  overnight?: boolean;
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
  overnight: boolean;
}

/**
 * Every leg of the draft. The way back retraces the way out in reverse, mode for mode, so a
 * ferry crossed on the way out is a ferry on the way home too - not a drive across the sea.
 */
export function draftLegs(draft: RouteDraft): DraftLeg[] {
  const places = [draft.start, ...draft.stops.map((s) => s.place)];
  const out = draft.stops.map((s, i) => ({
    from: places[i],
    to: s.place,
    mode: s.mode,
    overnight: s.overnight === true,
  }));
  if (!draft.back) return out;
  const home = [...out].reverse().map((l) => ({ ...l, from: l.to, to: l.from }));
  return [...out, ...home];
}

/**
 * The goal's nights: the trip's nights less those spent at stops on the way and those spent on
 * board, never below zero. The way back stops nowhere until the traveller adds a stop.
 */
export function goalNights(draft: RouteDraft, tripNights: number): number {
  const onTheWay = draft.stops.slice(0, -1).reduce((n, s) => n + Math.max(0, s.nights ?? 0), 0),
    onBoard = draftLegs(draft).filter((l) => l.overnight).length;
  return Math.max(0, tripNights - onTheWay - onBoard);
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
 * Stations, stages and the placeholders of booked legs. Stops on the way keep the nights the
 * traveller gave them, the goal holds the rest, so the schedule starts from the real dates
 * instead of putting every station on day one.
 */
export function buildRoute(
  draft: RouteDraft,
  opts: { nights: number; currency: string; estimates: Record<number, number | null> }
): BuiltRoute {
  const legs = draftLegs(draft);
  const goalIndex = draft.stops.length;
  const nightsAt = (i: number) =>
    i === goalIndex
      ? goalNights(draft, opts.nights)
      : i > 0 && i < goalIndex
        ? Math.max(0, draft.stops[i - 1].nights ?? 0)
        : 0;
  const stations = [newStation(draft.start, 0), ...legs.map((l) => newStation(l.to, 0))].map(
    (s, i) => ({ ...s, nights: nightsAt(i) })
  );
  const bookings: PlanBooking[] = [];
  const stages = legs.map((leg, i) => {
    const stage = {
      ...newStage(stations[i].id, stations[i + 1].id),
      mode: leg.mode,
      overnight: leg.overnight,
    };
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
